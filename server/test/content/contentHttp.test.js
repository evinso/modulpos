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
  const t = await c.post('/providers/dataforseo/test');
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

test('dashboard: real numbers, figures of later phases marked unavailable instead of 0, project filter', opts, async () => {
  const c = await signedIn();
  const p = (await c.get('/projects')).json.projects[0];
  await c.post('/articles', { projectId: p.id, h1: 'Dash one', contentHtml: '<p>a</p>' });
  const d = (await c.get(`/dashboard?projectId=${p.id}&days=14`)).json;
  const m = Object.fromEntries(d.metrics.map((x) => [x.key, x]));
  assert.equal(m.awaiting.value, 1); assert.deepEqual([m.news_found.available, m.news_found.value, m.keywords.value, m.seo_analyzed.value], [true, 0, 0, 0], 'phase 2 numbers are real counts now (nothing researched yet = a real 0)');
  assert.deepEqual(d.metrics.filter((x) => !x.available).length, 0); assert.equal(d.charts.organicTraffic.available, false); assert.equal(d.charts.organicTraffic.phase, 6);
  assert.equal(m.cost_today.value, 0); assert.equal(m.active_bots.value, 14); assert.match(m.active_bots.note, /14’i hazır; 5’i otomatik çalışıyor/);
  assert.equal(d.charts.dailyProduction.length, 14); assert.equal(d.charts.dailyProduction.at(-1).value, 1); assert.equal(d.charts.categoryShare.length, 5);
  assert.equal(d.empty, false); assert.equal(d.charts.seoOpportunities.available, true); assert.equal(d.charts.searchVolume.buckets.length, 4);
  assert.equal(d.limitsToday.find((x) => x.workType === 'new_article').limit, 3);
  assert.equal((await c.get('/dashboard?projectId=00000000-0000-0000-0000-000000000001')).status, 404);
  const bots = (await c.get('/bots')).json;
  assert.equal(bots.items.length, 15); assert.equal(bots.items.filter((b) => b.implemented).length, 14, 'the six phase-2 bots, the three phase-3 bots, the WordPress bot and the four phase-6 bots (health, refresh, Search Console, internal links) exist'); assert.ok(bots.items.every((b) => b.lastRunAt === null), 'none has run yet: no invented last-run data');
  assert.match(bots.items[0].statusText, /Otomatik: 2 saatte bir/); assert.match(bots.items.find((b) => b.key === 'article_writer').statusText, /Otomatik kapalı; elle çalıştırılır/, 'bots that spend money start switched off'); assert.match(bots.items.find((b) => !b.implemented).statusText, /Aşama \d’te gelecek/); assert.ok(bots.items.filter((b) => !b.implemented).every((b) => b.processed === null));
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
