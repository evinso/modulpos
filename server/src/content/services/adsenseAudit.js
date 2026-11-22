const db = require('../db');
const V = require('../lib/validate');
const safeFetch = require('../lib/safeFetch');
const audit = require('../lib/siteAudit');
const { HttpError, bad } = require('../lib/http');
const { htmlToText, wordCount } = require('../lib/html');
const notifications = require('./notifications');

/**
 * AdSense site readiness audit (phase 7). It reads the PUBLIC pages of a WordPress site (home page, a few pages, robots.txt, ads.txt, the sitemap, WordPress's public
 * REST lists) through the SSRF-safe reader and turns them into the checks of lib/siteAudit.js. Free, read-only, about 30-45 requests to the site, never a login.
 *
 *  - an audit belongs to a project and to an ADDRESS: a connected site's, or any address typed in before the WordPress connection exists (a new domain)
 *  - one running audit per address; at most 20 audits per project and hour; the last 15 per address are kept
 *  - every audit stores what changed since the previous one; a required item that got worse raises a notification
 *  - nothing here decides what Google will do: the result is a checklist, never an approval (see lib/siteAudit.js)
 */
const KEEP = 15;
const HOURLY_LIMIT = 20;
const STALE_MINUTES = 10;
const VERDICT_LABEL = { unreachable: 'Site okunamadı', not_ready: 'Eksikler var', almost: 'Büyük eksik yok, uyarılar var', checks_clean: 'Otomatik kontroller temiz' };

/** "techupdatebrief.com", "https://www.example.com/blog/?x=1" -> "https://www.example.com/blog" (a scheme is added when missing; http is allowed on purpose: the audit reports it) */
function normalizeUrl(raw) {
  let t = String(raw || '').trim(); if (!t) throw bad('Site adresi gerekli');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = `https://${t}`;
  let u; try { u = new URL(t); } catch { throw bad('Site adresi geçerli değil (örn. https://siteniz.com)'); }
  if (!/^https?:$/.test(u.protocol)) throw bad('Yalnızca http ve https adresleri denetlenir');
  if (u.username || u.password) throw bad('Adreste kullanıcı adı/şifre olamaz');
  if (!u.hostname.includes('.') && !/^\[/.test(u.hostname) && u.hostname !== 'localhost') throw bad('Site adresi geçerli değil (örn. https://siteniz.com)');
  const path = u.pathname.replace(/\/(wp-json|wp-admin|wp-login\.php).*$/i, '').replace(/\/+$/, '');
  return `${u.protocol}//${u.host.toLowerCase()}${path}`;
}

async function readPage(url, { fetchText, timeoutMs = 15000, maxBytes = 3 * 1024 * 1024, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetchText(url, { timeoutMs, maxBytes, headers: { Accept: accept } });
    return { ok: true, status: r.status, body: r.body, html: r.body, finalUrl: r.url, headers: r.headers || {}, ms: Date.now() - t0 };
  } catch (err) {
    const ms = Date.now() - t0;
    if (err && err.code === 'http') return { ok: false, status: err.status, body: '', finalUrl: url, headers: {}, ms };
    if (err && err.code === 'rate_limited') return { ok: false, status: err.status, error: `Site istek sınırı koydu ya da bakımda (HTTP ${err.status})`, ms };
    return { ok: false, status: null, error: (err && err.message) || 'Bağlanılamadı', errorCode: err && err.code, ms };
  }
}

const json = (r) => { if (!r || !r.ok) return null; try { return JSON.parse(r.body); } catch { return null; } };

/** Reads the public pages of a site. Every step is isolated: what could not be read is simply absent (the evaluator never invents it). */
async function collect(rawUrl, { fetchText = safeFetch.fetchText, probe = safeFetch.probe, deadlineMs = 90000, probeLimit = 25 } = {}) {
  const baseUrl = normalizeUrl(rawUrl); const base = new URL(baseUrl); const origin = base.origin; const path = base.pathname === '/' ? '' : base.pathname;
  const t0 = Date.now(); const late = () => Date.now() - t0 > deadlineMs;
  const g = (u, o) => readPage(u, { fetchText, ...o });
  const snap = { baseUrl, collectedAt: new Date().toISOString(), skipped: [] };
  snap.home = await g(`${baseUrl}/`);
  if (!snap.home.ok) return snap;
  const home = audit.parseHtml(snap.home.html, snap.home.finalUrl);
  if (base.protocol === 'https:') {                                                  // does the plain http address lead to https?
    const h = await g(`http://${base.host}${path}/`, { maxBytes: 200000 });
    snap.httpRedirect = h.ok ? /^https:/i.test(h.finalUrl) : (h.status ? null : null);
  }
  snap.robots = await g(`${origin}/robots.txt`, { maxBytes: 200000, accept: 'text/plain,*/*;q=0.5' });
  snap.adsTxt = await g(`${origin}/ads.txt`, { maxBytes: 200000, accept: 'text/plain,*/*;q=0.5' });
  const fromRobots = snap.robots.ok ? audit.parseRobots(snap.robots.body).sitemaps : [];
  snap.sitemap = { found: false };
  for (const cand of [...fromRobots.slice(0, 2), `${origin}/wp-sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`]) {
    if (late()) { snap.skipped.push('sitemap'); break; }
    let u; try { u = new URL(cand, origin).toString(); } catch { continue; }
    const r = await g(u, { maxBytes: 1024 * 1024, accept: 'application/xml,text/xml,*/*;q=0.5' });
    if (r.ok && /<(urlset|sitemapindex)\b/i.test(r.body)) { snap.sitemap = { found: true, url: u, kind: /<sitemapindex/i.test(r.body) ? 'index' : 'urlset', urlCount: (r.body.match(/<loc>/gi) || []).length }; break; }
  }

  // WordPress's public REST lists (no login): pages, posts with their authors, the site's name and slogan
  const rest = { ok: false, pages: [], posts: [] }; snap.rest = rest;
  const restBase = `${baseUrl}/wp-json`;
  const index = json(await g(`${restBase}/`, { accept: 'application/json' }));
  if (index && typeof index === 'object') {
    rest.name = index.name; rest.description = index.description;
    const pagesRes = await g(`${restBase}/wp/v2/pages?per_page=50&_fields=id,slug,title,link,content,status`, { accept: 'application/json' });
    const postsRes = late() ? null : await g(`${restBase}/wp/v2/posts?per_page=15&_embed=author`, { accept: 'application/json' });
    const pages = json(pagesRes); const posts = postsRes && json(postsRes);
    if (Array.isArray(pages) && Array.isArray(posts)) {
      rest.ok = true;
      rest.pages = pages.map((p) => ({ slug: p.slug, title: htmlToText((p.title || {}).rendered), link: p.link, words: wordCount((p.content || {}).rendered), text: htmlToText((p.content || {}).rendered).slice(0, 8000) }));
      rest.postsTotal = Number(postsRes.headers['x-wp-total']); if (!Number.isFinite(rest.postsTotal)) rest.postsTotal = posts.length;
      rest.posts = posts.map((p) => { const a = p._embedded && Array.isArray(p._embedded.author) ? p._embedded.author[0] : null; return { slug: p.slug, title: htmlToText((p.title || {}).rendered), link: p.link, date: p.date, words: wordCount((p.content || {}).rendered), author: a && a.name ? { name: a.name, bio: htmlToText(a.description || ''), link: a.link } : null }; });
    }
  }

  // pages that exist only as links (no REST list): read them, they are needed for the privacy text
  snap.fetchedPages = {};
  for (const kind of ['privacy', 'about', 'contact', 'editorial']) {
    if (late()) { snap.skipped.push(`page:${kind}`); continue; }
    if (rest.pages.some((p) => audit.PAGE_PATTERNS[kind].test(p.slug || '') || audit.PAGE_PATTERNS[kind].test(p.title || ''))) continue;
    const link = audit.pickLink(home.links, kind); if (!link) continue;
    const r = await g(link.href); if (r.ok) snap.fetchedPages[kind] = { words: wordCount(r.html), text: htmlToText(r.html).slice(0, 8000) };
  }
  const sameSite = (u) => { try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase() === base.hostname.replace(/^www\./i, '').toLowerCase(); } catch { return false; } };
  const first = rest.posts.find((p) => p.link && sameSite(p.link)) || null;                    // an address the site's own REST answer names is only followed when it stays on the site
  const postUrl = first ? first.link : (home.links.find((l) => l.internal && l.zone === 'body' && new URL(l.href).pathname.length > 4) || {}).href;
  if (postUrl && !late()) { const r = await g(postUrl); if (r.ok) snap.postPage = { ok: true, html: r.html, finalUrl: r.finalUrl, ms: r.ms }; }

  // site-internal links of the home page: are they alive?
  const seen = new Set(); const targets = [];
  for (const l of home.links) {
    if (!l.internal || seen.has(l.href)) continue; seen.add(l.href);
    let u; try { u = new URL(l.href); } catch { continue; }
    if (/\/(wp-json|wp-admin|wp-login\.php|feed|xmlrpc\.php|comments\/feed)(\/|$|\?)/i.test(u.pathname + u.search) || /\.(jpe?g|png|gif|webp|svg|pdf|zip)$/i.test(u.pathname) || u.search) continue;
    targets.push(l.href); if (targets.length >= probeLimit) break;
  }
  snap.linkProbes = [];
  for (let i = 0; i < targets.length && !late(); i += 4) {
    const part = await Promise.all(targets.slice(i, i + 4).map(async (u) => ({ url: u, ...(await probe(u, { timeoutMs: 8000 })) })));
    snap.linkProbes.push(...part);
  }
  if (late()) snap.skipped.push('time');
  return snap;
}

const shapeItem = (r) => ({ key: r.key, group: r.grp, label: r.label, status: r.status, required: r.required, detail: r.detail, fix: r.fix, evidence: r.evidence });
const shapeAudit = (r, items) => ({ id: r.id, projectId: r.project_id, siteId: r.site_id, url: r.url, status: r.status, verdict: r.verdict, verdictLabel: r.verdict ? VERDICT_LABEL[r.verdict] : null, verdictText: r.verdict_text, reachable: r.reachable,
  summary: r.summary, facts: r.facts, trigger: r.trigger, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms, ...(items ? { items: items.map(shapeItem) } : {}) });

/** what got better / worse since the previous finished audit of the same address */
function changes(prev, items) {
  if (!prev) return [];
  const before = new Map(prev.map((i) => [i.key, i.status])); const out = [];
  for (const i of items) { const was = before.get(i.key); if (was && was !== i.status) out.push({ key: i.key, label: i.label, from: was, to: i.status, required: i.required }); }
  return out;
}
const RANK = { passed: 0, na: 0, manual: 1, warning: 2, missing: 3 };

/**
 * Runs one audit and stores it.
 * @param target { siteId } or { projectId, url }
 * @param o { userId, trigger, now, net: { fetchText, probe } (test seams) }
 */
async function run(target, { userId = null, trigger = 'manual', net = {}, now = new Date() } = {}) {
  let projectId; let url; let siteId = null; let cfg = { language: 'en-US', pubId: null };
  if (target.siteId) {
    const s = (await db.query('SELECT id, project_id, api_url, language, adsense_pub_id, name FROM wp_sites WHERE id = $1', [V.uuid(target.siteId, 'Site')])).rows[0];
    if (!s) throw new HttpError(404, 'Site bulunamadı');
    projectId = s.project_id; siteId = s.id; url = normalizeUrl(s.api_url); cfg = { language: s.language, pubId: s.adsense_pub_id };
  } else {
    projectId = V.uuid(target.projectId, 'Proje'); url = normalizeUrl(target.url);
    if (!(await db.query('SELECT 1 FROM content_projects WHERE id = $1', [projectId])).rows[0]) throw new HttpError(404, 'Proje bulunamadı');
    const known = (await db.query('SELECT id, language, adsense_pub_id FROM wp_sites WHERE project_id = $1 AND lower(api_url) = lower($2)', [projectId, url])).rows[0];       // typed the address of a connected site: use its settings
    if (known) { siteId = known.id; cfg = { language: known.language, pubId: known.adsense_pub_id }; }
  }
  await db.query("UPDATE adsense_audits SET status = 'failed', error = 'Yarıda kaldı (zaman aşımı)', finished_at = now() WHERE status = 'running' AND started_at < now() - ($1 || ' minutes')::interval", [String(STALE_MINUTES)]);
  const recent = (await db.query("SELECT count(*)::int n FROM adsense_audits WHERE project_id = $1 AND started_at > now() - interval '1 hour'", [projectId])).rows[0].n;
  if (recent >= HOURLY_LIMIT) throw new HttpError(429, `Bir saatte en çok ${HOURLY_LIMIT} site denetimi yapılabilir; biraz sonra tekrar deneyin`);
  let row;
  try { row = (await db.query("INSERT INTO adsense_audits (project_id, site_id, url, trigger, created_by, started_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [projectId, siteId, url, trigger === 'schedule' ? 'schedule' : 'manual', userId, now])).rows[0]; }
  catch (err) { if (err.code === '23505') throw new HttpError(409, 'Bu adres için bir denetim zaten çalışıyor; bitmesini bekleyin'); throw err; }
  const t0 = Date.now();
  try {
    const snap = await collect(url, net);
    const res = audit.evaluate(snap, cfg);
    const prev = (await db.query("SELECT a.id FROM adsense_audits a WHERE a.project_id = $1 AND a.url = $2 AND a.status = 'done' AND a.reachable ORDER BY a.started_at DESC LIMIT 1", [projectId, url])).rows[0];
    const prevItems = prev ? (await db.query('SELECT key, status FROM adsense_audit_items WHERE audit_id = $1', [prev.id])).rows : null;
    const ch = res.reachable ? changes(prevItems, res.items) : [];
    await db.query(`INSERT INTO adsense_audit_items (audit_id, position, key, grp, label, status, required, detail, fix, evidence)
      SELECT $1, x.position, x.key, x.grp, x.label, x.status, x.required, x.detail, x.fix, x.evidence FROM jsonb_to_recordset($2::jsonb) AS x(position int, key text, grp text, label text, status text, required boolean, detail text, fix text, evidence jsonb)`,
    [row.id, JSON.stringify(res.items.map((i, n) => ({ position: n, key: i.key, grp: i.group, label: i.label, status: i.status, required: i.required, detail: i.detail, fix: i.fix, evidence: i.evidence })))]);
    const facts = { ...res.facts, changes: ch, skipped: snap.skipped, requests: undefined };
    const done = (await db.query(`UPDATE adsense_audits SET status = 'done', verdict = $2, verdict_text = $3, reachable = $4, summary = $5, facts = $6, finished_at = now(), duration_ms = $7 WHERE id = $1 RETURNING *`,
      [row.id, res.verdict, res.verdictText, res.reachable, JSON.stringify(res.summary), JSON.stringify(facts), Date.now() - t0])).rows[0];
    await db.query(`DELETE FROM adsense_audits WHERE id IN (SELECT id FROM adsense_audits WHERE project_id = $1 AND url = $2 ORDER BY started_at DESC OFFSET $3)`, [projectId, url, KEEP]);
    const worse = ch.filter((c) => RANK[c.to] > RANK[c.from] && (c.required || c.to === 'missing'));
    if (worse.length) await notifications.create({ type: 'adsense_site', severity: worse.some((c) => c.required) ? 'warning' : 'info', title: `AdSense site denetimi: ${worse.length} madde kötüleşti`, body: `${url}: ${worse.slice(0, 4).map((c) => c.label).join('; ')}`, data: { auditId: row.id, url } });
    return shapeAudit(done, res.items.map((i) => ({ ...i, grp: i.group })));
  } catch (err) {
    await db.query("UPDATE adsense_audits SET status = 'failed', error = $2, finished_at = now(), duration_ms = $3 WHERE id = $1", [row.id, String(err.message).slice(0, 300), Date.now() - t0]);
    throw err;
  }
}

async function list(projectId, { url = null, limit = 20 } = {}) {
  const p = [V.uuid(projectId, 'Proje')]; let w = '';
  if (url) { p.push(normalizeUrl(url)); w = ` AND url = $${p.length}`; }
  const rows = (await db.query(`SELECT * FROM adsense_audits WHERE project_id = $1${w} ORDER BY started_at DESC LIMIT ${Math.min(100, Math.max(1, limit | 0 || 20))}`, p)).rows;
  return rows.map((r) => shapeAudit(r));
}

async function get(id) {
  const r = (await db.query('SELECT * FROM adsense_audits WHERE id = $1', [V.uuid(id, 'Denetim')])).rows[0];
  if (!r) throw new HttpError(404, 'Denetim bulunamadı');
  const items = (await db.query('SELECT * FROM adsense_audit_items WHERE audit_id = $1 ORDER BY position', [r.id])).rows;
  return shapeAudit(r, items);
}

/** the newest finished audit of every address of the project (the page's overview) + the connected sites that were never audited */
async function overview(projectId) {
  const id = V.uuid(projectId, 'Proje');
  const rows = (await db.query(`SELECT DISTINCT ON (url) * FROM adsense_audits WHERE project_id = $1 AND status IN ('done', 'failed') ORDER BY url, started_at DESC`, [id])).rows;
  const sites = (await db.query('SELECT id, name, api_url, adsense_pub_id FROM wp_sites WHERE project_id = $1 ORDER BY created_at', [id])).rows;
  const running = (await db.query("SELECT url FROM adsense_audits WHERE project_id = $1 AND status = 'running'", [id])).rows.map((r) => r.url);
  return { latest: rows.map((r) => shapeAudit(r)).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)), sites: sites.map((s) => ({ id: s.id, name: s.name, url: normalizeUrl(s.api_url), adsensePubId: s.adsense_pub_id })), running, verdicts: VERDICT_LABEL };
}

module.exports = { normalizeUrl, collect, run, list, get, overview, changes, VERDICT_LABEL, KEEP, HOURLY_LIMIT };
