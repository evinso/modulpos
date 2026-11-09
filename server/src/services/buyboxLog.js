// Notes about the BuyBox price adjustment: what it did, what it skipped and why. Shown on the BuyBox page ("Otomatik Fiyat" tab).
// Writing a note must never break the price update itself, so logRun swallows every error.

const MAX_ITEMS = 100;          // products listed per note
const KEEP_DAYS = 180;          // older notes are removed when a new one is written

const money = (n) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} ₺`;

/** "BuyBox fiyatına eşit" / "BuyBox fiyatının 1,00 ₺ altı" */
function modeLabel(mode, amount) {
  return mode === 'undercut' ? `BuyBox fiyatının ${money(amount || 0)} altı` : 'BuyBox fiyatına eşit';
}

function skipText(sk) {
  const parts = [];
  if (sk.notLower) parts.push(`${sk.notLower} ürün zaten BuyBox fiyatının altında/eşit olduğu için`);
  if (sk.loss) parts.push(`${sk.loss} ürün zarara düşeceği için`);
  if (sk.noProduct) parts.push(`${sk.noProduct} ürün eşleşen kayıt bulunamadığı için`);
  return parts.length ? `${parts.join(', ')} atlandı.` : '';
}

/**
 * The sentence for one run. r = { kind, mode, amount, considered, planned, updated, skipped, creditUsed, error }.
 * Also returns the status: ok (all planned were sent) | partial | nothing (nothing to change) | error.
 */
function describeRun(r) {
  const sk = { notLower: 0, loss: 0, noProduct: 0, ...(r.skipped || {}) };
  const who = r.kind === 'manual' ? 'Elle fiyat güncelleme' : 'Otomatik fiyat';
  const how = modeLabel(r.mode, r.amount);
  const planned = r.planned || 0;
  const updated = r.updated || 0;
  const credit = r.creditUsed > 0 ? ` ${String(r.creditUsed).replace('.', ',')} kredi kullanıldı.` : '';
  const skipped = skipText(sk);

  if (r.error && updated === 0) {
    return { status: 'error', note: `${who}: fiyatlar güncellenemedi. ${String(r.error).slice(0, 200)}`.trim() };
  }
  if (r.error) {
    return { status: 'partial', note: `${who}: ${planned} üründen ${updated}'sinin fiyatı düşürüldü (${how}); gerisi gönderilemedi: ${String(r.error).slice(0, 160)}. ${skipped}${credit}`.replace(/\s+/g, ' ').trim() };
  }
  if (updated > 0) {
    return { status: 'ok', note: `${who}: ${updated} ürünün fiyatı düşürüldü (${how}). ${skipped}${credit}`.replace(/\s+/g, ' ').trim() };
  }
  return { status: 'nothing', note: `${who}: ${r.considered || 0} üründe fiyat değiştirilmedi. ${skipped}`.replace(/\s+/g, ' ').trim() };
}

/** Sentence for a change of the automatic-price settings, or null when nothing changed. */
function describeSettingsChange(before, after) {
  const b = { enabled: !!before.enabled, mode: before.mode || 'equal', amount: Number(before.amount) || 0 };
  const a = { enabled: !!after.enabled, mode: after.mode || 'equal', amount: Number(after.amount) || 0 };
  if (b.enabled === a.enabled && b.mode === a.mode && (a.mode !== 'undercut' || b.amount === a.amount)) return null;
  if (!a.enabled) return 'Otomatik fiyat ayarı kapatıldı.';
  return `Otomatik fiyat ayarı ${b.enabled ? 'değiştirildi' : 'açıldı'}: ${modeLabel(a.mode, a.amount)}.`;
}

/**
 * Stores one note. entry = describeRun input + { connectionId, kind, changes: [{barcode,title,oldPrice,newPrice}] } or, for kind
 * 'settings', { connectionId, kind, note, mode, amount }. `db` is injectable for tests. Never throws.
 */
async function logRun(entry, db) {
  try {
    const prisma = db || require('../config/database');
    const sk = entry.skipped || {};
    const described = entry.kind === 'settings' ? { status: 'info', note: entry.note } : describeRun(entry);
    const changes = (entry.changes || []).slice(0, MAX_ITEMS).map((c) => ({
      barcode: c.barcode, title: c.title ? String(c.title).slice(0, 120) : null, oldPrice: c.oldPrice ?? null, newPrice: c.newPrice,
    }));
    await prisma.buyboxAutoLog.create({ data: {
      connectionId: entry.connectionId, kind: entry.kind, status: described.status, mode: entry.mode || null,
      amount: entry.amount === undefined ? null : Number(entry.amount) || 0,
      considered: entry.considered || 0, updated: entry.updated || 0,
      skippedNotLower: sk.notLower || 0, skippedLoss: sk.loss || 0, skippedOther: sk.noProduct || 0,
      creditUsed: entry.creditUsed || 0, note: described.note, items: changes.length ? JSON.stringify(changes) : null,
    } });
    await prisma.buyboxAutoLog.deleteMany({ where: { connectionId: entry.connectionId, createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86400000) } } });
  } catch (e) {
    console.error('[BuyBox] note could not be saved:', e.message);
  }
}

module.exports = { describeRun, describeSettingsChange, logRun, modeLabel, MAX_ITEMS };
