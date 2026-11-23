const db = require('../db');
const T = require('../lib/textStats');
const { normUrl, hostOf } = require('../lib/seoStructure');

/**
 * What the writer and the rules need to know about the project's OWN site for internal links: the addresses it lives on and the public addresses of its published articles.
 * Read only. Kept apart from internalLinks.js (which edits articles and so depends on the refresh engine) so the rules can use it without a circular dependency.
 */
const STOP = new Set('the and for with from that this what when where which will your you are was were has have had how why who its into about over after before more most new not can may does did but than then them they their there these those just also very being been out off our any all one two via per vs'.split(' '));

/** @returns { hosts: [hostname], urls: [normalised public address] } of the project's connected WordPress sites and published articles */
async function siteInfo(projectId) {
  const [sitesQ, pubQ] = await Promise.all([
    db.query("SELECT api_url, domain FROM wp_sites WHERE project_id = $1 AND status = 'active'", [projectId]),
    db.query("SELECT DISTINCT wp_url FROM publications WHERE project_id = $1 AND status = 'published' AND wp_url IS NOT NULL", [projectId]),
  ]);
  const hosts = new Set();
  for (const r of sitesQ.rows) { const h = hostOf(r.api_url) || hostOf(`https://${r.domain || ''}`); if (h) hosts.add(h); }
  return { hosts: [...hosts], urls: [...new Set(pubQ.rows.map((r) => normUrl(r.wp_url)).filter(Boolean))] };
}

const keyWords = (s) => T.words(s).filter((w) => w.length >= 4 && !STOP.has(w));

/**
 * Published articles of the project that this new article could honestly link to: they share meaningful words with its focus keyword / title (at least one real word,
 * the more the better). Never more than `limit`; an empty list is normal for a young site. @returns [{ id, title, url, shared }]
 */
async function relatedFor(projectId, { focus = '', title = '', limit = 5 } = {}) {
  const rows = (await db.query(`SELECT DISTINCT ON (a.id) a.id, a.h1, a.focus_keyword, a.secondary_keywords, p.wp_url
    FROM articles a JOIN publications p ON p.article_id = a.id AND p.status = 'published' AND p.wp_url IS NOT NULL
    WHERE a.project_id = $1 AND a.status IN ('published', 'needs_update') ORDER BY a.id, p.updated_at DESC LIMIT 300`, [projectId])).rows;
  const mine = new Set(keyWords(`${focus} ${title}`));
  if (!mine.size) return [];
  return rows.map((r) => {
    const theirs = new Set(keyWords(`${r.h1} ${r.focus_keyword} ${(r.secondary_keywords || []).join(' ')}`));
    const shared = [...mine].filter((w) => theirs.has(w)).length;
    return { id: r.id, title: r.h1, url: r.wp_url, shared };
  }).filter((x) => x.shared > 0).sort((a, b) => b.shared - a.shared).slice(0, limit);
}

module.exports = { siteInfo, relatedFor, keyWords };
