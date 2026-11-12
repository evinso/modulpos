/**
 * Free Trendyol category suggestions for the XML CATEGORIES of one source (the "Kategori eşleştirme" tab).
 *
 * The XML category name alone is a poor signal ("Ev ve Yaşam" can hold 800 different things), so each category is judged by
 * the titles of its products: up to `sample` titles spread over the whole category are run through the rule-based matcher
 * (categoryMatcher.js, same words-over-the-bundled-Trendyol-tree method as the product tab) and the answers are counted.
 *
 *   share  of a suggestion = the part of the sampled titles that have it among their own 3 best answers
 *   agree  of a category   = the part of the sampled titles whose BEST answer lies in the biggest Trendyol FAMILY (same parent
 *            category). Leaves that only differ by material or kind ("Çelik Kolye", "Zirkon Kolye") are one family, so a plain
 *            necklace category is not called mixed because its titles split over them.
 *   mixed  = the titles point to different families (agree is low): one Trendyol category will not fit them all,
 *            the product tab (a category per product) is the right place for it
 *
 *   weak   = fewer than 5 products: the evidence is too thin to trust (a 3-product "Kutu" category gets odd answers).
 *
 * When a category is NOT mixed its best suggestion is credible, and answers from a different top-level Trendyol category are
 * dropped as noise (a jewelry feed's "pirinç" = brass must not offer "Kuru Bakliyat > Pirinç" = rice).
 *
 * Like the matcher itself this is only a help: nothing is assigned from it, the user picks.
 */

const RANK_POINTS = [3, 2, 1];
const MIXED_BELOW = 0.4;
const WEAK_BELOW = 5;

/** The parent path of a leaf: "Takı & Mücevher > Kolye > Çelik Kolye" -> "Takı & Mücevher > Kolye" */
const familyOf = (path) => String(path || '').split(' > ').slice(0, -1).join(' > ');
const rootOf = (path) => String(path || '').split(' > ')[0];

/** Up to `n` items spread evenly over the list (not just the first ones: feeds are often sorted by something). */
function spread(list, n) {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}

/**
 * @param products [{ title, category }]  products of ONE source
 * @param matcher  CategoryMatcher
 * @returns [{ category, total, suggestions: [{ id, name, path, share }], agree, mixed, weak }] biggest category first
 */
function suggestForCategories(products, matcher, { sample = 30, top = 3 } = {}) {
  const groups = new Map();
  for (const p of products) {
    if (typeof p.category !== 'string' || p.category.trim() === '') continue;
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category).push(p.title || '');
  }

  const out = [];
  for (const [category, titles] of groups) {
    const picked = spread(titles, sample);
    const points = new Map();   // leaf id -> { leaf, points, seen }
    const families = new Map(); // family -> number of titles whose best answer lies in it
    let voters = 0;
    const add = (s, i, weight = 1) => {
      const cur = points.get(s.id) || { leaf: s, points: 0, seen: 0 };
      cur.points += (RANK_POINTS[i] || 0) * weight;
      points.set(s.id, cur);
      return cur;
    };

    for (const title of picked) {
      const found = matcher.suggest(title, { context: category, top: 3 });
      if (found.length === 0) continue;
      voters++;
      found.forEach((s, i) => { add(s, i).seen++; });
      const fam = familyOf(found[0].path);
      families.set(fam, (families.get(fam) || 0) + 1);
    }
    // the category's own name counts too (a quarter of the titles' weight, at least once): it decides small groups
    const byName = matcher.suggest(category, { top: 3 });
    const nameWeight = Math.max(1, Math.ceil(picked.length / 4));
    byName.forEach((s, i) => { add(s, i, nameWeight); });

    let ranked = [...points.values()].sort((a, b) => b.points - a.points || b.seen - a.seen || a.leaf.path.length - b.leaf.path.length).slice(0, top * 3);
    const best = ranked[0];
    const agree = best && voters > 0 ? Math.max(0, ...families.values()) / voters : 0;
    const mixed = !!best && voters >= 5 && agree < MIXED_BELOW;
    if (best && !mixed) ranked = ranked.filter((r) => rootOf(r.leaf.path) === rootOf(best.leaf.path));
    ranked = ranked.slice(0, top);
    out.push({
      category,
      total: titles.length,
      suggestions: ranked.map((r) => ({ id: r.leaf.id, name: r.leaf.name, path: r.leaf.path, share: voters > 0 ? Math.round((r.seen / voters) * 100) / 100 : 0 })),
      agree: Math.round(agree * 100) / 100,
      mixed,
      weak: titles.length < WEAK_BELOW,
    });
  }
  return out.sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, 'tr'));
}

module.exports = { suggestForCategories, spread, MIXED_BELOW, WEAK_BELOW };
