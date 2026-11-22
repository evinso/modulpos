// Renders the admin panel in jsdom against the REAL content API (Express router + real PostgreSQL), no mocks.
//   CONTENT_TEST_DATABASE_URL=postgresql://…/content_test npm run test:smoke      (skipped when the variable is missing)
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.CONTENT_TEST_DATABASE_URL || '';
if (!url) { console.log('SKIPPED: CONTENT_TEST_DATABASE_URL is not set (needs a real PostgreSQL database whose name ends in _test)'); process.exit(0); }
if (!/_test$/.test(new URL(url).pathname.replace(/^\//, ''))) { console.error('The database name must end in _test (it is wiped).'); process.exit(2); }

const serverDir = path.join(here, '../../../server');
const sreq = createRequire(path.join(serverDir, 'package.json'));
Object.assign(process.env, { CONTENT_ALLOW_PRIVATE_FETCH: '1', CONTENT_DATABASE_URL: url, CONTENT_DISABLED: '', CONTENT_ENCRYPTION_KEY: 'd4'.repeat(32), CONTENT_SETUP_TOKEN: 'smoke-setup-token-0123456789', CONTENT_ADMIN_ORIGINS: 'https://content.example.test', CONTENT_TIMEZONE: 'Europe/Istanbul' });
const db = sreq('./src/content/db'); const { migrate } = sreq('./src/content/migrate');
await db.query('DROP SCHEMA IF EXISTS public CASCADE'); await db.query('CREATE SCHEMA public'); await migrate();
const projects = sreq('./src/content/services/projects');
await projects.seedDefault();
const express = sreq('express'); const { buildRouter } = sreq('./src/content/routes');
const app = express(); app.set('trust proxy', 1); app.use(express.json({ limit: '5mb' })); app.use('/api/content', buildRouter(() => ({ status: 'ready' })));
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/content`;
globalThis.__srv = { db, limits: sreq('./src/content/services/limits'), articles: sreq('./src/content/services/articles'), providers: sreq('./src/content/services/providers'), projects, notifications: sreq('./src/content/services/notifications'), setupToken: process.env.CONTENT_SETUP_TOKEN };

// a news server on 127.0.0.1 that serves real captured feeds (the server's own safe fetcher reads them: no fake in between)
const FX = path.join(here, '../../../server/test/fixtures/content');
const feedServer = http.createServer((req, res) => { if (req.url.startsWith('/page.html')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE()); } const f = { '/tc.xml': 'techcrunch.rss.xml', '/bleep.xml': 'bleepingcomputer.rss.xml' }[req.url]; if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': 'application/xml' }); res.end(sreq('./test/fixtures/freshen.js').freshen(fs.readFileSync(path.join(FX, f), 'utf8'))); });                  // the captured feeds are re-dated to "now": the news module only keeps recent headlines
await new Promise((r) => feedServer.listen(0, '127.0.0.1', r));
globalThis.__feedBase = `http://127.0.0.1:${feedServer.address().port}`;
globalThis.__srv.opportunities = sreq('./src/content/services/opportunities'); globalThis.__srv.news = sreq('./src/content/services/news');
globalThis.__apify = []; globalThis.__serper = []; const { startFakeWp } = sreq('./test/content/fakeWordPress.js'); globalThis.__wp = await startFakeWp(); globalThis.__srv.scheduler = sreq('./src/content/services/scheduler'); globalThis.__srv.publishing = sreq('./src/content/services/publishing'); globalThis.__srv.settings = sreq('./src/content/services/settings'); const { fakeModels, PAGE } = sreq('./test/content/fakeModels.js'); globalThis.__models = fakeModels();

// Google (Search Console): the service-account JWT is really signed by the panel's saved key and VERIFIED by this fake; numbers are relative to the day asked for
const { makeKey, fakeGoogle } = sreq('./test/content/fakeGoogle.js'); globalThis.__gkey = makeKey();
const { fakeTelegram, update: tgUpdate, TOKEN: TG_TOKEN } = sreq('./test/content/fakeTelegram.js'); globalThis.__tg = fakeTelegram(); globalThis.__tgUpdate = tgUpdate; globalThis.__tgToken = TG_TOKEN; globalThis.__srv.telegram = sreq('./src/content/services/telegram'); globalThis.__srv.telegram.useFetch(globalThis.__tg.fetchImpl);          // Telegram's Bot API (a fake in its documented shapes)
globalThis.__srv.notifications = sreq('./src/content/services/notifications'); globalThis.__srv.comparisons = sreq('./src/content/services/comparisons');
globalThis.__fakeSite = sreq('./test/content/fakeSite.js'); globalThis.__site = await globalThis.__fakeSite.start(globalThis.__fakeSite.FRESH);          // a public WordPress site (a brand new install) for the AdSense audit
globalThis.__google = fakeGoogle({ publicKey: globalThis.__gkey.publicKey, email: globalThis.__gkey.json.client_email, sites: [{ siteUrl: 'sc-domain:e2e.example', permissionLevel: 'siteRestrictedUser' }], rows: (b) => {
  const days = []; for (let d = new Date(`${b.startDate}T00:00:00Z`); d <= new Date(`${b.endDate}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) days.push(d.toISOString().slice(0, 10));
  const dims = b.dimensions.join(',');
  if (dims === 'date,page') return days.flatMap((day) => [{ keys: [day, 'https://e2e.example/my-router-post/'], clicks: 4, impressions: 100, ctr: 0.04, position: 4 }, { keys: [day, 'https://e2e.example/not-ours/'], clicks: 1, impressions: 50, ctr: 0.02, position: 9 }]);
  if (dims === 'query,page') return [{ keys: ['e2e wifi router', 'https://e2e.example/my-router-post/'], clicks: 20, impressions: 400, ctr: 0.05, position: 4 }];
  if (dims === 'country') return [{ keys: ['usa'], clicks: 100, impressions: 2000, ctr: 0.05, position: 4 }, { keys: ['gbr'], clicks: 20, impressions: 500, ctr: 0.04, position: 6 }];
  if (dims === 'device') return [{ keys: ['MOBILE'], clicks: 90, impressions: 1500, ctr: 0.06, position: 4 }, { keys: ['DESKTOP'], clicks: 30, impressions: 1000, ctr: 0.03, position: 5 }];
  return [];
} });

const out = path.join(here, '.out-e2e.mjs');
await build({
  entryPoints: [path.join(here, 'e2e.entry.jsx')], bundle: true, platform: 'node', format: 'esm', outfile: out, loader: { '.jsx': 'jsx', '.js': 'js' }, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': JSON.stringify({ VITE_CONTENT_API_BASE_URL: base }) }, nodePaths: [path.join(here, '../node_modules')],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://content.example.test/', pretendToBeVisual: true });
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'DocumentFragment', 'Element']) {
  try { Object.defineProperty(globalThis, k, { value: dom.window[k] ?? globalThis[k], configurable: true, writable: true }); } catch { /* read-only global */ }
}
window.scrollTo = () => {};
globalThis.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function click() { globalThis.__downloads = (globalThis.__downloads || []).concat(this.download); };

// the browser: keeps the session cookie, sends the origin of the panel
const realFetch = globalThis.fetch; let cookie = '';
globalThis.fetch = async (u, init = {}) => {
  if (String(u).startsWith('https://generativelanguage.googleapis.com/v1beta/models?')) return { status: 200, ok: true, json: async () => ({ models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }] }) };          // the model list of Google AI Studio
  if (/^https:\/\/(api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com)/.test(String(u))) return globalThis.__models.fetchImpl(u, init);
  if (/^https:\/\/(oauth2\.googleapis\.com|www\.googleapis\.com\/webmasters)/.test(String(u))) return globalThis.__google.fetchImpl(u, init);
  if (String(u).startsWith('https://api.telegram.org')) return globalThis.__tg.fetchImpl(u, init);
  if (String(u).startsWith('https://google.serper.dev')) {                      // Serper.dev: easy results in the vendor's documented shape
    const body = init.body ? JSON.parse(init.body) : {}; globalThis.__serper.push({ q: body.q, key: (init.headers || {})['X-API-KEY'], path: new URL(u).pathname });
    if (/\/autocomplete$/.test(String(u))) return { ok: true, status: 200, json: async () => ({ suggestions: [{ value: `${body.q} price` }, { value: `how to ${body.q}` }] }) };
    return { ok: true, status: 200, json: async () => ({ organic: ['smallblog.dev', 'niche-tech.net', 'mysite.io', 'techie.org'].map((d, i) => ({ title: `${d} result`, link: `https://${d}/`, position: i + 1, snippet: 's', date: '5 days ago' })), peopleAlsoAsk: [{ question: 'Is it real?' }], relatedSearches: [{ query: `${body.q} news` }] }) };
  }
  if (String(u).startsWith('https://api.apify.com')) {                                                  // Apify: the account, the actor, and a synchronous actor run (the default actor's output names)
    const p = new URL(u).pathname; const body = init.body ? JSON.parse(init.body) : null; globalThis.__apify.push({ p, method: init.method || 'GET', auth: (init.headers || {}).Authorization });
    if (/run-sync-get-dataset-items$/.test(p)) return { ok: true, status: 200, json: async () => body.keywords.map((k) => (/unknown/.test(k) ? { keyword: k, search_volume: null, monthly_searches: [], data_status: 'no_data' } : { keyword: k, search_volume: /breach|chrome|techcrunch/.test(k) ? 14800 : 880, cpc: 2.1, competition: 0.35, keyword_difficulty: 29, search_intent: 'informational', monthly_searches: [], data_status: 'ok' })) };
    if (p === '/v2/users/me') return { ok: true, status: 200, json: async () => ({ data: { username: 'e2e-owner', plan: { id: 'FREE' } } }) };
    if (p === '/v2/users/me/limits') return { ok: true, status: 200, json: async () => ({ data: { current: { monthlyUsageUsd: 0.4 }, limits: { maxMonthlyUsageUsd: 5 } } }) };
    return { ok: true, status: 200, json: async () => ({ data: { name: 'keyword-research-api', username: 'gaelasao' } }) };
  }
  const headers = { ...(init.headers || {}), Origin: 'https://content.example.test', ...(cookie ? { Cookie: cookie } : {}) };
  globalThis.__inflight = (globalThis.__inflight || 0) + 1;
  let res;
  try { res = await realFetch(u, { ...init, headers }); } finally { globalThis.__inflight -= 1; }
  for (const c of res.headers.getSetCookie()) { const kv = c.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; }
  return res;
};
let code = 1;
try { await import(out); code = 0; } catch (e) { process.stderr.write(`\nTEST CRASHED: ${(e && e.stack) || e}\n`); } finally { server.close(); feedServer.close(); await globalThis.__wp.close(); await globalThis.__site.close(); await db.end(); }
// the entry decides the exit code through process.exit; reaching here means it threw
process.exit(code);
