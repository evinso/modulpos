const prisma = require('../config/database');
const { normText } = require('./categoryMatcher');

/**
 * Default answers for the REQUIRED Trendyol attributes of the categories chosen for products.
 *
 *   rules     "Menşei" -> "TR", "Renk, Web Color" -> "Çok Renkli"   (attribute names, comma separated aliases)
 *   fallback  every other required attribute -> "Belirtilmemiş"
 *
 * Stored on the connection (`config.attributeDefaults`). The answers are written into the products' attribute values
 * (ProductCategoryOverride.attributes) with `auto: true`, so they can be refreshed when the rules change, while values
 * typed by hand (no `auto`) are never touched. A value is only used when Trendyol accepts it: it must exist in the
 * attribute's value list, or the attribute must allow free text. Otherwise the attribute stays empty and is reported.
 */

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_VALUES = 2000;
const cache = new Map(); // `${connectionId}:${categoryId}` -> { at, defs: [{id,name,allowCustom,values:[{id,name}]}] | null }

/**
 * Required attributes (with their value lists) of the given categories, cached for hours.
 * Fetches at most `max` uncached categories per call; returns { map: Map(categoryId -> defs), pending: not fetched yet }.
 */
async function loadRequiredDefs(connection, categoryIds, { max = 60, timeoutMs = 8000 } = {}) {
  const map = new Map();
  if (connection.marketplaceType !== 'trendyol' || categoryIds.length === 0) return { map, pending: 0 };
  const TrendyolService = require('./trendyol/trendyolService');
  let service;
  try { service = new TrendyolService(connection); } catch { return { map, pending: 0 }; }

  const todo = [];
  for (const id of categoryIds) {
    const hit = cache.get(`${connection.id}:${id}`);
    if (hit && Date.now() - hit.at < TTL_MS) { if (hit.defs) map.set(String(id), hit.defs); }
    else todo.push(id);
  }
  const pending = Math.max(0, todo.length - max);
  todo.length = Math.min(todo.length, max);
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  for (let i = 0; i < todo.length; i += 5) {
    await Promise.all(todo.slice(i, i + 5).map(async (id) => {
      try {
        const data = await withTimeout(service.getCategoryAttributes(id), timeoutMs);
        const list = data?.categoryAttributes || data?.attributes || [];
        const defs = list.filter((a) => a && a.required === true).map((a) => ({
          id: String(a.attribute?.id ?? a.id),
          name: a.attribute?.name ?? a.name ?? String(a.id),
          allowCustom: !!a.allowCustom,
          values: (a.attributeValues || []).slice(0, MAX_VALUES).map((v) => ({ id: String(v.id), name: v.name })),
        }));
        cache.set(`${connection.id}:${id}`, { at: Date.now(), defs });
        map.set(String(id), defs);
      } catch {
        // Trendyol unreachable / slow: do not block products because of that; remember briefly so we do not retry on every request
        cache.set(`${connection.id}:${id}`, { at: Date.now() - TTL_MS + 5 * 60 * 1000, defs: null });
      }
    }));
  }
  return { map, pending };
}

// ── rules ───────────────────────────────────────────────────────────────────────────────────────

function parseDefaults(config) {
  let cfg = {};
  try { cfg = typeof config === 'string' ? JSON.parse(config) : (config || {}); } catch { cfg = {}; }
  const d = cfg.attributeDefaults || {};
  const rules = (Array.isArray(d.rules) ? d.rules : [])
    .map((r) => ({ name: String(r?.name || '').trim().slice(0, 200), value: String(r?.value || '').trim().slice(0, 120) }))
    .filter((r) => r.name && r.value);
  const fbValue = String(d.fallback?.value || '').trim().slice(0, 120);
  return { rules, fallback: { enabled: !!d.fallback?.enabled && fbValue !== '', value: fbValue }, saved: !!cfg.attributeDefaults };
}

/** What the page offers before anything is saved (the owner's wish: Menşei TR, colour "Çok Renkli", everything else "Belirtilmemiş"). */
const SUGGESTED = {
  rules: [{ name: 'Menşei', value: 'TR' }, { name: 'Renk, Web Color', value: 'Çok Renkli' }],
  fallback: { enabled: true, value: 'Belirtilmemiş' },
};

function compile(defaults) {
  const byName = new Map();
  for (const r of defaults.rules) for (const n of r.name.split(',')) { const k = normText(n); if (k && !byName.has(k)) byName.set(k, r.value); }
  const fallback = defaults.fallback.enabled ? defaults.fallback.value : null;
  return {
    /** the answer wanted for an attribute, or null (no rule and no fallback) */
    valueFor(attrName) { return byName.get(normText(attrName)) || fallback; },
    empty: byName.size === 0 && !fallback,
  };
}

/**
 * The wanted text as something Trendyol accepts for this attribute, or null.
 * `wanted` may list alternatives separated by "|" ("Belirtilmemiş | Diğer"): the first one found in the attribute's value
 * list wins; when none is in the list, the first one is used as free text if the attribute allows it.
 */
function resolveValue(def, wanted) {
  const options = String(wanted).split('|').map((x) => x.trim()).filter(Boolean);
  for (const opt of options) {
    const t = normText(opt);
    const hit = (def.values || []).find((v) => normText(v.name) === t);
    if (hit) return { valueId: String(hit.id), valueName: hit.name };
  }
  if (def.allowCustom && options.length) return { valueId: '', valueName: options[0] };
  return null;
}

const hasVal = (v) => !!(v && (v.valueId || (v.valueName && String(v.valueName).trim())));
const parseJson = (s) => { try { const o = s ? JSON.parse(s) : {}; return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

/**
 * New attribute JSON of one product group.
 *   kept as they are: values typed by hand, and optional attributes
 *   copied: values of a category mapping of the same Trendyol category
 *   (re)computed: everything else from the rules (auto: true); an auto value whose rule is gone is dropped
 * @returns { json, auto, unresolved: [attribute names left empty] }
 */
function computeAttributes(defs, existingJson, mappingJson, compiled) {
  const ex = parseJson(existingJson);
  const mp = parseJson(mappingJson);
  const required = new Set(defs.map((d) => String(d.id)));
  const res = {};
  for (const [id, v] of Object.entries(ex)) if (!required.has(id) && hasVal(v) && !v.auto) res[id] = v;
  let auto = 0;
  const unresolved = [];
  for (const d of defs) {
    const id = String(d.id);
    if (hasVal(ex[id]) && !ex[id].auto) { res[id] = ex[id]; continue; }
    if (hasVal(mp[id])) { res[id] = { name: d.name, valueId: mp[id].valueId || '', valueName: mp[id].valueName || '' }; continue; }
    const want = compiled.valueFor(d.name);
    const r = want ? resolveValue(d, want) : null;
    if (r) { res[id] = { name: d.name, ...r, auto: true }; auto++; } else unresolved.push(d.name);
  }
  return { json: Object.keys(res).length ? JSON.stringify(res) : null, auto, unresolved };
}

/**
 * Applies the connection's default answers to every product that has one of the given categories.
 * Network (Trendyol attribute lists) is bounded by `budgetMs`; what is not reached is reported as `pending`.
 * @returns { categories, products, unresolved: [{ name, categories }], pending }
 */
async function fillCategories(connection, categoryIds, { budgetMs = 20000 } = {}) {
  const compiled = compile(parseDefaults(connection.config));
  const started = Date.now();
  let todo = [...new Set(categoryIds.map(String))];
  const out = { categories: 0, products: 0, unresolved: [], pending: 0 };
  if (todo.length === 0) return out;

  const mappings = await prisma.categoryMapping.findMany({ where: { connectionId: connection.id }, select: { marketplaceCategoryId: true, attributes: true } });
  const mapByCat = new Map();
  for (const m of mappings) { const k = String(m.marketplaceCategoryId); if (Object.values(parseJson(m.attributes)).some(hasVal) && !mapByCat.has(k)) mapByCat.set(k, m.attributes); }

  const unresolved = new Map(); // attribute name -> number of categories where it stayed empty
  let notFetched = 0;
  while (todo.length && Date.now() - started < budgetMs) {
    const batch = todo.slice(0, 60);
    todo = todo.slice(60);
    const { map, pending } = await loadRequiredDefs(connection, batch, { max: 60 });
    notFetched += pending;
    for (const catId of batch) {
      const defs = map.get(catId);
      if (!defs) { notFetched++; continue; }
      const rows = await prisma.productCategoryOverride.findMany({ where: { connectionId: connection.id, marketplaceCategoryId: catId }, select: { id: true, attributes: true } });
      const groups = new Map(); // current attributes JSON -> row ids
      for (const r of rows) { const k = r.attributes || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r.id); }
      const seenUnresolved = new Set();
      for (const [current, ids] of groups) {
        const res = computeAttributes(defs, current || null, mapByCat.get(catId) || null, compiled);
        res.unresolved.forEach((n) => seenUnresolved.add(n));
        if ((res.json || '') !== current) {
          await prisma.productCategoryOverride.updateMany({ where: { id: { in: ids } }, data: { attributes: res.json } });
          out.products += ids.length;
        }
      }
      out.categories++;
      for (const n of seenUnresolved) unresolved.set(n, (unresolved.get(n) || 0) + 1);
    }
  }
  out.pending = todo.length + notFetched;
  out.unresolved = [...unresolved].map(([name, categories]) => ({ name, categories })).sort((a, b) => b.categories - a.categories);
  return out;
}

module.exports = { loadRequiredDefs, parseDefaults, compile, resolveValue, computeAttributes, fillCategories, SUGGESTED, hasVal };
