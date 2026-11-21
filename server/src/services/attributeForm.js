const { normText } = require('./categoryMatcher');
const { pickValue } = require('./attributeFromText');

/**
 * The REQUIRED attributes of a Trendyol category as a form for ONE product (the "Yeni ürün" form): every attribute with its allowed values and,
 * where one is known, a first answer the owner can change. The first answer comes from, in this order:
 *   1. page    what a Trendyol product page said (a link import): matched to the allowed values, never guessed
 *   2. title / description   what the product's own text says (the same careful reader as the bulk step: attributeFromText.pickValue)
 *   3. default   the connection's default answers (Menşei -> TR, ...: attributeDefaults)
 * Nothing is invented: an attribute without a safe answer is left empty for the owner.
 */

const MAX_VALUES = 600;     // values sent to the page per attribute; longer lists (authors, publishers) are cut and flagged

const trim = (s) => String(s == null ? '' : s).trim();

/** The value of the page's attribute `hint` for this attribute, matched to the allowed values (exact name first, then one value named inside the text, free text only if allowed). */
function fromHint(def, hints) {
  const key = normText(def.name);
  if (!key) return null;
  const hint = (hints || []).find((h) => {
    const k = normText(h && h.name);
    if (!k) return false;
    return k === key || (k.length >= 4 && key.length >= 4 && (k.includes(key) || key.includes(k)));
  });
  if (!hint) return null;
  const text = trim(hint.value);
  if (!text) return null;
  const exact = (def.values || []).find((v) => normText(v.name) === normText(text));
  if (exact) return { valueId: String(exact.id), valueName: exact.name };
  const inside = pickValue({ ...def, name: 'x' }, text, '');   // a value of the list named inside the text ("Seramik, Porselen" is ambiguous: nothing)
  if (inside) return { valueId: inside.valueId, valueName: inside.valueName };
  if (def.allowCustom) return { valueId: '', valueName: text.slice(0, 120) };
  return null;
}

/**
 * @param defs     [{ id, name, allowCustom, values: [{ id, name }] }] required attributes of the category (attributeDefaults.loadRequiredDefs)
 * @param opts     { title, description, hints: [{ name, value }], defaults: { valueFor(name) } (attributeDefaults.compile), resolveValue }
 * @returns [{ id, name, allowCustom, values, truncated, answer: { valueId, valueName, from } | null }]
 */
function buildForm(defs, { title = '', description = '', hints = [], defaults = null, resolveValue = null } = {}) {
  const out = [];
  for (const d of defs || []) {
    let answer = null;
    const h = fromHint(d, hints);
    if (h) answer = { ...h, from: 'page' };
    if (!answer) {
      const p = pickValue(d, title, description);
      if (p) answer = { valueId: p.valueId, valueName: p.valueName, from: p.from };
    }
    if (!answer && defaults && resolveValue) {
      const want = defaults.valueFor(d.name);
      const r = want ? resolveValue(d, want) : null;
      if (r) answer = { ...r, from: 'default' };
    }
    const all = d.values || [];
    let values = all.slice(0, MAX_VALUES).map((v) => ({ id: String(v.id), name: v.name }));
    if (answer && answer.valueId && !values.some((v) => v.id === String(answer.valueId))) values = [{ id: String(answer.valueId), name: answer.valueName }, ...values];
    out.push({ id: String(d.id), name: d.name, allowCustom: !!d.allowCustom, values, truncated: all.length > MAX_VALUES, answer });
  }
  return out;
}

/**
 * Validates what the form posted for one product against the category's required attributes and merges it into the product's own attribute JSON.
 * A value is `from: 'form'`: it belongs to this product only (never shared with the other products of the category) and the default answers never replace it.
 * @param items  [{ id, valueId?, valueName? }]  valueId from the allowed list, or free text (valueName) when the attribute allows it
 * @returns { json, saved, skipped: [attribute names] }
 */
function mergeFormValues(defs, currentJson, items) {
  let current = {};
  try { const o = currentJson ? JSON.parse(currentJson) : {}; current = o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { current = {}; }
  const byId = new Map((defs || []).map((d) => [String(d.id), d]));
  let saved = 0; const skipped = [];
  for (const it of Array.isArray(items) ? items : []) {
    const def = byId.get(String(it && it.id));
    if (!def) continue;
    const valueId = trim(it.valueId);
    const text = trim(it.valueName).slice(0, 120);
    if (valueId) {
      const v = (def.values || []).find((x) => String(x.id) === valueId);
      if (!v) { skipped.push(def.name); continue; }
      current[String(def.id)] = { name: def.name, valueId: String(v.id), valueName: v.name, from: 'form' };
      saved++;
    } else if (text && def.allowCustom) {
      current[String(def.id)] = { name: def.name, valueId: '', valueName: text, from: 'form' };
      saved++;
    } else if (text) skipped.push(def.name);          // free text is not accepted for this attribute
  }
  return { json: Object.keys(current).length ? JSON.stringify(current) : null, saved, skipped };
}

module.exports = { buildForm, mergeFormValues, fromHint, MAX_VALUES };
