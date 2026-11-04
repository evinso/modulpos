const crypto = require('crypto');
const prisma = require('../../config/database');
const { parseXml } = require('./xmlParser');
const notificationService = require('../notificationService');
const whatsappService = require('../whatsappService');
const { getUserQuota } = require('../../utils/quotaHelper');
const productListCache = require('../productListCache');

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

// A running sync stamps a heartbeat into SyncLog.details; one that has been silent this long is considered dead.
const STALE_AFTER_MS = 20 * 60 * 1000;
const heartbeat = () => JSON.stringify({ heartbeat: new Date().toISOString() });
function lastBeat(log) {
  let t = new Date(log.startedAt).getTime();
  try { const b = log.details ? JSON.parse(log.details).heartbeat : null; if (b) t = Math.max(t, new Date(b).getTime()); } catch { /* ignore */ }
  return t;
}

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
  for (const k of ['title', 'description', 'brand', 'category', 'barcode', 'images', 'rawXmlData', 'status']) {
    if (k === 'status' && next.status === undefined) continue;
    if ((ex[k] ?? null) !== (next[k] ?? null)) data[k] = next[k];
  }
  return data;
}


/** Options chosen when adding/editing the source (XmlSource.options JSON). Every key is optional. */
function normalizeOptions(raw) {
  let o = {};
  try { o = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}; } catch { o = {}; }
  const n = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  return {
    minStock: n(o.stock?.minStock),        // stock below this is imported as 0
    maxStock: n(o.stock?.maxStock),        // stock is capped to this value
    inStockQty: n(o.stock?.inStockQty) > 0 ? n(o.stock?.inStockQty) : 1, // quantity used when the feed only says "in stock"
    onlyInStock: !!o.stock?.onlyInStock,   // skip products without stock
    includeCategories: list(o.filters?.includeCategories),
    excludeCategories: list(o.filters?.excludeCategories),
    includeBrands: list(o.filters?.includeBrands),
    excludeBrands: list(o.filters?.excludeBrands),
    minPrice: n(o.filters?.minPrice),
    maxPrice: n(o.filters?.maxPrice),
    requireImage: !!o.filters?.requireImage,
    titlePrefix: String(o.content?.titlePrefix || ''),
    titleSuffix: String(o.content?.titleSuffix || ''),
    titleCase: ['upper', 'lower', 'title'].includes(o.content?.titleCase) ? o.content.titleCase : 'none',
    maxImages: n(o.content?.maxImages),
    defaultBrand: String(o.content?.defaultBrand || '').trim(),
    currencyRate: n(o.price?.currencyRate) > 0 ? n(o.price?.currencyRate) : 1,
    priceAlertPct: n(o.price?.priceAlertPct),
    mode: ['update_only', 'create_only'].includes(o.run?.mode) ? o.run.mode : 'full',
    markMissingPassive: !!o.run?.markMissingPassive,
  };
}

const trLower = (t) => t.toLocaleLowerCase('tr');
function titleCase(t) {
  return trLower(t).replace(/(^|[\s\-\/(])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase('tr'));
}

/** true when the feed product must NOT be imported according to the source's filters */
function filteredOut(p, o) {
  const cats = String(p.category || '').split('|').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const brand = String(p.brand || '').trim().toLowerCase();
  const price = Number(p.price) || 0;
  if (o.includeCategories.length && !cats.some((c) => o.includeCategories.includes(c))) return true;
  if (o.excludeCategories.length && cats.some((c) => o.excludeCategories.includes(c))) return true;
  if (o.includeBrands.length && !o.includeBrands.includes(brand)) return true;
  if (o.excludeBrands.length && o.excludeBrands.includes(brand)) return true;
  if (o.minPrice !== null && price < o.minPrice) return true;
  if (o.maxPrice !== null && price > o.maxPrice) return true;
  if (o.onlyInStock && !((Number(p.stock) || 0) > 0)) return true;
  if (o.requireImage && !(p.images && p.images.length)) return true;
  return false;
}

function shapeText(title, o) {
  if (!title) return title;
  let t = String(title);
  if (o.titleCase === 'upper') t = t.toLocaleUpperCase('tr');
  else if (o.titleCase === 'lower') t = trLower(t);
  else if (o.titleCase === 'title') t = titleCase(t);
  return `${o.titlePrefix}${t}${o.titleSuffix}`.trim();
}

function shapeStock(stock, opts, available) {
  if (!opts) return stock;
  // Feeds that only publish "in stock / out of stock" instead of a quantity
  if ((stock === null || stock === undefined || Number(stock) === 0) && available === true) return opts.inStockQty;
  if (stock === null || stock === undefined) return stock;
  let v = Number(stock) || 0;
  if (opts.minStock !== null && v < opts.minStock) v = 0;
  if (opts.maxStock !== null && v > opts.maxStock) v = opts.maxStock;
  return v;
}

function buildProductFields(p, source, userPlan, opts) {
  const sku = cleanVal(p.sku) || cleanVal(p.barcode)
    || `xml-${crypto.createHash('sha1').update(String(p.title || '')).digest('hex').slice(0, 12)}`;

  let raw = (p.price || 0) * (opts ? opts.currencyRate : 1);
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
    stock: shapeStock(p.stock, opts, p.stockAvailable), brand: p.brand || (opts && opts.defaultBrand) || p.brand, category: p.category,
    images: p.images?.length ? JSON.stringify(opts && opts.maxImages ? p.images.slice(0, opts.maxImages) : p.images) : null,
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

async function execute(source, syncLog, trigger, ctl = { aborted: false }) {
  const checkAbort = () => { if (ctl.aborted) throw new Error('Senkron süre sınırı nedeniyle durduruldu'); };
  const storeId = source.storeId;
  const owner = source.store?.userId;

  const userSub = owner ? await prisma.subscription.findFirst({
    where: { userId: owner, status: 'active' }, orderBy: { endDate: 'desc' },
  }) : null;
  const userPlan = resolveUserPlan(userSub?.plan);

  const feed = await parseXml(source.url, source.mappingConfig);
  const opts = normalizeOptions(source.options);
  await prisma.syncLog.update({ where: { id: syncLog.id }, data: { details: heartbeat() } }).catch(() => {});
  const { maxProducts } = await getUserQuota(owner);
  const currentCount = await prisma.product.count({ where: { storeId } });

  const existingRows = await prisma.product.findMany({
    where: { storeId, xmlSourceId: source.id },
    select: {
      id: true, sku: true, title: true, description: true, xmlPrice: true, price: true, cost: true,
      listPrice: true, stock: true, brand: true, category: true, barcode: true, images: true, rawXmlData: true, status: true,
    },
  });
  const bySku = new Map();
  for (const r of existingRows) if (!bySku.has(r.sku)) bySku.set(r.sku, r);

  const creates = [];
  const updates = [];
  const logs = [];
  const seen = new Set();
  let skipped = 0, unchanged = 0, errors = 0, filtered = 0, passivated = 0, reactivated = 0;
  const alerts = [];

  for (const p of feed) {
    try {
      if (filteredOut(p, opts)) { filtered++; continue; }
      const f = buildProductFields(p, source, userPlan, opts);
      if (seen.has(f.sku)) { skipped++; continue; } // duplicate SKU inside the same feed
      seen.add(f.sku);

      const title = shapeText(f.title, opts), description = f.description;

      const ex = bySku.get(f.sku);
      if (ex && opts.mode === 'create_only') { unchanged++; continue; }
      if (!ex && opts.mode === 'update_only') { skipped++; continue; }
      if (ex) {
        const next = {
          title: title || ex.title,
          description: description || ex.description,
          xmlPrice: f.xmlPrice,
          // A price edited by hand (differs from the previous feed price) is kept; otherwise it follows the feed
          price: (ex.price > 0 && Math.abs(ex.price - (ex.xmlPrice || 0)) > 0.005) ? ex.price : f.xmlPrice,
          cost: f.cost || ex.cost,
          listPrice: f.listPrice || ex.listPrice,
          stock: f.stock ?? ex.stock,
          brand: f.brand || ex.brand,
          category: f.category || ex.category,
          barcode: f.hasBarcode ? f.finalBarcode : ex.barcode,
          images: f.images || ex.images,
          rawXmlData: f.rawXmlData,
        };
        if (opts.markMissingPassive && ex.status === 'passive') { next.status = 'active'; reactivated++; }
        const data = diffProduct(ex, next);
        if (Object.keys(data).length === 0) { unchanged++; continue; }
        updates.push({ id: ex.id, data });

        const priceChanged = Math.abs((ex.xmlPrice || 0) - f.xmlPrice) > 0.001;
        if (priceChanged && opts.priceAlertPct !== null && (ex.xmlPrice || 0) > 0
            && Math.abs(f.xmlPrice - ex.xmlPrice) / ex.xmlPrice * 100 >= opts.priceAlertPct) {
          alerts.push({ sku: f.sku, old: ex.xmlPrice, now: f.xmlPrice });
        }
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
          xmlPrice: f.xmlPrice, price: f.xmlPrice, vatRate: Number.isFinite(Number(source.defaultVatRate)) ? Number(source.defaultVatRate) : 10,
          cost: f.cost || 0, listPrice: f.listPrice || 0, stock: f.stock || 0,
          brand: f.brand || null, category: f.category || null, images: f.images, rawXmlData: f.rawXmlData,
        });
        logs.push({ productId: id, type: 'created', newPrice: f.xmlPrice, newStock: f.stock || 0, source: 'xml_sync', notes: `XML'den eklendi: ${source.name}` });
      }
    } catch { errors++; }
  }

  if (opts.markMissingPassive && feed.length > 0) {
    for (const r of existingRows) {
      if (!seen.has(r.sku) && r.status === 'active') { updates.push({ id: r.id, data: { status: 'passive' } }); passivated++; }
    }
  }

  let created = 0, updated = 0;
  const progress = async () => {
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { itemCount: created + updated, created, updated, errorCount: errors, skipped, details: heartbeat() },
    }).catch(() => {});
  };

  for (const part of chunk(creates, CREATE_CHUNK)) {
    checkAbort();
    const failed = await writeResilient(
      part,
      (items) => prisma.product.createMany({ data: items, skipDuplicates: true }),
      (it) => prisma.product.create({ data: it }),
    );
    errors += failed; created += part.length - failed;
    await progress();
  }

  // Updates that set the very same value (e.g. status -> passive) collapse into one statement per 1000 ids
  const uniformGroups = new Map();
  const individual = [];
  for (const u of updates) {
    const keys = Object.keys(u.data);
    if (keys.length === 1 && keys[0] === 'status') {
      const g = uniformGroups.get(u.data.status) || [];
      g.push(u);
      uniformGroups.set(u.data.status, g);
    } else individual.push(u);
  }
  for (const [status, group] of uniformGroups) {
    for (const part of chunk(group, 1000)) {
      checkAbort();
      const failed = await writeResilient(
        part,
        (items) => prisma.product.updateMany({ where: { id: { in: items.map((u) => u.id) } }, data: { status } }),
        (u) => prisma.product.update({ where: { id: u.id }, data: { status } }),
      );
      errors += failed; updated += part.length - failed;
      await progress();
    }
  }

  for (const part of chunk(individual, UPDATE_CHUNK)) {
    checkAbort();
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
      completedAt: new Date(), details: JSON.stringify({ total: feed.length, unchanged, filtered, passivated, reactivated, priceAlerts: alerts.length, alertSamples: alerts.slice(0, 10), trigger }),
    },
  });
  await prisma.xmlSource.update({
    where: { id: source.id }, data: { lastSyncedAt: new Date(), totalProducts: feed.length, status: 'active' },
  });

  productListCache.invalidate(storeId);
  const result = { total: feed.length, created, updated, unchanged, skipped, errors, filtered, passivated, priceAlerts: alerts.length };

  const skippedNote = (skipped > 0 ? ` ${skipped} ürün atlandı (limit/tekrar).` : '')
    + (filtered > 0 ? ` ${filtered} ürün filtrelere takıldı.` : '')
    + (passivated > 0 ? ` ${passivated} ürün beslemede olmadığı için pasife alındı.` : '')
    + (alerts.length > 0 ? ` ⚠ ${alerts.length} üründe fiyat eşiği aşıldı.` : '');
  await notificationService.create({
    storeId,
    title: trigger === 'cron' ? 'Otomatik XML Senkronizasyonu' : 'XML Senkronizasyon Tamamlandı',
    message: `"${source.name}": ${created} yeni, ${updated} güncellendi, ${unchanged} değişmedi.${skippedNote}`,
    type: errors > 0 || skipped > 0 || alerts.length > 0 ? 'warning' : 'success',
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

  // The in-memory lock only knows this process; also honour a sync another instance has started recently
  const candidates = await prisma.syncLog.findMany({
    where: { xmlSourceId, type: 'xml_sync', status: 'started' }, select: { id: true, startedAt: true, details: true },
  });
  const other = candidates.find((l) => Date.now() - lastBeat(l) < STALE_AFTER_MS);
  if (other) {
    const e = new Error('Bu kaynak için senkronizasyon zaten çalışıyor'); e.code = 'SYNC_RUNNING'; e.status = 409; e.syncLogId = other.id;
    throw e;
  }

  const lock = { syncLogId: null, startedAt: Date.now() };
  running.set(xmlSourceId, lock);
  let syncLog;
  try {
    syncLog = await prisma.syncLog.create({
      data: { storeId: source.storeId, xmlSourceId, type: 'xml_sync', status: 'started', details: heartbeat() },
    });
  } catch (err) { running.delete(xmlSourceId); throw err; }
  lock.syncLogId = syncLog.id;

  const promise = (async () => {
    try {
      // Hard upper bound: a sync that overruns is abandoned and the source is released for the next attempt
      const limitMs = (parseInt(process.env.SYNC_MAX_MINUTES, 10) || 30) * 60 * 1000;
      const ctl = { aborted: false };
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { ctl.aborted = true; reject(new Error(`Senkron ${limitMs / 60000} dakikayı aştığı için iptal edildi`)); }, limitMs);
      });
      try {
        return await Promise.race([execute(source, syncLog, trigger, ctl), deadline]);
      } finally {
        clearTimeout(timer);
      }
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

/** Closes "started" syncs nobody is working on any more (process died, instance replaced). Safe to call often. */
async function failAbandonedSyncs() {
  const started = await prisma.syncLog.findMany({ where: { status: 'started' }, select: { id: true, xmlSourceId: true, startedAt: true, details: true } });
  const dead = started.filter((l) => !(l.xmlSourceId && running.has(l.xmlSourceId)) && Date.now() - lastBeat(l) > STALE_AFTER_MS);
  if (dead.length) {
    await prisma.syncLog.updateMany({
      where: { id: { in: dead.map((l) => l.id) }, status: 'started' },
      data: { status: 'failed', completedAt: new Date(), details: JSON.stringify({ error: 'Senkron yanıt vermediği için kapatıldı (süreç yeniden başlamış olabilir)' }) },
    });
    console.log(`[Sync] ${dead.length} terk edilmiş senkron kaydı kapatıldı`);
  }
  return dead.length;
}

function isRunning(xmlSourceId) {
  return running.has(xmlSourceId);
}

module.exports = { startXmlSync, failStaleSyncs, failAbandonedSyncs, isRunning };
