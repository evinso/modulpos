const db = require('../db');
const V = require('../lib/validate');
const { HttpError } = require('../lib/http');
const articles = require('./articles');
const refresh = require('./refresh');

/**
 * Internal link suggestions between the project's own articles. Deterministic (no model, free):
 *  - a target article is linked from another one where that article ALREADY says the target's focus phrase (or one of its secondary keywords, two words or more): the anchor is
 *    those exact words, so the link reads naturally and no sentence is rewritten
 *  - never inside a heading or an existing link, never twice to the same target, never when the article already links to it, at most 3 per article and one per target
 *  - a suggestion is a DRAFT until the target has a public address; "apply" needs that address and is a person's decision (admin); it inserts the link as a new version of the article
 *    WITHOUT withdrawing the fact check (not one word of the content changed) and updates the post on the site
 *  - direction: new -> old (a new article linking to an older one) and old -> new (an older article gets a link to a newer one) are both found and labelled
 */
const LIVE = ['published', 'scheduled', 'ready', 'needs_update'];
const MAX_PER_ARTICLE = 3;

/** HTML as a list of pieces: tags and text, with whether each text piece sits inside a link or a heading */
function pieces(html) {
  const out = []; let a = 0; let h = 0;
  for (const part of String(html || '').split(/(<[^>]+>)/)) {
    if (!part) continue;
    if (part[0] === '<') {
      const m = /^<(\/?)([a-z0-9]+)/i.exec(part);
      if (m) { const tag = m[2].toLowerCase(); const close = m[1] === '/'; if (tag === 'a') a += close ? -1 : 1; if (/^h[1-6]$/.test(tag)) h += close ? -1 : 1; }
      out.push({ tag: true, text: part });
    } else out.push({ tag: false, text: part, locked: a > 0 || h > 0 });
  }
  return out;
}

/** the first place in the free text of the HTML where `phrase` stands as whole words: { anchor (as written), sentence } or null */
function findAnchor(html, phrase) {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${phrase.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')})(?![\\p{L}\\p{N}])`, 'iu');
  for (const p of pieces(html)) {
    if (p.tag || p.locked) continue;
    const m = re.exec(p.text); if (!m) continue;
    const at = m.index + m[1].length; const start = Math.max(p.text.lastIndexOf('.', at) + 1, 0); const endDot = p.text.indexOf('.', at + m[2].length);
    return { anchor: m[2], sentence: p.text.slice(start, endDot < 0 ? undefined : endDot + 1).replace(/\s+/g, ' ').trim().slice(0, 300) };
  }
  return null;
}

/** the HTML with the first free-text occurrence of `anchor` wrapped in a link; null when it is not there (any more) */
function insertLink(html, anchor, url) {
  let done = false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')})(?![\\p{L}\\p{N}])`, 'u');
  const out = pieces(html).map((p) => {
    if (done || p.tag || p.locked) return p.text;
    const m = re.exec(p.text); if (!m) return p.text;
    done = true; const i = m.index + m[1].length;
    return `${p.text.slice(0, i)}<a href="${url.replace(/"/g, '%22')}">${m[2]}</a>${p.text.slice(i + m[2].length)}`;
  });
  return done ? out.join('') : null;
}

const hasLinkTo = (html, a) => { const h = String(html || ''); return h.includes(`/${a.slug}/`) || h.includes(`/${a.slug}"`) || Boolean(a.url && h.includes(a.url)); };
const phrasesOf = (a) => [[a.focus_keyword, 10], ...(a.secondary_keywords || []).map((k) => [k, 0])].map(([p, b]) => [String(p || '').trim(), b]).filter(([p]) => p.split(/\s+/).length >= 2 && p.length >= 6);

/** the public address of an article: its newest published post */
async function publicUrls(ids) {
  const rows = (await db.query("SELECT DISTINCT ON (article_id) article_id, wp_url FROM publications WHERE article_id = ANY($1) AND status = 'published' AND wp_url IS NOT NULL ORDER BY article_id, updated_at DESC", [ids])).rows;
  return new Map(rows.map((r) => [r.article_id, r.wp_url]));
}

/** Finds new suggestions for the project and stores them (existing decisions are never touched). @returns { created, refreshed, articles } */
async function suggest(projectId, { now = new Date() } = {}) {
  const arts = (await db.query('SELECT id, h1, slug, focus_keyword, secondary_keywords, content_html, category_id, created_at, status FROM articles WHERE project_id = $1 AND status = ANY($2) ORDER BY created_at LIMIT 300', [projectId, LIVE])).rows;
  const urls = await publicUrls(arts.map((a) => a.id)); const found = [];
  for (const from of arts) {
    const picks = []; const usedAnchors = new Set();
    for (const to of arts) {
      if (to.id === from.id || hasLinkTo(from.content_html, { slug: to.slug, url: urls.get(to.id) })) continue;
      let best = null;
      for (const [phrase, bonus] of phrasesOf(to)) {
        const hit = findAnchor(from.content_html, phrase); if (!hit || usedAnchors.has(hit.anchor.toLowerCase())) continue;
        const score = Math.min(100, 50 + 10 * phrase.split(/\s+/).length + bonus + (from.category_id && from.category_id === to.category_id ? 15 : 0));
        if (!best || score > best.score) best = { to: to.id, ...hit, score, direction: new Date(to.created_at) > new Date(from.created_at) ? 'old_to_new' : 'new_to_old' };
      }
      if (best) picks.push(best);
    }
    picks.sort((x, y) => y.score - x.score);
    for (const p of picks) { if (usedAnchors.has(p.anchor.toLowerCase())) continue; usedAnchors.add(p.anchor.toLowerCase()); found.push({ from: from.id, ...p }); if (usedAnchors.size >= MAX_PER_ARTICLE) break; }
  }
  if (!found.length) return { created: 0, refreshed: 0, articles: arts.length };
  const r = await db.query(`INSERT INTO internal_links (project_id, from_article_id, to_article_id, anchor, context, direction, score, created_at, updated_at)
    SELECT $1, x.from_id, x.to_id, x.anchor, x.context, x.direction, x.score, $3, $3 FROM jsonb_to_recordset($2::jsonb) AS x(from_id uuid, to_id uuid, anchor text, context text, direction text, score int)
    ON CONFLICT (from_article_id, to_article_id) DO UPDATE SET anchor = EXCLUDED.anchor, context = EXCLUDED.context, direction = EXCLUDED.direction, score = EXCLUDED.score, status = 'suggested', updated_at = $3
      WHERE internal_links.status IN ('suggested', 'stale') RETURNING (xmax = 0) AS inserted`, [projectId, JSON.stringify(found.map((f) => ({ from_id: f.from, to_id: f.to, anchor: f.anchor, context: f.sentence, direction: f.direction, score: f.score }))), now]);
  return { created: r.rows.filter((x) => x.inserted).length, refreshed: r.rows.filter((x) => !x.inserted).length, articles: arts.length };
}

const shape = (r, urls) => ({ id: r.id, projectId: r.project_id, fromArticleId: r.from_article_id, fromTitle: r.from_h1, toArticleId: r.to_article_id, toTitle: r.to_h1, anchor: r.anchor, context: r.context, direction: r.direction, score: r.score, status: r.status,
  toUrl: urls.get(r.to_article_id) || null, draft: !urls.get(r.to_article_id), appliedVersion: r.applied_version, createdAt: r.created_at });

async function list(projectId, { status = 'suggested', limit = 100 } = {}) {
  const st = V.oneOf(status, 'Durum', ['suggested', 'applied', 'rejected', 'stale']);
  const rows = (await db.query(`SELECT l.*, f.h1 AS from_h1, t.h1 AS to_h1 FROM internal_links l JOIN articles f ON f.id = l.from_article_id JOIN articles t ON t.id = l.to_article_id WHERE l.project_id = $1 AND l.status = $2 ORDER BY l.score DESC, l.created_at DESC LIMIT $3`, [projectId, st, Math.min(300, limit | 0 || 100)])).rows;
  const urls = await publicUrls([...new Set(rows.map((r) => r.to_article_id))]);
  return rows.map((r) => shape(r, urls));
}

/** Puts the link into the article (a person's decision). Needs the target's public address; the article keeps its checks (no word changed). */
async function apply(id, { userId = null, now = new Date() } = {}) {
  const l = (await db.query('SELECT * FROM internal_links WHERE id = $1', [V.uuid(id, 'Öneri')])).rows[0];
  if (!l) throw new HttpError(404, 'Bağlantı önerisi bulunamadı');
  if (l.status !== 'suggested') throw new HttpError(409, `Bu öneri zaten “${l.status}” durumunda`);
  const url = (await publicUrls([l.to_article_id])).get(l.to_article_id);
  if (!url) throw new HttpError(409, 'Hedef makale henüz yayında değil (herkese açık adresi yok): öneri taslak olarak saklanır, hedef yayımlanınca uygulanabilir');
  const a = (await db.query('SELECT id, status, content_html, slug FROM articles WHERE id = $1', [l.from_article_id])).rows[0];
  if (!a || ['generating', 'updating'].includes(a.status)) throw new HttpError(409, 'Makale şu anda işleniyor; sonra deneyin');
  if (hasLinkTo(a.content_html, { slug: '__none__', url })) { await db.query("UPDATE internal_links SET status = 'stale', updated_at = now() WHERE id = $1", [l.id]); throw new HttpError(409, 'Makale bu adrese zaten bağlantı veriyor'); }
  const html = insertLink(a.content_html, l.anchor, url);
  if (!html) { await db.query("UPDATE internal_links SET status = 'stale', updated_at = now() WHERE id = $1", [l.id]); throw new HttpError(409, 'Bağlantı yeri artık metinde yok (makale değişmiş); öneri eskidi, yeniden arayın'); }
  const upd = await articles.update(a.id, { contentHtml: html, reason: `İç bağlantı: “${l.anchor}”` }, { userId, by: 'ai', preserveChecks: true });
  await db.query("UPDATE internal_links SET status = 'applied', applied_version = $2, updated_at = $3 WHERE id = $1", [l.id, upd.currentVersion, now]);
  const wp = await refresh.pushToSites(a.id, { userId, now });
  return { link: (await list(l.project_id, { status: 'applied' })).find((x) => x.id === l.id), wp };
}

async function reject(id) {
  const r = await db.query("UPDATE internal_links SET status = 'rejected', updated_at = now() WHERE id = $1 AND status = 'suggested'", [V.uuid(id, 'Öneri')]);
  if (!r.rowCount) throw new HttpError(409, 'Yalnızca bekleyen öneri reddedilebilir');
}

/** how many articles of the project nothing links to (a hint for the health page) */
async function orphans(projectId) {
  const arts = (await db.query('SELECT id, slug, content_html FROM articles WHERE project_id = $1 AND status = ANY($2)', [projectId, LIVE])).rows;
  const urls = await publicUrls(arts.map((a) => a.id));
  return arts.filter((t) => !arts.some((f) => f.id !== t.id && hasLinkTo(f.content_html, { slug: t.slug, url: urls.get(t.id) }))).map((a) => a.id);
}

module.exports = { LIVE, pieces, findAnchor, insertLink, hasLinkTo, suggest, list, apply, reject, orphans };
