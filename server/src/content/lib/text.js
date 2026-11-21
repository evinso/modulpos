const crypto = require('node:crypto');

/**
 * Text helpers for headlines: folding, tokens, event similarity, phrase matching, canonical URLs.
 * Plain deterministic code (no AI, no network): the same headline always gives the same answer, and every rule is testable.
 */
const TR = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
/** lower case ASCII words separated by single spaces (Turkish letters and accents folded, punctuation = space). */
const fold = (s) => String(s || '').toLowerCase().replace(/[çğıöşü]/g, (c) => TR[c]).replace(/i̇/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/['’`]s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set(('a an the and or but if of to in on at by for from with without about into over after before under between through during up down out off this that these those it its is are was were be been being has have had do does did will would can could should may might ' +
  'as than then so such not no nor only own same too very just also more most other some any each every both few new says say said report reports reported how what why when where who whom which while you your we our they their he she his her i me my us them ' +
  'get gets got getting here there now today yesterday tomorrow week year years day days one two three first latest could ahead amid via per vs ' +
  'announces announced announcing launches launched unveils unveiled reveals revealed introduces introduced rolls rolling').split(' '));

/** word tokens of a text without filler words; light plural stripping. Numbers are kept (ios 26 and ios 27 are different events). */
function tokens(text) {
  const out = [];
  for (const w of fold(text).split(' ')) {
    if (!w || STOP.has(w)) continue;
    let t = w;
    if (t.length > 4 && t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
    else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !/^\d/.test(t)) t = t.slice(0, -1);
    if (t.length >= 2 || /^\d$/.test(t)) out.push(t);
  }
  return out;
}

const tokenSet = (text) => new Set(tokens(text));

/** Sørensen–Dice similarity of two token sets (0..1). */
function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/** Version numbers and other numbers of a headline ("26.2", "11", "142"): two headlines about different versions are different events. */
const numbers = (text) => new Set(String(text || '').match(/\b\d+(?:\.\d+)*\b/g) || []);

/** What is compared when clustering: meaningful words, numbers, the folded headline. */
const signature = (title) => ({ set: tokenSet(title), nums: numbers(title), key: fold(title) });

/**
 * Do two headlines describe the same event?
 *  - different version numbers (iOS 26.1 / iOS 26.2) = different events
 *  - two headlines of the SAME source are the same event only when almost identical in wording (Dice >= 0.9) but not literally equal (a source repeating a template
 *    headline - "Chrome Dev for Android Update", "CISA Adds Known Exploited Vulnerabilities" - is publishing different things)
 *  - otherwise: Dice >= 0.7 with 2 shared words, Dice >= 0.5 with 3 shared words, or 4 shared words that make up 3/4 of the shorter headline
 * Headlines of one subject but different events ("OpenAI launches X" / "OpenAI raises prices") share few words and stay apart.
 */
function sameEvent(a, b, { sameSource = false } = {}) {
  if (!a.set.size || !b.set.size) return false;
  if (a.nums.size && b.nums.size && ![...a.nums].some((n) => b.nums.has(n))) return false;
  const d = dice(a.set, b.set);
  if (sameSource && (a.key === b.key || d < 0.9)) return false;
  let inter = 0; for (const x of a.set) if (b.set.has(x)) inter++;
  return (d >= 0.7 && inter >= 2) || (d >= 0.5 && inter >= 3) || (inter >= 4 && inter / Math.min(a.set.size, b.set.size) >= 0.75);
}

/** "Headline - Publisher" / "Headline | Publisher" -> "Headline" (only when the tail looks like a publisher name). */
function stripPublisher(title, publisher = '') {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*\S)\s+[-–—|]\s+([^-–—|]{2,40})$/);
  if (!m) return t;
  const tail = m[2].trim();
  if (publisher && fold(tail) === fold(publisher)) return m[1];
  return tail.split(' ').length <= 5 && !/[.!?]$/.test(tail) && m[1].length >= 20 ? m[1] : t;
}

const TRACKING = /^(utm_|fbclid|gclid|dclid|msclkid|mc_|ref$|ref_|source$|cmp$|cid$|ocid$|rss$|guccounter|guce_)/i;
/** One address per article: lower-case host, no fragment, no tracking parameters, no trailing slash. */
function canonicalUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    u.hash = ''; u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s.slice(0, 1000);
  } catch { return ''; }
}
const urlHash = (url) => crypto.createHash('sha1').update(canonicalUrl(url) || String(url)).digest('hex');

/** Cuts at a word boundary and adds an ellipsis only when something was cut. */
function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max); const i = cut.lastIndexOf(' ');
  return `${(i > max * 0.6 ? cut.slice(0, i) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}

/** Candidate search phrases (2 to 4 words) from a headline: runs of meaningful words in their original order, lower case. */
function phrases(text, { min = 2, max = 4 } = {}) {
  const words = fold(text).split(' ').filter(Boolean);
  const out = new Set();
  let run = [];
  const flush = () => {
    for (let n = Math.min(max, run.length); n >= min; n--) for (let i = 0; i + n <= run.length; i++) out.add(run.slice(i, i + n).join(' '));
    run = [];
  };
  for (const w of words) { if (STOP.has(w) || w.length < 2) flush(); else run.push(w); }
  flush();
  return [...out];
}

/**
 * Which of the terms appear in the text as whole words / whole phrases ("ai" is not found inside "said"; a plural "s" is tolerated)?
 * @returns the matched terms (as given)
 */
function matchTerms(text, terms) {
  const hay = ` ${fold(text)} `;
  const hit = [];
  for (const t of terms || []) {
    const f = fold(t);
    if (f && (hay.includes(` ${f} `) || hay.includes(` ${f}s `) || hay.includes(` ${f}es `))) hit.push(t);
  }
  return hit;
}

module.exports = { fold, tokens, tokenSet, numbers, signature, dice, sameEvent, stripPublisher, canonicalUrl, urlHash, clip, phrases, matchTerms, STOP };
