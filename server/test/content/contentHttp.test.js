const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const H = require('./helpers');

const opts = { skip: H.skip };
const ORIGIN = 'https://content.example.test';
const PW = 'Correct-Horse-9-Battery';
let server; let base;

test.before(async () => {
  if (H.skip) return;
  await H.freshDatabase();
  const { buildRouter } = require('../../src/content/routes');
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/content', buildRouter(() => ({ status: 'ready' })));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/content`;
});
test.beforeEach(async () => { if (!H.skip) { await H.clean(); await require('../../src/content/services/projects').seedDefault(); } });
test.after(async () => { if (server) await new Promise((r) => server.close(r)); if (!H.skip) await H.close(); });

/** a tiny browser: keeps the session cookie, sends the CSRF header and Origin like the admin panel does */
function client() {
  let cookie = '';
  const call = async (method, path, body, { headers = {}, raw = false, csrf = true, origin = ORIGIN } = {}) => {
    const h = { ...(csrf ? { 'X-Requested-With': 'modulpos-content' } : {}), ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers };
    if (body !== undefined && !(typeof body === 'string')) h['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const set = res.headers.getSetCookie();
    for (const c of set) { const kv = c.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; }
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString('utf8');           // Buffer keeps a byte order mark (fetch().text() would strip it)
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers, setCookie: set };
  };
  return { call, get: (p, o) => call('GET', p, undefined, o), post: (p, b, o) => call('POST', p, b ?? {}, o), put: (p, b, o) => call('PUT', p, b, o), del: (p, o) => call('DELETE', p, undefined, o), jar: () => cookie };
}

async function signedIn(role = 'admin') {
  const c = client();
  const A = require('../../src/content/services/auth');
  if (!(await A.userCount())) await A.setupFirstAdmin({ token: process.env.CONTENT_SETUP_TOKEN, email: 'boss@example.com', name: 'Boss', password: PW });
  const email = role === 'admin' ? 'boss@example.com' : `${role}@example.com`;
  if (role !== 'admin') await A.createUser({ email, name: role, password: PW, role });
  const r = await c.post('/auth/login', { email, password: PW });
  assert.equal(r.status, 200, r.text);
  return c;
}

test('state, first setup and login through HTTP: token needed, cookie flags, no-store, session works and ends', opts, async () => {
  const c = client();
  const st = await c.get('/status');
  assert.deepEqual([st.status, st.json.setupNeeded, st.json.setupTokenConfigured], [200, true, true]);
  assert.equal(st.headers.get('cache-control'), 'no-store');
  const bad = await c.post('/auth/setup', { token: 'nope', email: 'boss@example.com', name: 'Boss', password: PW });
  assert.equal(bad.status, 403);
  const ok = await c.post('/auth/setup', { token: process.env.CONTENT_SETUP_TOKEN, email: 'boss@example.com', name: 'Boss', password: PW });
  assert.equal(ok.status, 201); assert.equal(ok.json.user.role, 'admin'); assert.ok(!JSON.stringify(ok.json).includes('hash'));
  assert.equal((await c.get('/status')).json.setupNeeded, false);
  assert.equal((await c.post('/auth/setup', { token: process.env.CONTENT_SETUP_TOKEN, email: 'x@example.com', name: 'X', password: PW })).status, 409);
  assert.equal((await c.get('/auth/me')).status, 401, 'no session yet');
  const l = await c.post('/auth/login', { email: 'boss@example.com', password: PW });
  assert.equal(l.status, 200);
  const sc = l.setCookie[0];
  assert.match(sc, /^cp_session=[A-Za-z0-9_-]{40,};/); assert.match(sc, /HttpOnly/); assert.match(sc, /Path=\/api\/content/); assert.match(sc, /SameSite=Lax/); assert.match(sc, /Max-Age=604800/);
  assert.ok(!JSON.stringify(l.json).includes(sc.split(';')[0].split('=')[1]), 'the session token is not in the body');
  const me = await c.get('/auth/me');
  assert.equal(me.status, 200); assert.equal(me.json.user.email, 'boss@example.com'); assert.ok(me.json.permissions.includes('users.manage'));
  assert.equal((await c.post('/auth/login', { email: 'boss@example.com', password: 'wrong' })).status, 401);
  await c.post('/auth/logout');
  assert.equal((await c.get('/auth/me')).status, 401);
  assert.equal((await c.get('/dashboard')).status, 401);
});

test('CSRF and origin: unsafe requests need the custom header and a known origin; reads do not', opts, async () => {
  const c = await signedIn();
  assert.equal((await c.post('/bots/pause', {}, { csrf: false })).status, 403, 'header missing');
  assert.equal((await c.post('/bots/pause', {}, { origin: 'https://evil.example' })).status, 403, 'foreign origin');
  assert.equal((await c.get('/bots', { csrf: false, origin: 'https://evil.example' })).status, 200, 'GET is read-only');
  assert.equal((await c.post('/bots/pause', {}, { origin: null })).status, 200, 'no Origin header (a script, not a browser page): the custom header is what counts');
  assert.equal((await c.post('/bots/resume', {})).status, 200);
});

test('roles: viewer reads only, editor writes articles and categories but not settings, users or providers', opts, async () => {
  const admin = await signedIn('admin');
  const project = (await admin.get('/projects')).json.projects[0];
  const viewer = await signedIn('viewer'); const editor = await signedIn('editor');
  assert.equal((await viewer.get('/dashboard')).status, 200);
  assert.equal((await viewer.post('/articles', { projectId: project.id, h1: 'x' })).status, 403);
  assert.equal((await viewer.get('/users')).status, 403); assert.equal((await viewer.get('/audit')).status, 403); assert.equal((await viewer.get('/system')).status, 403);
  const art = await editor.post('/articles', { projectId: project.id, h1: 'Editor article', contentHtml: '<p>hello</p>' });
  assert.equal(art.status, 201);
  assert.equal((await editor.put('/limits/global', { limits: { new_article: 2 } })).status, 403);
  assert.equal((await editor.put('/providers/openai', { secret: 'sk-test-abcdefghijklmnop1234' })).status, 403);
  assert.equal((await editor.put(`/projects/${project.id}/niche`, { tone: 'x' })).status, 403);
  assert.equal((await editor.post('/bots/pause')).status, 403);
  assert.equal((await editor.get('/audit')).status, 200, 'editors may read the logs');
  const cats = (await editor.get(`/projects/${project.id}/categories`)).json.categories;
  assert.equal((await editor.put(`/categories/${cats[0].id}`, { description: 'edited by editor' })).status, 200);
});

test('project / niche / category routes: confirmation sentence reaches the screen, shares must total 100, bad ids are 404', opts, async () => {
  const c = await signedIn();
  const p = (await c.get('/projects')).json.projects[0];
  assert.equal(p.name, 'Global Tech Content Site');
  const niche = await c.put(`/projects/${p.id}/niche`, { mainNiche: 'Fitness' });
  assert.equal(niche.status, 409); assert.equal(niche.json.requiresConfirmation, true); assert.match(niche.json.error, /SEO stratejinizi/);
  assert.equal((await c.put(`/projects/${p.id}/niche`, { mainNiche: 'Fitness', confirmNicheChange: true })).json.niche.version, 2);
  const cats = (await c.get(`/projects/${p.id}/categories`)).json.categories;
  const bad = await c.put(`/projects/${p.id}/category-shares`, { shares: cats.map((x, i) => ({ id: x.id, share: i === 0 ? 40 : 25 })) });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /toplamı %100/);
  const good = await c.put(`/projects/${p.id}/category-shares`, { shares: cats.map((x) => ({ id: x.id, share: 20 })) });
  assert.equal(good.status, 200); assert.equal(good.json.categories.reduce((a, x) => a + x.targetSharePct, 0), 100);
  const arch = await c.post(`/categories/${cats[0].id}/archive`);
  assert.equal(arch.status, 200); assert.equal(arch.json.categories.filter((x) => x.status !== 'archived').reduce((a, x) => a + x.targetSharePct, 0), 100);
  assert.equal((await c.get('/projects/not-a-uuid')).status, 404);
  assert.equal((await c.get('/projects/00000000-0000-0000-0000-000000000001')).status, 404);
  const t = await c.post(`/projects/${p.id}/check-topic`, { text: 'Premier League football match tonight' });
  assert.equal(t.json.allowed, false);
});

test('Günlük Çalışma Ayarları through HTTP: read, change, validation, reset; the change is what the reservation uses', opts, async () => {
  const c = await signedIn();
  const p = (await c.get('/projects')).json.projects[0];
  const L = require('../../src/content/services/limits');
  const page = (await c.get(`/limits?projectId=${p.id}`)).json;
  assert.equal(page.global.find((i) => i.workType === 'new_article').limit, 3); assert.equal(page.categories.length, 5); assert.equal(page.bots.paused, false);
  const set = await c.put('/limits/global', { limits: { new_article: 1, seo_keywords: 40 } });
  assert.equal(set.status, 200); assert.equal(set.json.global.find((i) => i.workType === 'seo_keywords').limit, 40);
  assert.equal((await c.put('/limits/global', { limits: { new_article: 500 } })).status, 400);
  assert.equal((await c.put('/limits/global', { limits: { made_up: 1 } })).status, 400);
  assert.equal((await c.put('/limits/global', {})).status, 400);
  assert.equal((await L.reserve({ workType: 'new_article', projectId: p.id })).ok, true);
  assert.equal((await L.reserve({ workType: 'new_article', projectId: p.id })).ok, false, 'the saved value of 1 is enforced at once, no restart');
  const cats = (await c.get(`/projects/${p.id}/categories`)).json.categories;
  const cl = await c.put(`/limits/categories/${cats[1].id}`, { dailyMax: 4, publishMax: 2 });
  assert.equal(cl.json.categories.find((x) => x.id === cats[1].id).daily_max, 4); assert.equal(cl.json.categories.find((x) => x.id === cats[1].id).publish_max, 2);
  assert.equal((await c.put(`/limits/projects/${p.id}`, { limits: { new_article: 2, refresh: 1 } })).json.global.find((i) => i.workType === 'refresh').project.limit, 1);
  const reset = await c.post('/limits/reset', { projectId: p.id });
  assert.equal(reset.json.global.find((i) => i.workType === 'new_article').limit, 3); assert.equal(reset.json.global.find((i) => i.workType === 'new_article').isDefault, true);
  const audit = (await c.get('/audit?action=limits')).json;
  assert.ok(audit.items.length >= 4 && audit.items.every((x) => x.user_email === 'boss@example.com'), 'every change is in the history with who did it');
  const s = await c.put('/settings/quality', { value: { minScore: 90, factCheck: false } });
  assert.equal(s.json.value.factCheck, true); assert.equal((await c.get('/settings')).json.quality.value.minScore, 90);
  assert.equal((await c.put('/settings/quality', { value: { minScore: 5 } })).status, 400);
  assert.equal((await c.del('/settings/quality')).json.value.minScore, 85);
});

test('providers through HTTP: the key goes in, only its last 4 come out, nothing secret in the audit trail', opts, async () => {
  const c = await signedIn();
  const KEY = 'sk-live-ABCDEFGHIJKLMNOP9876';
  const r = await c.put('/providers/openai', { secret: KEY, extra: { model: 'm1' }, dailyBudgetUsd: 3 });
  assert.equal(r.status, 200); assert.equal(r.json.secretLast4, '9876');
  const list = await c.get('/providers');
  assert.ok(!list.text.includes('ABCDEFGHIJ') && !r.text.includes('ABCDEFGHIJ'));
  const aud = await c.get('/audit?entity=provider');
  assert.ok(!aud.text.includes('ABCDEFGHIJ'), 'the audit trail holds no key'); assert.ok(aud.json.items.some((x) => x.action === 'provider.save'));
  assert.equal((await c.put('/providers/unknown', {})).status, 400);
  const t = await c.post('/providers/apify/test');
  assert.equal(t.status, 409, 'nothing saved: no call is made');
  assert.equal((await c.get('/usage')).json.today.costUsd, 0);
});

test('articles through HTTP: create, edit with version check, status rules, export download, bad input', opts, async () => {
  const c = await signedIn();
  const p = (await c.get('/projects')).json.projects[0];
  const cats = (await c.get(`/projects/${p.id}/categories`)).json.categories;
  const a = await c.post('/articles', { projectId: p.id, categoryId: cats[0].id, h1: 'HTTP article', contentHtml: '<p>Body <script>alert(1)</script>text</p>' });
  assert.equal(a.status, 201); assert.ok(!a.json.contentHtml.includes('script'));
  const id = a.json.id;
  assert.equal((await c.put(`/articles/${id}`, { h1: 'Edited', expectedVersion: 1 })).json.currentVersion, 2);
  const stale = await c.put(`/articles/${id}`, { h1: 'Late', expectedVersion: 1 });
  assert.equal(stale.status, 409); assert.equal(stale.json.currentVersion, 2);
  const ready = await c.post(`/articles/${id}/status`, { status: 'ready' });
  assert.equal(ready.status, 409); assert.ok(ready.json.problems.some((x) => x.code === 'not_fact_checked'));
  assert.equal((await c.post(`/articles/${id}/status`, { status: 'published' })).status, 409);
  assert.equal((await c.get(`/articles/${id}/versions`)).json.versions.length, 2);
  assert.equal((await c.post(`/articles/${id}/versions/1/restore`)).json.h1, 'HTTP article');
  const exp = await c.get('/articles-export?format=csv');
  assert.equal(exp.status, 200); assert.match(exp.headers.get('content-disposition'), /attachment; filename="articles-\d{4}-\d{2}-\d{2}\.csv"/); assert.equal(exp.headers.get('x-article-count'), '1'); assert.ok(exp.text.charCodeAt(0) === 0xFEFF);
  const html = await c.get(`/articles-export?format=html&ids=${id}`);
  assert.equal(html.headers.get('content-security-policy'), 'sandbox');
  assert.equal((await c.get('/articles-export?format=pdf')).status, 400);
  const list = await c.get(`/articles?projectId=${p.id}&q=http&pageSize=5`);
  assert.equal(list.json.total, 1); assert.ok(!('contentHtml' in list.json.items[0]));
  assert.equal((await c.get('/articles?status=bogus')).status, 400);
  assert.equal((await c.post('/articles', { projectId: p.id })).status, 400);
  assert.equal((await c.post('/articles', '{not json', { headers: { 'Content-Type': 'application/json' } })).status, 400, 'invalid JSON');
  assert.equal((await c.post('/articles', 'plain text', { headers: { 'Content-Type': 'text/plain' } })).status, 400, 'another content type: empty body, normal validation answer, no crash');
  assert.equal((await c.post('/articles', '[1,2]', { headers: { 'Content-Type': 'application/json' } })).status, 400, 'a JSON array is not an object');
  assert.equal((await c.post('/articles', '7', { headers: { 'Content-Type': 'application/json' } })).status, 400);
  const big = await c.post('/articles', { projectId: p.id, h1: 'Big', contentHtml: `<p>${'x'.repeat(700000)}</p>` });
  assert.equal(big.status, 400, 'oversized content is refused');
  assert.equal((await c.del(`/articles/${id}`)).status, 200);
  assert.equal((await c.get(`/articles/${id}`)).status, 404);
});

test('dashboard: real numbers, organic traffic says why it has no data instead of showing 0, project filter', opts, async () => {
  const c = await signedIn();
  const p = (await c.get('/projects')).json.projects[0];
  await c.post('/articles', { projectId: p.id, h1: 'Dash one', contentHtml: '<p>a</p>' });
  const d = (await c.get(`/dashboard?projectId=${p.id}&days=14`)).json;
  const m = Object.fromEntries(d.metrics.map((x) => [x.key, x]));
  assert.equal(m.awaiting.value, 1); assert.deepEqual([m.news_found.available, m.news_found.value, m.keywords.value, m.seo_analyzed.value], [true, 0, 0, 0], 'phase 2 numbers are real counts now (nothing researched yet = a real 0)');
  assert.deepEqual(d.metrics.filter((x) => !x.available).length, 0); assert.equal(d.charts.organicTraffic.available, false); assert.match(d.charts.organicTraffic.note, /Henüz bağlı bir web sitesi yok/); assert.equal('phase' in d.charts.organicTraffic, false, 'no phase wording: the reason is stated instead');
  assert.equal(m.cost_today.value, 0); assert.equal(m.active_bots.value, 16); assert.match(m.active_bots.note, /16’i hazır; 7’i otomatik çalışıyor/);
  assert.equal(d.charts.dailyProduction.length, 14); assert.equal(d.charts.dailyProduction.at(-1).value, 1); assert.equal(d.charts.categoryShare.length, 5);
  assert.equal(d.empty, false); assert.equal(d.charts.seoOpportunities.available, true); assert.equal(d.charts.searchVolume.buckets.length, 4);
  assert.equal(d.limitsToday.find((x) => x.workType === 'new_article').limit, 3);
  assert.equal((await c.get('/dashboard?projectId=00000000-0000-0000-0000-000000000001')).status, 404);
  const bots = (await c.get('/bots')).json;
  assert.equal(bots.items.length, 16); assert.equal(bots.items.filter((b) => b.implemented).length, 16, 'the six phase-2 bots, the three phase-3 bots, the WordPress bot, the four phase-6 bots (health, refresh, Search Console, internal links), the reporting bot and the article fixer exist: all 16'); assert.ok(bots.items.every((b) => b.lastRunAt === null), 'none has run yet: no invented last-run data');
  assert.match(bots.items[0].statusText, /Otomatik: 2 saatte bir/); assert.match(bots.items.find((b) => b.key === 'article_writer').statusText, /Otomatik kapalı; elle çalıştırılır/, 'bots that spend money start switched off'); assert.equal(bots.items.filter((b) => !b.implemented).length, 0, 'no bot is "coming in a later phase" any more');
});

test('notifications, users, system, unknown routes', opts, async () => {
  const c = await signedIn();
  const N = require('../../src/content/services/notifications');
  const id = await N.create({ type: 'budget', severity: 'critical', title: 'API bütçesi doldu', body: 'x' });
  assert.equal((await c.get('/notifications?unread=1')).json.unread, 1);
  assert.equal((await c.post(`/notifications/${id}/read`)).status, 200);
  assert.equal((await c.get('/notifications?unread=1')).json.total, 0);
  assert.equal((await c.post('/notifications/00000000-0000-0000-0000-000000000001/read')).status, 404);
  const u = await c.post('/users', { email: 'new@example.com', name: 'New', password: PW, role: 'editor' });
  assert.equal(u.status, 201); assert.equal((await c.post('/users', { email: 'new@example.com', name: 'New', password: PW, role: 'editor' })).status, 409);
  assert.equal((await c.put(`/users/${u.json.id}`, { isActive: false })).json.isActive, false);
  assert.equal((await c.get('/users')).json.users.length, 2);
  const sys = (await c.get('/system')).json;
  assert.equal(sys.config.encryptionKeyConfigured, true); assert.equal(sys.migrations.length, sys.migrationFilesTotal);
  assert.ok(!JSON.stringify(sys).includes(process.env.CONTENT_ENCRYPTION_KEY) && !JSON.stringify(sys).includes(process.env.CONTENT_SETUP_TOKEN), 'no secret in the system page');
  assert.equal((await c.get('/nothing-here')).status, 404);
  const pw = await c.post('/auth/password', { current: PW, next: 'Another-Strong-Pass-1' });
  assert.equal(pw.status, 200); assert.equal((await c.get('/auth/me')).status, 401, 'every session ended with the password change');
});

test('the module is closed when not configured, and says so while the database is not ready', opts, async () => {
  const { buildRouter } = require('../../src/content/routes');
  const mod = require('../../src/content');
  const app = express();
  const saved = process.env.CONTENT_DATABASE_URL; process.env.CONTENT_DATABASE_URL = '';
  const out = mod.mount(app);
  process.env.CONTENT_DATABASE_URL = saved;
  assert.equal(out.enabled, false);
  assert.deepEqual(mod.corsOrigins().length, 1, 'origins are listed while enabled');
  const s = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
  let res = await fetch(`http://127.0.0.1:${s.address().port}/api/content/status`);
  assert.equal(res.status, 503); assert.equal((await res.json()).state, 'disabled');
  s.close();
  const app2 = express(); app2.use('/api/content', buildRouter(() => ({ status: 'starting' })));
  const s2 = await new Promise((r) => { const sv = app2.listen(0, '127.0.0.1', () => r(sv)); });
  res = await fetch(`http://127.0.0.1:${s2.address().port}/api/content/status`);
  assert.equal(res.status, 503); assert.equal((await res.json()).state, 'starting');
  s2.close();
});

test('automation mode through HTTP: everybody signed in can read it, only the admin can change it, a refused mode changes nothing, the confirmation round trip works, every change is audited', opts, async () => {
  const admin = await signedIn(); const viewer = await signedIn('viewer'); const editor = await signedIn('editor');
  const project = (await admin.get('/projects')).json.projects[0];
  const r = await viewer.get(`/automation?projectId=${project.id}`); assert.equal(r.status, 200); assert.equal(r.json.options.length, 17); assert.equal(r.json.modes.length, 3);
  assert.equal((await viewer.get('/automation')).status, 400, 'a project is required');
  for (const c of [viewer, editor]) assert.equal((await c.put('/automation', { projectId: project.id, mode: 'manual' })).status, 403);
  const refused = await admin.put('/automation', { projectId: project.id, mode: 'full' }); assert.equal(refused.status, 409); assert.match(refused.json.error, /Tam otomatik mod için eksikler/); assert.ok(refused.json.problems.length >= 2);
  const off = await admin.put('/automation', { projectId: project.id, mode: 'manual' }); assert.equal(off.status, 200); assert.equal(off.json.mode, 'manual'); assert.ok(off.json.applied.changes.length > 0);
  assert.equal((await admin.put('/automation', { projectId: project.id, mode: 'custom', options: { writer: true } })).status, 409, 'no model connected: refused with the reason');
  const bad = await admin.put('/automation', { projectId: project.id, mode: 'custom', options: { news: 'ja' } }); assert.equal(bad.status, 400);
  const on = await admin.put('/automation', { projectId: project.id, mode: 'custom', options: { news: true, opportunities: true } }); assert.equal(on.status, 200); assert.equal(on.json.options.find((x) => x.key === 'news').on, true);
  const lv = await viewer.get(`/automation/live?projectId=${project.id}`); assert.equal(lv.status, 200); assert.equal(lv.json.bots.length, 14); assert.deepEqual([lv.json.summary.running, lv.json.paused], [0, false]); assert.ok(lv.json.bots.some((b) => b.key === 'news_discovery' && b.state === 'waiting'));
  assert.equal((await viewer.get('/automation/live')).status, 400); assert.equal((await viewer.get('/automation/live?projectId=00000000-0000-0000-0000-000000000001')).status, 404); assert.equal((await client().get(`/automation/live?projectId=${project.id}`)).status, 401, 'signed-in users only');
  const audit = (await admin.get('/audit?action=automation')).json.items; assert.ok(audit.length >= 2); assert.equal(audit[0].action, 'automation.apply');
});

test('free cover photos through HTTP: a viewer cannot search or choose, an editor can, the search shows candidates and saves nothing, a choice is audited and gives a real image with its credit; no key = a clear refusal', opts, async () => {
  const admin = await signedIn(); const editor = await signedIn('editor'); const viewer = await signedIn('viewer');
  const project = (await admin.get('/projects')).json.projects[0];
  const art = (await admin.post('/articles', { projectId: project.id, h1: 'Free photo test', contentHtml: '<p>hello</p>' })).json;
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF http stock picture '.repeat(60)), Buffer.from([0xff, 0xd9])]);
  const hit = (id, tags) => ({ id, pageURL: `https://pixabay.com/photos/x-${id}/`, type: 'photo', tags, previewURL: `https://cdn.pixabay.com/p${id}.jpg`, webformatURL: `https://pixabay.com/get/w${id}_640.jpg`, largeImageURL: `https://pixabay.com/get/l${id}_1280.jpg`, imageWidth: 4000, imageHeight: 2667, user: 'Jane', user_id: 7 });
  const real = globalThis.fetch; const stock = require('../../src/content/services/stockPhotos'); const asked = [];
  globalThis.fetch = async (u, o) => { if (String(u).startsWith('https://pixabay.com/api/')) { const q = new URL(u).searchParams; asked.push(q.get('id') || q.get('q')); const all = [hit(11, 'router, wifi'), hit(12, 'people, man')]; const hits = q.get('id') ? all.filter((h) => String(h.id) === q.get('id')) : all; return new Response(JSON.stringify({ total: hits.length, totalHits: hits.length, hits }), { status: 200 }); } return real(u, o); };
  stock.useDownload(async (url) => ({ buffer: JPEG, contentType: 'image/jpeg', url })); stock.clearCache();
  try {
    assert.equal((await viewer.get(`/articles/${art.id}/image/stock-search?query=router`)).status, 403); assert.equal((await viewer.post(`/articles/${art.id}/image/stock`, { photoId: '11' })).status, 403);
    assert.equal((await editor.get(`/articles/${art.id}/image/stock-search?query=router`)).status, 409, 'no Pixabay key yet: told, not crashed'); assert.match((await editor.get(`/articles/${art.id}/image/stock-search?query=router`)).json.error, /Pixabay anahtarı kayıtlı değil/);
    assert.equal((await admin.put('/providers/pixabay', { secret: '12345678-abcdef0123456789abcdef012' })).status, 200);
    const info = (await viewer.get(`/articles/${art.id}/image`)).json; assert.deepEqual([info.pixabayConfigured, info.source, info.stockType, info.usedSource], [true, 'auto', 'photo', 'stock']);
    assert.equal((await editor.get(`/articles/${art.id}/image/stock-search?query=`)).status, 400); assert.equal((await editor.get(`/articles/${art.id}/image/stock-search?query=router&type=gif`)).status, 400);
    const found = await editor.get(`/articles/${art.id}/image/stock-search?query=router`); assert.equal(found.status, 200); assert.deepEqual(found.json.candidates.map((c) => [c.id, c.problem === null]), [['11', true], ['12', false]], 'the one that names a person is flagged'); assert.ok(!JSON.stringify(found.json).includes('largeImageURL') && !found.text.includes('12345678-abcdef'), 'the file address and the key stay on the server');
    assert.equal((await viewer.get(`/articles/${art.id}/image`)).json.image, null, 'a search saves nothing');
    assert.equal((await editor.post(`/articles/${art.id}/image/stock`, {})).status, 400);
    const pick = await editor.post(`/articles/${art.id}/image/stock`, { photoId: '11', query: 'router' }); assert.equal(pick.status, 200, pick.text); assert.deepEqual([pick.json.image.provider, pick.json.image.creditName, pick.json.image.sourceId, pick.json.image.costUsd, pick.json.image.bytes], ['pixabay', 'Jane', '11', 0, undefined]);
    const file = await viewer.get(`/articles/${art.id}/image/file`); assert.deepEqual([file.status, file.headers.get('content-type')], [200, 'image/jpeg']);
    assert.equal((await editor.post(`/articles/${art.id}/image/stock`, { photoId: '999' })).status, 404);
    const log = (await admin.get('/audit?action=article.image_stock')).json.items; assert.equal(log.length, 1);
  } finally { globalThis.fetch = real; stock.useDownload(null); stock.clearCache(); }
});

test('cover image through HTTP: everybody signed in can see it, an editor can change the alt text and remove it, only the admin can pay for a new one, the bytes come back as a real image, every change is audited', opts, async () => {
  const admin = await signedIn(); const editor = await signedIn('editor'); const viewer = await signedIn('viewer');
  const project = (await admin.get('/projects')).json.projects[0];
  const art = (await admin.post('/articles', { projectId: project.id, h1: 'Cover test', contentHtml: '<p>hello</p>' })).json;
  const empty = (await viewer.get(`/articles/${art.id}/image`)).json; assert.deepEqual([empty.image, empty.openaiConfigured, empty.auto], [null, false, false]);
  assert.equal((await viewer.get(`/articles/${art.id}/image/file`)).status, 404);
  assert.equal((await editor.post(`/articles/${art.id}/image/generate`, {})).status, 403, 'drawing costs money: admin only');
  assert.equal((await admin.post(`/articles/${art.id}/image/generate`, {})).status, 409, 'OpenAI is not set up yet');
  assert.equal((await admin.put('/providers/openai', { secret: 'sk-test-abcdefghijklmnop1234', extra: { model: 'gpt-test', imageModel: 'gpt-image-2' } })).status, 200);
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF http test picture '.repeat(60)), Buffer.from([0xff, 0xd9])]); const real = globalThis.fetch; const seen = [];
  globalThis.fetch = async (u, o) => { if (String(u).startsWith('https://api.openai.com/')) { seen.push(JSON.parse(o.body)); return new Response(JSON.stringify({ created: 1, size: '1536x1024', data: [{ b64_json: JPEG.toString('base64') }], usage: { input_tokens: 50, output_tokens: 900, total_tokens: 950 } }), { status: 200, headers: { 'content-type': 'application/json' } }); } return real(u, o); };
  try {
    assert.equal((await admin.post(`/articles/${art.id}/image/generate`, { prompt: 'x'.repeat(701) })).status, 400, 'a scene longer than 700 characters is refused');
    assert.equal((await admin.post(`/articles/${art.id}/image/generate`, { quality: 'ultra' })).status, 400);
    const gen = await admin.post(`/articles/${art.id}/image/generate`, { prompt: 'A router on a wooden desk', alt: 'A white router on a desk', quality: 'low' });
    assert.equal(gen.status, 200, gen.text); assert.deepEqual([gen.json.image.alt, gen.json.image.quality, gen.json.image.model, gen.json.image.bytes], ['A white router on a desk', 'low', 'gpt-image-2', undefined]); assert.equal(seen.length, 1); assert.equal(seen[0].quality, 'low');
  } finally { globalThis.fetch = real; }
  const meta = (await viewer.get(`/articles/${art.id}/image`)).json; assert.equal(meta.openaiConfigured, true); assert.equal(meta.image.byteSize, JPEG.length);
  const file = await viewer.get(`/articles/${art.id}/image/file`); assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'image/jpeg'); assert.equal(file.headers.get('x-content-type-options'), 'nosniff'); assert.equal(file.text.length > 0, true);
  assert.equal((await viewer.put(`/articles/${art.id}/image`, { alt: 'x' })).status, 403); assert.equal((await editor.put(`/articles/${art.id}/image`, { alt: '' })).status, 400);
  assert.equal((await editor.put(`/articles/${art.id}/image`, { alt: 'A router on a desk' })).json.image.alt, 'A router on a desk');
  assert.equal((await viewer.del(`/articles/${art.id}/image`)).status, 403); assert.equal((await editor.del(`/articles/${art.id}/image`)).status, 200); assert.equal((await editor.del(`/articles/${art.id}/image`)).status, 404);
  assert.equal((await viewer.get(`/articles/${art.id}/image`)).json.image, null);
  const log = (await admin.get('/audit?action=article.image')).json.items.map((x) => x.action); assert.deepEqual(['article.image_remove', 'article.image_alt', 'article.image_generate'], log.slice(0, 3));
});

test('article fixer through HTTP: only the admin (paid work) can ask for a fix, it is a queued job per article, everybody can read the attempts, and a person\'s own article is refused by the job (not silently rewritten)', opts, async () => {
  const admin = await signedIn('admin'); const viewer = await signedIn('viewer');
  const P = require('../../src/content/services/projects'); const A = require('../../src/content/services/articles'); const SC = require('../../src/content/services/scheduler');
  const project = (await admin.get('/projects')).json.projects[0] || { id: (await H.db().query('SELECT id FROM content_projects')).rows[0].id };
  const cat = (await H.db().query('SELECT id FROM categories WHERE project_id = $1 LIMIT 1', [project.id])).rows[0].id;
  const a = await A.create({ projectId: project.id, categoryId: cat, h1: 'Written by a person', contentHtml: '<p>hello</p>' });
  assert.equal((await viewer.post(`/articles/${a.id}/fix`)).status, 403, 'a viewer cannot spend money');
  const first = await admin.post(`/articles/${a.id}/fix`); assert.equal(first.status, 202);
  assert.deepEqual([first.json.job.botKey, first.json.job.payload.articleId, first.json.job.trigger], ['article_fixer', a.id, 'manual']);
  assert.equal((await admin.post(`/articles/${a.id}/fix`)).status, 409, 'one fix at a time for one article');
  const h = await viewer.get(`/articles/${a.id}/fixes`); assert.deepEqual([h.status, h.json.attempts, h.json.max, h.json.parked, h.json.items], [200, 0, 2, false, []]);
  const done = await SC.workOnce({ now: new Date() });
  assert.equal(done.outcome, 'failed'); assert.match(done.error, /yapay zekânın yazdığı/);
  assert.equal((await H.db().query('SELECT count(*)::int n FROM article_fixes')).rows[0].n, 0, 'nothing was changed or recorded');
  assert.equal((await H.db().query("SELECT count(*)::int n FROM audit_logs WHERE action = 'article.fix'")).rows[0].n, 1, 'asking is audited');
  void P;
});

test('"run all bots" through HTTP: only the admin (bots.control) can click it, it queues one job per step in order and says which were already active, and the click is audited', opts, async () => {
  const admin = await signedIn('admin'); const viewer = await signedIn('viewer');
  const pid = (await H.db().query('SELECT id FROM content_projects')).rows[0].id;
  assert.equal((await viewer.post('/bots/run-all', { projectId: pid })).status, 403);
  assert.equal((await admin.post('/bots/run-all', {})).status, 400, 'the project is needed');
  const r = await admin.post('/bots/run-all', { projectId: pid }); assert.equal(r.status, 202, r.text);
  assert.deepEqual([r.json.steps.length, r.json.queued, r.json.alreadyActive], [15, 15, 0]);
  assert.deepEqual(r.json.steps.slice(0, 2).map((x) => x.bot), ['news_discovery', 'content_opportunity']); assert.equal(r.json.steps[r.json.steps.length - 1].bot, 'reporting');
  assert.ok(r.json.steps.every((x) => x.label && x.what && typeof x.spends === 'boolean' && x.jobId));
  const again = await admin.post('/bots/run-all', { projectId: pid }); assert.deepEqual([again.json.queued, again.json.alreadyActive], [0, 15]);
  assert.equal((await H.db().query("SELECT count(*)::int n FROM audit_logs WHERE action = 'bots.run_all'")).rows[0].n, 2);
  const list = await viewer.get('/jobs?status=queued'); assert.equal(list.json.jobs.length, 15, 'everybody can see what is waiting');
});

test('"AdSense uyarısını kabul et" through HTTP: editors and admins only, a refused class is a 409 with the reason, the list says which articles are live', opts, async () => {
  const admin = await signedIn('admin'); const viewer = await signedIn('viewer');
  const A = require('../../src/content/services/articles'); const P = require('../../src/content/services/projects');
  const pid = (await H.db().query('SELECT id FROM content_projects')).rows[0].id; const cats = await P.listCategories(pid);
  const a = await A.create({ projectId: pid, categoryId: cats[0].id, h1: 'Accept me', contentHtml: `<h2>x</h2><p>${Array.from({ length: 420 }, (_, i) => `w${i}`).join(' ')}</p>`, focusKeyword: 'accept me', seoTitle: 'Accept me please', metaDescription: 'm'.repeat(100) });
  assert.equal((await viewer.post(`/articles/${a.id}/adsense-accept`, {})).status, 403);
  assert.equal((await admin.post(`/articles/${a.id}/adsense-accept`, {})).status, 409, 'no class yet');
  await A.update(a.id, { adsenseRisk: 'review' });
  const ok = await admin.post(`/articles/${a.id}/adsense-accept`, {}); assert.equal(ok.status, 200, ok.text); assert.deepEqual([ok.json.article.adsenseRisk, ok.json.article.adsenseAccepted, ok.json.approved], ['review', true, false]);
  const back = await admin.post(`/articles/${a.id}/adsense-accept`, { accept: false }); assert.equal(back.json.article.adsenseAccepted, false);
  assert.equal((await H.db().query("SELECT count(*)::int n FROM audit_logs WHERE action IN ('article.adsense_accept', 'article.adsense_accept_withdraw')")).rows[0].n, 2);
  const list = await viewer.get('/articles'); assert.ok(list.json.items.every((x) => 'live' in x), 'every row says whether it is live (null = not)');
});
