// What a sold item cost us. Three sources, strongest first:
//   manual    typed in on the profit panel for a barcode (products the store no longer carries, or a corrected cost)
//   snapshot  the product's purchase cost when the order arrived (kept on the order, so later XML price changes do not rewrite history)
//   product   the product's purchase cost now (used when no snapshot exists yet; saved as the snapshot the first time it is seen)
// "Purchase cost" is the same number the price template works from: the XML price (or the stored price).

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const costOf = (p) => { const c = num(p.xmlPrice) || num(p.price); return c > 0 ? c : 0; };

function parseJson(text, fallback) { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; } }

const lineKeys = (line) => [line.barcode, line.merchantSku, line.stockCode, line.sku].filter(Boolean).map(String);

/**
 * Cost map for one order: Map key (barcode / sku) -> { unit, source }.
 * manual: { barcode: unit }, snapshot: { barcode: unit } | null, products: Map key -> Product
 */
function costMapFor(lines, { manual = {}, snapshot = null, products = new Map() } = {}) {
  const out = new Map();
  for (const line of lines) {
    const keys = lineKeys(line);
    const main = String(line.barcode || keys[0] || '');
    if (!main || out.has(main)) continue;
    let hit = null;
    for (const k of keys) if (num(manual[k]) > 0) { hit = { unit: num(manual[k]), source: 'manual' }; break; }
    if (!hit && snapshot) for (const k of keys) if (num(snapshot[k]) > 0) { hit = { unit: num(snapshot[k]), source: 'snapshot' }; break; }
    if (!hit) for (const k of keys) { const p = products.get(k); if (p && costOf(p) > 0) { hit = { unit: costOf(p), source: 'product' }; break; } }
    if (hit) out.set(main, hit);
  }
  return out;
}

/** Products of a store by barcode and by sku, for the given keys: Map key -> Product. */
async function loadProducts(db, storeId, keys) {
  const list = [...new Set(keys.filter(Boolean).map(String))];
  const map = new Map();
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500);
    const rows = await db.product.findMany({ where: { storeId, OR: [{ barcode: { in: part } }, { sku: { in: part } }] }, select: { id: true, barcode: true, sku: true, xmlPrice: true, price: true, xmlSourceId: true } });
    for (const p of rows) { if (p.barcode) map.set(String(p.barcode), p); if (p.sku && !map.has(String(p.sku))) map.set(String(p.sku), p); }
  }
  return map;
}

/** {barcode: unit cost} of the lines that have a product cost, to be saved on the order as its snapshot. */
function snapshotFor(lines, products) {
  const out = {};
  for (const line of lines) {
    for (const k of lineKeys(line)) { const p = products.get(k); if (p && costOf(p) > 0) { out[String(line.barcode || k)] = costOf(p); break; } }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Supplier service fee per unit for each line: the fee set on the XML source the sold product belongs to.
 * snapshot: { barcode: fee } saved on the order when it arrived (wins), otherwise the source's CURRENT fee.
 * feeBySource: Map xmlSourceId -> fee.  Returns Map barcode -> { unit, source: 'snapshot' | 'source' } (only fees > 0).
 */
function feeMapFor(lines, { snapshot = null, products = new Map(), feeBySource = new Map() } = {}) {
  const out = new Map();
  for (const line of lines) {
    const keys = lineKeys(line);
    const main = String(line.barcode || keys[0] || '');
    if (!main || out.has(main)) continue;
    if (snapshot) {                                   // saved at arrival, even when it was "none"
      for (const k of keys) if (num(snapshot[k]) > 0) { out.set(main, { unit: num(snapshot[k]), source: 'snapshot' }); break; }
      continue;
    }
    for (const k of keys) {
      const p = products.get(k);
      const fee = p && p.xmlSourceId ? num(feeBySource.get(p.xmlSourceId)) : 0;
      if (fee > 0) { out.set(main, { unit: fee, source: 'source' }); break; }
    }
  }
  return out;
}

/** {barcode: fee} of the lines whose product's XML source charges a service fee; '{}' text means "checked, none". */
function feeSnapshotFor(lines, products, feeBySource) {
  const out = {};
  for (const line of lines) {
    for (const k of lineKeys(line)) {
      const p = products.get(k);
      const fee = p && p.xmlSourceId ? num(feeBySource.get(p.xmlSourceId)) : 0;
      if (fee > 0) { out[String(line.barcode || k)] = fee; break; }
    }
  }
  return out;
}

async function loadFeeBySource(db, storeId) {
  const rows = await db.xmlSource.findMany({ where: { storeId, orderServiceFee: { gt: 0 } }, select: { id: true, orderServiceFee: true } });
  return new Map(rows.map((r) => [r.id, r.orderServiceFee]));
}

const keyFor = (storeId) => `order_cost:${storeId}`;
async function loadManual(db, storeId) {
  const row = await db.systemSettings.findUnique({ where: { key: keyFor(storeId) } });
  return row ? parseJson(row.value, {}) : {};
}
async function saveManual(db, storeId, barcode, unitCost) {
  const map = await loadManual(db, storeId);
  if (unitCost === null) delete map[barcode]; else map[barcode] = unitCost;
  await db.systemSettings.upsert({ where: { key: keyFor(storeId) }, create: { key: keyFor(storeId), value: JSON.stringify(map) }, update: { value: JSON.stringify(map) } });
  return map;
}

// Shipping fee of ONE order typed in by hand (from the seller panel's "Sipariş Kayıtları") until Trendyol's cargo invoice exists: { orderId: amount incl. VAT }
const cargoKey = (storeId) => `order_cargo:${storeId}`;
async function loadManualCargo(db, storeId) {
  const row = await db.systemSettings.findUnique({ where: { key: cargoKey(storeId) } });
  return row ? parseJson(row.value, {}) : {};
}
async function saveManualCargo(db, storeId, orderId, amount) {
  const map = await loadManualCargo(db, storeId);
  if (amount === null) delete map[orderId]; else map[orderId] = amount;
  await db.systemSettings.upsert({ where: { key: cargoKey(storeId) }, create: { key: cargoKey(storeId), value: JSON.stringify(map) }, update: { value: JSON.stringify(map) } });
  return map;
}

module.exports = { loadManualCargo, saveManualCargo, feeMapFor, feeSnapshotFor, loadFeeBySource, costMapFor, loadProducts, snapshotFor, loadManual, saveManual, lineKeys, costOf, parseJson };
