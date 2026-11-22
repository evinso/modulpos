const db = require('../db');
const V = require('../lib/validate');
const { HttpError, bad } = require('../lib/http');
const { tokens, matchTerms, fold } = require('../lib/text');
const { matchExcluded } = require('./projects');
const projects = require('./projects');
const runs = require('./runs');

/**
 * "Niş Önerileri": subjects that keep showing up in the headlines of the project's own sources but are NOT covered by any category yet.
 * Found by counting word pairs in recent headlines that the niche filter did NOT accept (and no excluded topic caught): a pair that appears in many headlines from
 * several different sources is worth a person's look. Nothing is ever added by itself: a person accepts (new category / terms added to a category), rejects, or decides later.
 * The method is plain counting; it finds recurring subjects, it does not judge whether they fit the site.
 */
const BOT = 'niche_discovery';
const GENERIC = new Set(['year', 'time', 'say', 'make', 'use', 'people', 'world', 'back', 'long', 'work', 'show', 'take', 'look', 'plan', 'list', 'best', 'top', 'big', 'high', 'low', 'good', 'last', 'next', 'old', 'real', 'full', 'open', 'set', 'run', 'face', 'hit', 'end', 'call', 'help', 'need', 'find', 'give', 'keep', 'start', 'turn', 'move', 'live', 'game', 'news', 'report', 'week', 'day', 'month', 'company', 'market', 'state', 'city', 'group', 'team', 'deal', 'case', 'lead', 'build', 'win', 'lose', 'play']);

function pairs(title) {
  const t = tokens(title).filter((x) => !GENERIC.has(x) && !/^\d+$/.test(x) && x.length >= 3);
  const out = new Set();
  for (let i = 0; i + 1 < t.length; i++) out.add(`${t[i]} ${t[i + 1]}`);
  return out;
}
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

async function discover(projectId, { days = 14, minItems = 5, minSources = 3, now = new Date(), userId = null, trigger = 'manual' } = {}) {
  const run = await runs.start(BOT, { projectId, trigger, userId });
  try {
    const items = (await db.query(`SELECT title, url, source_name FROM news_items WHERE project_id = $1 AND status = 'irrelevant'
      AND coalesce(published_at, fetched_at) > $2::timestamptz - ($3 || ' days')::interval`, [projectId, now, String(days)])).rows;
    const cats = (await db.query("SELECT related_keywords FROM categories WHERE project_id = $1 AND status <> 'archived'", [projectId])).rows;
    const covered = cats.flatMap((c) => c.related_keywords);
    const ex = (await db.query('SELECT topic FROM excluded_topics WHERE project_id = $1 AND is_active', [projectId])).rows.map((r) => r.topic);
    const sugg = (await db.query('SELECT lower(label) l, terms FROM niche_suggestions WHERE project_id = $1', [projectId])).rows;
    const known = new Set(sugg.map((r) => r.l));
    const knownWords = new Set(sugg.flatMap((r) => [r.l, ...r.terms]).flatMap((t) => String(t).toLowerCase().split(' ')));       // a pair that shares a word with an earlier suggestion is the same subject
    const stat = new Map();
    for (const it of items) {
      for (const p of pairs(it.title)) {
        let s = stat.get(p); if (!s) { s = { items: 0, sources: new Set(), samples: [] }; stat.set(p, s); }
        s.items++; s.sources.add(String(it.source_name).toLowerCase()); if (s.samples.length < 3) s.samples.push({ title: it.title, url: it.url, source: it.source_name });
      }
    }
    const found = [...stat].filter(([term, s]) => s.items >= minItems && s.sources.size >= minSources && !known.has(term) && !term.split(' ').some((w) => knownWords.has(w)) && !matchTerms(term, covered).length && !matchExcluded(term, ex).length)
      .sort((a, b) => b[1].items * b[1].sources.size - a[1].items * a[1].sources.size);
    // keep one suggestion per cluster of overlapping pairs ("smart home", "home security" ...): skip a pair that shares a word with a better one
    const picked = []; const used = new Set();
    for (const [term, s] of found) { const w = term.split(' '); if (w.some((x) => used.has(x))) continue; w.forEach((x) => used.add(x)); picked.push([term, s]); if (picked.length >= 15) break; }
    let created = 0;
    for (const [term, s] of picked) {
      const r = await db.query('INSERT INTO niche_suggestions (project_id, label, terms, evidence) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [projectId, titleCase(term), [term], JSON.stringify({ items: s.items, sources: s.sources.size, days, samples: s.samples })]);
      created += r.rowCount;
    }
    await runs.finish(run.id, { status: 'ok', stats: { scanned: items.length, candidates: found.length, created } });
    return { scanned: items.length, candidates: found.length, created };
  } catch (err) { await runs.finish(run.id, { status: 'error', error: err.message }); throw err; }
}

const shape = (r) => ({ id: r.id, projectId: r.project_id, label: r.label, terms: r.terms, evidence: r.evidence, status: r.status, linkedCategoryId: r.linked_category_id, decidedAt: r.decided_at, createdAt: r.created_at });

async function list(projectId, { status } = {}) {
  const p = [projectId]; let w = '';
  if (status) { p.push(V.oneOf(status, 'Durum', ['new', 'accepted', 'rejected', 'later'])); w = 'AND status = $2'; }
  const rows = (await db.query(`SELECT * FROM niche_suggestions WHERE project_id = $1 ${w} ORDER BY (status = 'new') DESC, (evidence->>'items')::int DESC, created_at DESC`, p)).rows;
  return rows.map(shape);
}

/**
 * @param body { action: 'accept' | 'reject' | 'later', mode: 'new_category' | 'link_category', categoryId, name, nameEn }
 * accept + new_category: creates the category (0% share, a person gives it a share); accept + link_category: adds the terms to that category's keywords
 */
async function decide(id, body, { userId = null } = {}) {
  const s = (await db.query('SELECT * FROM niche_suggestions WHERE id = $1', [id])).rows[0];
  if (!s) throw new HttpError(404, 'Öneri bulunamadı');
  const action = V.oneOf(body.action, 'İşlem', ['accept', 'reject', 'later']);
  let linked = null;
  if (action === 'accept') {
    const mode = V.oneOf(body.mode, 'Kabul şekli', ['new_category', 'link_category']);
    if (mode === 'new_category') {
      const cat = await projects.createCategory(s.project_id, { name: V.str(body.name || s.label, 'Kategori adı', { required: true, max: 120 }), nameEn: V.str(body.nameEn || s.label, 'İngilizce ad', { required: true, max: 120 }), relatedKeywords: s.terms, scope: `Öneriden oluşturuldu: ${s.label}` });
      linked = cat.id;
    } else {
      const cid = V.uuid(body.categoryId, 'Kategori');
      const c = (await db.query('SELECT id, project_id, related_keywords, status FROM categories WHERE id = $1', [cid])).rows[0];
      if (!c || c.project_id !== s.project_id) throw bad('Kategori bu projeye ait değil'); if (c.status === 'archived') throw bad('Arşivlenmiş kategoriye eklenemez');
      const merged = [...new Set([...c.related_keywords, ...s.terms])];
      await db.query('UPDATE categories SET related_keywords = $1, updated_at = now() WHERE id = $2', [merged, cid]); linked = cid;
    }
  }
  const status = { accept: 'accepted', reject: 'rejected', later: 'later' }[action];
  return shape((await db.query('UPDATE niche_suggestions SET status = $2, linked_category_id = COALESCE($3, linked_category_id), decided_by = $4, decided_at = now() WHERE id = $1 RETURNING *', [id, status, linked, userId])).rows[0]);
}

module.exports = { BOT, discover, list, decide, pairs };
