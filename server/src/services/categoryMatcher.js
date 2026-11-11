/**
 * Free, rule-based Trendyol category suggestions for ONE product (no AI, no cost).
 *
 * The XML category of a feed is often far too broad ("Ev ve Yaşam", 800 products), so the product title is
 * the main signal; the XML category path only adds weight. Words are compared by their first 5 letters
 * (Turkish suffixes: Oyuncak / Oyuncağı / Oyuncakları) after folding Turkish letters.
 *
 * suggest() returns the best candidates with a score and a `coverage` (share of the category's own words found
 * in the product text). On its own this is NOT reliable enough to assign categories silently: the page shows the
 * candidates to the user, and the paid AI step only chooses among them.
 */

const TR = { 'İ': 'i', 'I': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ğ': 'g', 'ğ': 'g', 'Ü': 'u', 'ü': 'u', 'Ö': 'o', 'ö': 'o', 'Ç': 'c', 'ç': 'c' };

// Words that say nothing about WHAT the product is
const STOP = new Set([
  've', 'ile', 'icin', 'adet', 'set', 'urun', 'urunu', 'urunleri', 'diger', 'aksesuar', 'aksesuari', 'aksesuarlari',
  'malzeme', 'malzemesi', 'malzemeleri', 'aletleri', 'ev', 'yasam', 'cm', 'mm', 'ml', 'gr', 'kg', 'model', 'renk',
  'bir', 'cok', 'amacli', 'tv', 'shop', 'pratik', 'ozel', 'yeni', 'orijinal', 'kaliteli', 'buyuk', 'kucuk', 'mini',
  'the', 'for', 'and', 'with', 'li', 'lu', 'parca', 'parcali', 'ayrica',
]);

function normText(s) {
  return String(s ?? '')
    .replace(/&amp;/gi, ' ')
    .replace(/[İIıŞşĞğÜüÖöÇç]/g, (c) => TR[c])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const stem = (w) => (w.length > 5 ? w.slice(0, 5) : w);

/** Distinct stemmed words of a text, without stop words, short words and bare numbers. */
function tokens(s) {
  const out = new Set();
  for (const w of normText(s).split(' ')) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(stem(w));
  }
  return [...out];
}

/** Flattens the Trendyol tree into leaves: [{ id, name, path, parts }] */
function flattenLeaves(categories) {
  const leaves = [];
  const walk = (list, prefix) => {
    for (const c of list || []) {
      const path = prefix ? `${prefix} > ${c.name}` : c.name;
      if (!c.subCategories || c.subCategories.length === 0) leaves.push({ id: c.id, name: c.name, path, parts: path.split(' > ') });
      else walk(c.subCategories, path);
    }
  };
  walk(Array.isArray(categories) ? categories : [categories], '');
  return leaves;
}

class CategoryMatcher {
  constructor(leaves) {
    this.leaves = leaves;
    this.byId = new Map(leaves.map((l) => [String(l.id), l]));
    this.index = new Map();   // token -> [leaf]
    const df = new Map();
    for (const l of leaves) {
      l.nameT = tokens(l.name);
      l.upT = new Set(tokens(l.parts.slice(0, -1).join(' ')));
      l.nameSet = new Set(l.nameT);
      l.norm = normText(l.path);
      for (const t of new Set([...l.nameT, ...l.upT])) {
        df.set(t, (df.get(t) || 0) + 1);
        if (!this.index.has(t)) this.index.set(t, []);
        this.index.get(t).push(l);
      }
    }
    this.df = df;
    this.total = leaves.length;
  }

  idf(t) { return Math.log(1 + this.total / (this.df.get(t) || 1)); }

  get(id) { return this.byId.get(String(id)) || null; }

  /**
   * @param title     product title (main signal)
   * @param context   optional extra text, e.g. the XML category path (weaker signal)
   * @returns [{ id, name, path, score, coverage }] best first
   */
  suggest(title, { context = '', top = 5 } = {}) {
    const T = tokens(title);
    const C = tokens(context).filter((t) => !T.includes(t));
    if (T.length === 0 && C.length === 0) return [];

    const cand = new Set();
    for (const t of [...T, ...C]) for (const l of this.index.get(t) || []) cand.add(l);

    const out = [];
    for (const l of cand) {
      let s = 0;
      let hit = 0;
      const seen = new Set();
      for (const t of T) {
        if (l.nameSet.has(t)) { s += 3 * this.idf(t); seen.add(t); }
        else if (l.upT.has(t)) s += 0.7 * this.idf(t);
      }
      for (const t of C) {
        if (l.nameSet.has(t)) { s += 1.5 * this.idf(t); seen.add(t); }
        else if (l.upT.has(t)) s += 0.35 * this.idf(t);
      }
      hit = seen.size;
      if (s <= 0 || hit === 0) continue; // the category's own name must share a word with the product
      const coverage = l.nameT.length ? hit / l.nameT.length : 0;
      s = (s / Math.sqrt(l.nameT.length + 1)) * (coverage === 1 ? 1.3 : 1);
      out.push({ id: l.id, name: l.name, path: l.path, score: Math.round(s * 1000) / 1000, coverage: Math.round(coverage * 100) / 100 });
    }
    out.sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.path.length - b.path.length);
    return out.slice(0, top);
  }

  /** Manual picker: leaves whose path contains every typed word (folded), best name matches first. */
  search(query, limit = 30) {
    const words = normText(query).split(' ').filter(Boolean);
    if (words.length === 0) return [];
    const out = [];
    for (const l of this.leaves) {
      if (!words.every((w) => l.norm.includes(w))) continue;
      const nameNorm = normText(l.name);
      const inName = words.filter((w) => nameNorm.includes(w)).length;
      out.push({ l, rank: inName * 10 - l.path.length / 100 + (nameNorm === words.join(' ') ? 50 : 0) });
    }
    out.sort((a, b) => b.rank - a.rank);
    return out.slice(0, limit).map(({ l }) => ({ id: l.id, name: l.name, path: l.path }));
  }
}

let shared = null;
/** The matcher over the bundled Trendyol tree (built once). */
function getMatcher() {
  if (!shared) {
    const data = require('../data/trendyolCategories');
    shared = new CategoryMatcher(flattenLeaves(data.categories || data));
  }
  return shared;
}

module.exports = { CategoryMatcher, getMatcher, flattenLeaves, tokens, normText };
