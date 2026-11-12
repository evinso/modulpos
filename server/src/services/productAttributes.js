const prisma = require('../config/database');
const AD = require('./attributeDefaults');
const { buildOverrideMappings } = require('./productCategories');
const { pickValue } = require('./attributeFromText');

/**
 * Required Trendyol attributes of PRODUCTS that have a category of their own (ProductCategoryOverride): finding what is still empty and
 * filling it from the product's own title and description.
 *
 * A value read from the product's text (free) or chosen by the AI (paid) belongs to ONE product ("Kırmızı" is that product's colour, not
 * the category's). It is stored in the product's own attribute JSON with `from: 'title' | 'description' | 'ai'`. Such entries are never shared
 * with the other products of the category (see productCategories.js) and are kept when the default answers are refreshed (they carry no `auto`).
 */

const parseJson = (s) => { try { const o = s ? JSON.parse(s) : {}; return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

/** Plain text of a description: tags and entities removed, white space folded, cut. */
function plainText(html, max = 2000) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Value lists of the required attributes of many categories, fetched gently within a time budget. { map, pending } */
async function loadDefs(connection, categoryIds, budgetMs = 15000) {
  const ids = [...new Set(categoryIds.map(String))];
  const map = new Map();
  const started = Date.now();
  for (const part of chunk(ids, 60)) {
    if (Date.now() - started > budgetMs) break;
    const r = await AD.loadRequiredDefs(connection, part, { max: 60 });
    for (const [k, v] of r.map) map.set(k, v);
  }
  return { map, pending: ids.filter((id) => !map.has(id)).length };
}

/**
 * Products with a category of their own that still lack required attributes.
 * @param opts.xmlSourceId   only products of this source ('none' = added by hand)
 * @param opts.productIds    only these products
 * @param opts.includeRuleValues  also count attributes that only hold a default answer (auto: true) as open (fillFromText then replaces them only by a value read from the TITLE)
 * @returns { gaps: [{ rowId, productId, categoryId, attrs, missing: [def] }], pending, scanned }
 */
async function findGaps(connection, { xmlSourceId = null, productIds = null, includeRuleValues = false } = {}) {
  const [rows, mappings] = await Promise.all([
    prisma.productCategoryOverride.findMany({ where: { connectionId: connection.id }, select: { id: true, productId: true, marketplaceCategoryId: true, marketplaceCategoryName: true, attributes: true, source: true } }),
    prisma.categoryMapping.findMany({ where: { connectionId: connection.id }, select: { marketplaceCategoryId: true, attributes: true } }),
  ]);
  const effective = buildOverrideMappings(rows, mappings);   // what each product really has (own values, else the shared ones)

  let scope = rows;
  if (productIds) { const set = new Set(productIds); scope = scope.filter((r) => set.has(r.productId)); }
  if (xmlSourceId) {
    const inSource = await prisma.product.findMany({ where: { storeId: connection.storeId, xmlSourceId: xmlSourceId === 'none' ? null : xmlSourceId }, select: { id: true } });
    const set = new Set(inSource.map((p) => p.id));
    scope = scope.filter((r) => set.has(r.productId));
  }

  const { map: defs, pending } = await loadDefs(connection, scope.map((r) => r.marketplaceCategoryId));
  const gaps = [];
  for (const r of scope) {
    const list = defs.get(String(r.marketplaceCategoryId));
    if (!list || list.length === 0) continue;
    const eff = effective.get(r.productId);
    const attrs = parseJson(eff ? eff.attributes : null);
    const missing = list.filter((d) => { const v = attrs[d.id]; return !AD.hasVal(v) || (includeRuleValues && v.auto === true); });
    if (missing.length) gaps.push({ rowId: r.id, productId: r.productId, categoryId: String(r.marketplaceCategoryId), attrs, missing });
  }
  return { gaps, pending, scanned: scope.length };
}

/** { id -> { title, description (plain text) } } */
async function loadTexts(productIds) {
  const out = new Map();
  for (const part of chunk([...new Set(productIds)], 500)) {
    const rows = await prisma.product.findMany({ where: { id: { in: part } }, select: { id: true, title: true, description: true } });
    for (const p of rows) out.set(p.id, { title: p.title || '', description: plainText(p.description) });
  }
  return out;
}

/** Writes the new entries into the products' own attribute JSON (on top of what they effectively have). Returns the number of rows written. */
async function writeEntries(updates) {
  let written = 0;
  for (const part of chunk(updates, 100)) {
    await prisma.$transaction(part.map((u) => prisma.productCategoryOverride.update({ where: { id: u.rowId }, data: { attributes: JSON.stringify({ ...u.attrs, ...u.entries }) } })));
    written += part.length;
  }
  return written;
}

/** Counts, per attribute name, the products that still lack it (only attributes that are really empty). */
function tally(stillMissing) {
  return [...stillMissing].map(([name, products]) => ({ name, products })).sort((a, b) => b.products - a.products);
}

/**
 * Free step: fills the open required attributes from each product's title and description.
 * @returns { scanned, products (with a gap), filledProducts, filledAttributes, byFrom, stillMissing: [{ name, products }], pending }
 */
async function fillFromText(connection, opts = {}) {
  const { gaps, pending, scanned } = await findGaps(connection, opts);
  const texts = await loadTexts(gaps.map((g) => g.productId));
  const updates = [];
  const byFrom = { title: 0, description: 0 };
  const stillMissing = new Map();
  let filledAttributes = 0;
  for (const g of gaps) {
    const t = texts.get(g.productId);
    if (!t) continue;
    const entries = {};
    for (const d of g.missing) {
      const pick = pickValue(d, t.title, t.description);
      // an attribute that only holds a default answer ("Belirtilmemiş", a rule) is a safe answer: it is only replaced by what the TITLE says
      const holds = AD.hasVal(g.attrs[d.id]);
      const usePick = pick && (!holds || (pick.from === 'title' && String(g.attrs[d.id].valueId || '') !== pick.valueId));
      if (usePick) {
        entries[d.id] = { name: d.name, valueId: pick.valueId, valueName: pick.valueName, from: pick.from };   // no `auto`: the default answers never replace it
        byFrom[pick.from]++; filledAttributes++;
      } else if (!AD.hasVal(g.attrs[d.id])) {
        stillMissing.set(d.name, (stillMissing.get(d.name) || 0) + 1);
      }
    }
    if (Object.keys(entries).length) updates.push({ rowId: g.rowId, attrs: g.attrs, entries });
  }
  await writeEntries(updates);
  return { scanned, products: gaps.length, filledProducts: updates.length, filledAttributes, byFrom, stillMissing: tally(stillMissing), pending };
}

module.exports = { findGaps, loadTexts, loadDefs, writeEntries, fillFromText, plainText, tally, parseJson, chunk };
