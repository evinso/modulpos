// Renders the admin panel in jsdom against the REAL content API (Express router + real PostgreSQL), no mocks.
//   CONTENT_TEST_DATABASE_URL=postgresql://…/content_test npm run test:smoke      (skipped when the variable is missing)
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.CONTENT_TEST_DATABASE_URL || '';
if (!url) { console.log('SKIPPED: CONTENT_TEST_DATABASE_URL is not set (needs a real PostgreSQL database whose name ends in _test)'); process.exit(0); }
if (!/_test$/.test(new URL(url).pathname.replace(/^\//, ''))) { console.error('The database name must end in _test (it is wiped).'); process.exit(2); }

const serverDir = path.join(here, '../../../server');
const sreq = createRequire(path.join(serverDir, 'package.json'));
Object.assign(process.env, { CONTENT_DATABASE_URL: url, CONTENT_DISABLED: '', CONTENT_ENCRYPTION_KEY: 'd4'.repeat(32), CONTENT_SETUP_TOKEN: 'smoke-setup-token-0123456789', CONTENT_ADMIN_ORIGINS: 'https://content.example.test', CONTENT_TIMEZONE: 'Europe/Istanbul' });
const db = sreq('./src/content/db'); const { migrate } = sreq('./src/content/migrate');
await db.query('DROP SCHEMA IF EXISTS public CASCADE'); await db.query('CREATE SCHEMA public'); await migrate();
const projects = sreq('./src/content/services/projects');
await projects.seedDefault();
const express = sreq('express'); const { buildRouter } = sreq('./src/content/routes');
const app = express(); app.set('trust proxy', 1); app.use(express.json({ limit: '5mb' })); app.use('/api/content', buildRouter(() => ({ status: 'ready' })));
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/content`;
globalThis.__srv = { db, limits: sreq('./src/content/services/limits'), articles: sreq('./src/content/services/articles'), providers: sreq('./src/content/services/providers'), projects, notifications: sreq('./src/content/services/notifications'), setupToken: process.env.CONTENT_SETUP_TOKEN };

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
  const headers = { ...(init.headers || {}), Origin: 'https://content.example.test', ...(cookie ? { Cookie: cookie } : {}) };
  globalThis.__inflight = (globalThis.__inflight || 0) + 1;
  let res;
  try { res = await realFetch(u, { ...init, headers }); } finally { globalThis.__inflight -= 1; }
  for (const c of res.headers.getSetCookie()) { const kv = c.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; }
  return res;
};
let code = 1;
try { await import(out); code = 0; } catch (e) { process.stderr.write(`\nTEST CRASHED: ${(e && e.stack) || e}\n`); } finally { server.close(); await db.end(); }
// the entry decides the exit code through process.exit; reaching here means it threw
process.exit(code);
