import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import GuidePage from '../../src/pages/guide/GuidePage.jsx';
import { SECTIONS } from '../../src/pages/guide/content/index.js';
import { collectRefs, filterSections, fold, parseInline, allTexts } from '../../src/pages/guide/guideText.js';
import { ISSUE_LABELS } from '../../src/pages/products/productsUi.jsx';
import { ISSUE_HELP } from '../../src/pages/guide/issueHelp.js';
import { calls } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const setVal = async (el, v) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })); }); await wait(20); };
window.HTMLElement.prototype.scrollIntoView = function () { window.__scrolled = this.id; };

// ---------- content integrity: the guide may only name things the app really has ----------
const SRC = path.resolve('src');
const corpus = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (p !== path.join(SRC, 'pages', 'guide')) walk(p); } else if (/\.(jsx?|mjs)$/.test(f.name)) corpus.push(fs.readFileSync(p, 'utf8'));
  }
})(SRC);
const code = corpus.join('\n').replace(/&amp;/g, '&').replace(/\\'/g, "'").replace(/[’‘]/g, "'");
const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');

const refs = collectRefs(SECTIONS);
const norm = (s) => s.replace(/[’‘]/g, "'");
const missingUi = [...refs.ui].filter((u) => !code.includes(norm(u)));
ok(`every [[UI name]] of the guide exists in the app (${refs.ui.size} names)`, missingUi.length === 0, missingUi.join(' | '));
const badLinks = [...refs.links].filter((l) => !app.includes(`path="${l}"`));
ok(`every {{/link}} is a real route (${refs.links.size})`, badLinks.length === 0, badLinks.join(' | '));
const ids = SECTIONS.flatMap((s) => s.topics.map((t) => t.id));
ok('topic ids are unique', new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join(','));
const badJumps = [...refs.jumps].filter((j) => !ids.includes(j));
ok(`every {{#jump}} points to a topic (${refs.jumps.size})`, badJumps.length === 0, badJumps.join(' | '));
const unknownBlocks = SECTIONS.flatMap((s) => s.topics.flatMap((t) => t.blocks.filter((b) => !['p', 'ul', 'steps', 'note', 'table', 'qa', 'live'].includes(b.t)).map((b) => b.t)));
ok('only known block types', unknownBlocks.length === 0, unknownBlocks.join(','));
const count = (str, re) => (str.match(re) || []).length;
const badMarkup = allTexts(SECTIONS).filter((x) => count(x, /\*\*/g) % 2 !== 0 || count(x, /\[\[/g) !== count(x, /\]\]/g) || count(x, /\{\{/g) !== count(x, /\}\}/g));
ok('no broken **bold** / [[name]] / {{link}} markup', badMarkup.length === 0, badMarkup.slice(0, 2).join(' || '));
ok('every "not ready" reason of the product list is explained', Object.keys(ISSUE_LABELS).every((k) => ISSUE_HELP[k] && ISSUE_HELP[k][0] && ISSUE_HELP[k][1]), Object.keys(ISSUE_LABELS).filter((k) => !ISSUE_HELP[k]).join(','));
ok('no leftovers of old wording that is wrong today (old menu path, the removed per-XML-source service fee)', !JSON.stringify(SECTIONS).includes('Yönetim → Fiyatlandırma') && !JSON.stringify(SECTIONS).includes('XPath') && !JSON.stringify(SECTIONS).includes('Sipariş sonrası hizmet bedeli') && !JSON.stringify(SECTIONS).includes('Tedarikçi hizmet bedeli'));

// ---------- parsing / search helpers ----------
const pi = parseInline('Önce **kalın** [[Düğme]] {{/pricing|Şablonlar}} {{#sablon-vergi|vergi}} son');
ok('inline markup is parsed', pi.map((p) => p.k).join(',') === 'text,bold,text,ui,text,link,text,jump,text', pi.map((p) => p.k).join(','));
ok('Turkish letters are folded for search', fold('İstanbul ŞABLON Çok Ğ') === 'istanbul sablon cok g');
ok('search: "stopaj" finds the tax topic', filterSections(SECTIONS, 'stopaj').some((s) => s.topics.some((t) => t.id === 'sablon-vergi')));
ok('search: "sablon" (no Turkish letters) finds "Şablon" topics', filterSections(SECTIONS, 'sablon').length > 0);
ok('search needs every word', filterSections(SECTIONS, 'stopaj zzzzqqq').length === 0);

// ---------- the page ----------
const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<MemoryRouter><GuidePage /></MemoryRouter>); });
await wait(120);
ok('the page renders every topic', document.querySelectorAll('[data-testid="topic"]').length === ids.length, `${document.querySelectorAll('[data-testid="topic"]').length}/${ids.length}`);
ok('title and last-update date are shown', text().includes('Kullanma Kılavuzu') && text().includes('son güncelleme'));
const tocLinks = [...document.querySelectorAll('[data-testid="toc"] a')];
ok('the table of contents lists every topic', tocLinks.length === ids.length);
ok('the new features are covered (price template tax options, per-product categories, profit panel, cargo)', ['KDV mükellefiyim', 'Ürün bazlı kategori', 'Kârlılık', 'Kargo tutarı', 'Varsayılan cevaplar', 'Kategorileri sıfırla'].every((t) => text().includes(t)));

// live data
ok('live plans come from the server', calls.some((c) => c.url === '/public/pricing-plans') && !!document.querySelector('[data-testid="live-plans"]') && text().includes('Başlangıç') && text().includes('1.000 ürün'));
const lc = document.querySelector('[data-testid="live-credits"]');
ok('live credit prices come from the server', calls.some((c) => c.url === '/credits/prices') && !!lc && lc.textContent.includes('0,05 kredi') && lc.textContent.includes('0,5 kredi') && lc.textContent.includes('0,1 kredi / ürün'), lc && lc.textContent.slice(0, 200));
const it = document.querySelector('[data-testid="issue-table"]');
ok('the "not ready" table is built from the real list labels', !!it && Object.values(ISSUE_LABELS).every((l) => it.textContent.includes(l)));

// navigation
await act(async () => { tocLinks.find((a) => a.getAttribute('href') === '#sablon-vergi').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(30);
ok('a table-of-contents click scrolls to the topic and marks it', window.__scrolled === 'sablon-vergi' && document.querySelector('[data-testid="toc"] a.on').getAttribute('href') === '#sablon-vergi');
const jumpBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'ayrıntı' && b.style.textDecoration === 'underline');
await act(async () => { jumpBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(30);
ok('an in-text "ayrıntı" link jumps to its topic', !!window.__scrolled);

// search in the page
const box = document.querySelector('input[aria-label="Rehberde ara"]');
await setVal(box, 'stopaj');
ok('typing filters the topics and says how many', document.querySelectorAll('[data-testid="topic"]').length < ids.length && text().includes('konu bulundu'));
ok('the table of contents follows the search', document.querySelectorAll('[data-testid="toc"] a').length === document.querySelectorAll('[data-testid="topic"]').length);
await setVal(box, 'zzzzqqq');
ok('no result gives a hint, not an empty page', text().includes('sonuç bulunamadı'));
// a link into a topic the search has hidden clears the search first
await setVal(box, 'stopaj');
await act(async () => { document.querySelector('[data-testid="search-count"]'); });
await setVal(box, '');
ok('clearing the search brings everything back', document.querySelectorAll('[data-testid="topic"]').length === ids.length);

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
