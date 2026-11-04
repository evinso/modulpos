const crypto = require('crypto');
const prisma = require('../../config/database');
const { parseXml } = require('./xmlParser');
const notificationService = require('../notificationService');
const whatsappService = require('../whatsappService');
const { getUserQuota } = require('../../utils/quotaHelper');

/**
 * Single XML -> products sync implementation, used by both the manual
 * "Şimdi çek" button and the cron job.
 *
 * Design (why it is fast):
 *  - existing products are loaded in ONE query and compared in memory
 *  - unchanged products are not written at all
 *  - new products are inserted with createMany in chunks
 *  - changed products are updated in small transactions
 *  - the HTTP request returns immediately; progress is stored in SyncLog
 *  - one sync per source at a time (in-memory lock + stale cleanup at boot)
 */

const running = new Map(); // xmlSourceId -> { syncLogId, startedAt }

const CREATE_CHUNK = 500;
const UPDATE_CHUNK = 50;

function resolveUserPlan(rawPlan) {
  const p = (rawPlan || '').toLowerCase();
  if (p === 'kurumsal' || p === 'enterprise') return 'Kurumsal';
  if (p === 'profesyonel' || p === 'premium' || p === 'pro' || p === 'growth') return 'Profesyonel';
  return 'Başlangıç';
}

function getPerPlanMarkup(byPlanJson, userPlan) {
  if (!byPlanJson) return null;
  try {
    const map = JSON.parse(byPlanJson);
    const val = map[userPlan];
    return (val !== undefined && val !== '' && val !== null) ? parseFloat(val) : null;
  } catch { return null; }
}

const cleanVal = (v) => (v && !/^[{}[\]\s]+$/.test(String(v).trim()) && String(v).trim().length >= 2) ? String(v).trim() : null;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const numChanged = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 1e-9;

/** Computes the diff between a feed product and its stored row; returns changed fields only. */
function diffProduct(ex, next) {
  const data = {};
  for (const k of ['xmlPrice', 'price', 'cost', 'listPrice']) {
    if (numChanged(ex[k], next[k])) data[k] = next[k];
  }
  if ((ex.stock ?? 0) !== (next.stock ?? 0)) data.stock = next.stock;
  for (const k of ['title', 'description', 'brand', 'category', 'barcode', 'images', 'rawXmlData']) {
    if ((ex[k] ?? null) !== (next[k] ?? null)) data[k] = next[k];
  }
  return data;
}

function buildProductFields(p, source, userPlan) {
  const sku = cleanVal(p.sku) || cleanVal(p.barcode)
    || `xml-${crypto.createHash('sha1').update(String(p.title || '')).digest('hex').slice(0, 12)}`;

  let raw = p.price || 0;
  const planMarkupPct = getPerPlanMarkup(source.globalPriceMarkupPctByPlan, userPlan);
  if (planMarkupPct !== null) raw += raw * (planMarkupPct / 100);
  else if (source.globalPriceMarkupPct) raw += raw * (source.globalPriceMarkupPct / 100);
  if (source.globalPriceMarkup) raw += source.globalPriceMarkup;
  if (source.purchaseVatRate && source.purchaseVatRate > 0) raw = raw * (1 + source.purchaseVatRate / 100);
  const xmlPrice = Math.round(raw * 100) / 100;

  const rawBarcode = cleanVal(p.barcode);
  const baseBarcode = source.globalBarcodePrefix ? `${source.globalBarcodePrefix}${rawBarcode || sku}` : (rawBarcode || sku);
  const finalBarcode = source.barcodePrefix ? `${source.barcodePrefix}${baseBarcode}` : baseBarcode;

  // Original feed values, stored untouched (never run through content rules)
  const rawXmlData = JSON.stringify({
    sku: p.sku, barcode: p.barcode, title: p.title, description: p.description,
    price: p.price, listPrice: p.listPrice, cost: p.cost, stock: p.stock,
    brand: p.brand, category: p.category, images: p.images,
  });

  return {
    sku, finalBarcode, hasBarcode: !!rawBarcode || !!p.barcode, xmlPrice, rawXmlData,
    title: p.title, description: p.description, cost: p.cost, listPrice: p.listPrice,
    stock: p.stock, brand: p.brand, category: p.category,
    images: p.images?.length ? JSON.stringify(p.images) : null,
  };
}

/** Runs a batch; if the whole chunk fails, retries row by row so one bad row costs one error. */
async function writeResilient(items, writeChunk, writeOne) {
  let failed = 0;
  try {
    await writeChunk(items);
  } catch {
    for (const it of items) {
      try { await writeOne(it); } catch { failed++; }
    }
  }
  return failed;
}

async function execute(source, syncLog, trigger, ruleHooks) {
  const storeId = source.storeId;
  const owner = source.store?.userId;

  const userSub = owner ? await prisma.subscription.findFirst({
    where: { userId: owner, status: 'active' }, orderBy: { endDate: 'desc' },
  }) : null;
  const userPlan = resolveUserPlan(userSub?.plan);

  const feed = await parseXml(source.url, source.mappingConfig);
  const { maxProducts } = await getUserQuota(owner);
  const currentCount = await prisma.product.count({ where: { storeId } });

  const existingRows = await prisma.product.findMany({
    where: { storeId, xmlSourceId: source.id },
    select: {
      id: true, sku: true, title: true, description: true, xmlPrice: true, price: true, cost: true,
      listPrice: true, stock: true, brand: true, category: true, barcode: true, images: true, rawXmlData: true,
    },
  });
  const bySku = new Map();
  for (const r of existingRows) if (!bySku.has(r.sku)) bySku.set(r.sku, r);

  const creates = [];
  const updates = [];
  const logs = [];
  const seen = new Set();
  let skipped = 0, unchanged = 0, errors = 0, blocked = 0;

  for (const p of feed) {
    try {
      const f = buildProductFields(p, source, userPlan);
      if (seen.has(f.sku)) { skipped++; continue; } // duplicate SKU inside the same feed
      seen.add(f.sku);

      // Content rules (forbidden words etc.) apply to the stored copy only
      let title = f.title, description = f.description;
      if (ruleHooks) {
        const out = ruleHooks.apply({ title, description });
        title = out.title; description = out.description;
        if (out.blocked) blocked++;
      }

      const ex = bySku.get(f.sku);
      if (ex) {
        const next = {
          title: title || ex.title,
          description: description || ex.description,
          xmlPrice: f.xmlPrice,
          price: f.xmlPrice,
          cost: f.cost || ex.cost,
          listPrice: f.listPrice || ex.listPrice,
          stock: f.stock ?? ex.stock,
          brand: f.brand || ex.brand,
          category: f.category || ex.category,
          barcode: f.hasBarcode ? f.finalBarcode : ex.barcode,
          images: f.images || ex.images,
          rawXmlData: f.rawXmlData,
        };
        const data = diffProduct(ex, next);
        if (Object.keys(data).length === 0) { unchanged++; continue; }
        updates.push({ id: ex.id, data });

        const priceChanged = Math.abs((ex.xmlPrice || 0) - f.xmlPrice) > 0.001;
        const stockChanged = (ex.stock ?? 0) !== (next.stock ?? 0);
        if (priceChanged || stockChanged) {
          logs.push({
            productId: ex.id, type: 'synced',
            oldPrice: priceChanged ? ex.xmlPrice : null, newPrice: priceChanged ? f.xmlPrice : null,
            oldStock: stockChanged ? ex.stock : null, newStock: stockChanged ? next.stock : null,
            source: 'xml_sync',
            notes: [priceChanged && 'fiyat güncellendi', stockChanged && 'stok güncellendi'].filter(Boolean).join(', '),
          });
        }
      } else {
        if (currentCount + creates.length >= maxProducts) { skipped++; continue; }
        const id = crypto.randomUUID();
        creates.push({
          id, storeId, xmlSourceId: source.id, sku: f.sku, barcode: f.finalBarcode,
          title: title || 'İsimsiz', description: description || null,
          xmlPrice: f.xmlPrice, price: f.xmlPrice, vatRate: source.defaultVatRate || 10,
          cost: f.cost || 0, listPrice: f.listPrice || 0, stock: f.stock || 0,
          brand: f.brand || null, category: f.category || null, images: f.images, rawXmlData: f.rawXmlData,
        });
        logs.push({ productId: id, type: 'created', newPrice: f.xmlPrice, newStock: f.stock || 0, source: 'xml_sync', notes: `XML'den eklendi: ${source.name}` });
      }
    } catch { errors++; }
  }

  let created = 0, updated = 0;
  const progress = async () => {
    await prisma.syncLog.update({
      where: { id: syncLog.id }, data: { itemCount: created + updated, created, updated, errorCount: errors, skipped },
    }).catch(() => {});
  };

  for (const part of chunk(creates, CREATE_CHUNK)) {
    const failed = await writeResilient(
      part,
      (items) => prisma.product.createMany({ data: items, skipDuplicates: true }),
      (it) => prisma.product.create({ data: it }),
    );
    errors += failed; created += part.length - failed;
    await progress();
  }

  for (const part of chunk(updates, UPDATE_CHUNK)) {
    const failed = await writeResilient(
      part,
      (items) => prisma.$transaction(items.map((u) => prisma.product.update({ where: { id: u.id }, data: u.data }))),
      (u) => prisma.product.update({ where: { id: u.id }, data: u.data }),
    );
    errors += failed; updated += part.length - failed;
    await progress();
  }

  // Logs are best-effort; a logging failure must never fail the sync
  for (const part of chunk(logs, 500)) {
    await prisma.productLog.createMany({ data: part }).catch(() => {});
  }

  await prisma.syncLog.update({
    where: { id: syncLog.id },
    data: {
      status: 'completed', itemCount: created + updated, created, updated, skipped, errorCount: errors,
      completedAt: new Date(), details: JSON.stringify({ total: feed.length, unchanged, blocked, trigger }),
    },
  });
  await prisma.xmlSource.update({
    where: { id: source.id }, data: { lastSyncedAt: new Date(), totalProducts: feed.length, status: 'active' },
  });

  const result = { total: feed.length, created, updated, unchanged, skipped, errors, blocked };

  const skippedNote = skipped > 0 ? ` ${skipped} ürün atlandı (limit/tekrar).` : '';
  await notificationService.create({
    storeId,
    title: trigger === 'cron' ? 'Otomatik XML Senkronizasyonu' : 'XML Senkronizasyon Tamamlandı',
    message: `"${source.name}": ${created} yeni, ${updated} güncellendi, ${unchanged} değişmedi.${skippedNote}`,
    type: errors > 0 || skipped > 0 ? 'warning' : 'success',
    link: trigger === 'cron' ? '/products' : '/xml-sources',
    data: { notifType: 'xml_sync', sourceName: source.name, ...result },
  }).catch(() => {});
  if (trigger === 'cron') {
    whatsappService.notifyProductSync(source.store?.name || storeId, source.name, created, updated).catch(() => {});
  }
  return result;
}

/**
 * Starts a sync in the background. Resolves as soon as the SyncLog exists:
 *   { syncLogId, promise }  — `promise` resolves with the result (never rejects).
 * Throws {code:'SYNC_RUNNING'} if this source is already syncing.
 */
async function startXmlSync(xmlSourceId, { trigger = 'manual', userId = null } = {}) {
  const current = running.get(xmlSourceId);
  if (current) {
    const e = new Error('Bu kaynak için senkronizasyon zaten çalışıyor');
    e.code = 'SYNC_RUNNING'; e.status = 409; e.syncLogId = current.syncLogId;
    throw e;
  }
  const source = await prisma.xmlSource.findUnique({ where: { id: xmlSourceId }, include: { store: true } });
  if (!source) { const e = new Error('XML kaynağı bulunamadı'); e.status = 404; throw e; }

  const lock = { syncLogId: null, startedAt: Date.now() };
  running.set(xmlSourceId, lock);
  let syncLog;
  try {
    syncLog = await prisma.syncLog.create({
      data: { storeId: source.storeId, xmlSourceId, type: 'xml_sync', status: 'started' },
    });
  } catch (err) { running.delete(xmlSourceId); throw err; }
  lock.syncLogId = syncLog.id;

  const promise = (async () => {
    try {
      let ruleHooks = null;
      try {
        const { loadContentRules } = require('../contentRules');
        ruleHooks = await loadContentRules(source.storeId);
      } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') console.error('[XML Sync] content rules:', e.message); }
      return await execute(source, syncLog, trigger, ruleHooks);
    } catch (error) {
      console.error(`[XML Sync] ${source.name} başarısız:`, error.message);
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: { status: 'failed', completedAt: new Date(), details: JSON.stringify({ error: error.message, trigger }) },
      }).catch(() => {});
      prisma.auditLog.create({
        data: { userId, action: trigger === 'cron' ? 'CRON_XML_SYNC_ERROR' : 'XML_SYNC_ERROR', details: JSON.stringify({ xmlSourceId, error: error.message }), level: 'ERROR' },
      }).catch(() => {});
      if (trigger === 'cron') whatsappService.notifyXmlError(source.name, error.message).catch(() => {});
      return { error: error.message };
    } finally {
      running.delete(xmlSourceId);
    }
  })();

  return { syncLogId: syncLog.id, promise };
}

/** Marks syncs left in "started" by a previous process (crash/redeploy) as failed. */
async function failStaleSyncs() {
  const r = await prisma.syncLog.updateMany({
    where: { status: 'started' },
    data: { status: 'failed', completedAt: new Date(), details: JSON.stringify({ error: 'Sunucu yeniden başladığı için yarıda kesildi' }) },
  });
  if (r.count) console.log(`[Sync] ${r.count} yarım kalan senkron kaydı kapatıldı`);
}

function isRunning(xmlSourceId) {
  return running.has(xmlSourceId);
}

module.exports = { startXmlSync, failStaleSyncs, isRunning };
