// Renders the products screen in jsdom with a mocked API and clicks through the main flows.
//   npm run test:smoke        (no browser, no network, no backend needed)
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] || 'products';
const out = path.join(here, `.out-${name}.mjs`);
await build({
  entryPoints: [path.join(here, `${name}.entry.jsx`)], bundle: true, platform: 'node', format: 'esm', outfile: out,
  loader: { '.jsx': 'jsx', '.js': 'js' }, jsx: 'automatic', define: { 'import.meta.env': '{}' }, logLevel: 'error', nodePaths: [path.join(here, '../../node_modules')],
  plugins: [{ name: 'stub-api', setup(b) { b.onResolve({ filter: /services\/api$/ }, () => ({ path: path.join(here, 'apiStub.cjs') })); } }],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://modulpos.com/', pretendToBeVisual: true });
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle']) {
  try { Object.defineProperty(globalThis, k, { value: dom.window[k] ?? globalThis[k], configurable: true, writable: true }); } catch { /* read-only global */ }
}
window.scrollTo = () => {}; window.confirm = () => true;
await import(out);
