/**
 * Numbers about a text that need no model: words, sentences, reading ease, keyword density, and how much of one text is a copy of another (shingle overlap).
 * Everything here is deterministic and cheap, so it also runs on every edit; the model-based checks only add to it.
 */
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => { const t = norm(s); return t ? t.split(' ') : []; };

/** sentences of a plain text (a full stop, ?, ! followed by a space and a capital letter or a digit; "e.g." / "U.S." do not end one) */
function sentences(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const parts = t.replace(/\b(e\.g|i\.e|vs|etc|inc|ltd|mr|mrs|ms|dr|u\.s|u\.k|no)\./gi, (m) => m.replace('.', '‹dot›')).split(/(?<=[.!?])["')\]]*\s+(?=[A-Z0-9"'(\[])/);
  return parts.map((s) => s.replace(/‹dot›/g, '.').trim()).filter(Boolean);
}

/** a rough English syllable count (vowel groups, silent final e); good enough for a reading-ease estimate, never shown as exact */
function syllables(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const g = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, g ? g.length : 1);
}

/** Flesch reading ease (higher = easier; 60-70 is plain English, news is often 40-60) and the average sentence length in words */
function readability(text) {
  const sents = sentences(text); const ws = String(text || '').split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (!sents.length || !ws.length) return { ease: null, avgSentenceWords: null, sentences: 0, words: 0 };
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  const ease = 206.835 - 1.015 * (ws.length / sents.length) - 84.6 * (syl / ws.length);
  return { ease: Math.round(Math.max(0, Math.min(100, ease))), avgSentenceWords: Math.round((ws.length / sents.length) * 10) / 10, sentences: sents.length, words: ws.length };
}

/** how often the key phrase occurs, as the share of all words it takes up (2% is a lot; over 4% is stuffing) */
function keywordStats(text, keyword) {
  const kw = words(keyword); const ws = words(text);
  if (!kw.length || !ws.length) return { count: 0, densityPct: 0, inFirst150: false };
  let count = 0; let first = -1;
  for (let i = 0; i + kw.length <= ws.length; i++) { let ok = true; for (let j = 0; j < kw.length; j++) if (ws[i + j] !== kw[j]) { ok = false; break; } if (ok) { count++; if (first < 0) first = i; i += kw.length - 1; } }
  return { count, densityPct: Math.round(((count * kw.length) / ws.length) * 1000) / 10, inFirst150: first >= 0 && first < 150 };
}

const shingles = (ws, n) => { const out = []; for (let i = 0; i + n <= ws.length; i++) out.push(ws.slice(i, i + n).join(' ')); return out; };

/**
 * How much of `text` appears word for word in `others` (an array of source texts).
 * @returns { overlapPct: share of the text's n-word phrases found in a source, longestRun: the longest stretch of consecutive words that is copied, copiedFrom: index of the source with most overlap }
 */
function copyOverlap(text, others, n = 8) {
  const ws = words(text);
  if (ws.length < n) return { overlapPct: 0, longestRun: 0, copiedFrom: null, shingles: 0 };
  const mine = shingles(ws, n);
  const hit = new Array(mine.length).fill(false); const perSource = [];
  others.forEach((o, idx) => {
    const set = new Set(shingles(words(o), n)); let c = 0;
    mine.forEach((s, i) => { if (set.has(s)) { hit[i] = true; c++; } });
    perSource.push({ idx, c });
  });
  let run = 0; let best = 0;
  for (const h of hit) { if (h) { run++; best = Math.max(best, run); } else run = 0; }
  const total = hit.filter(Boolean).length;
  const top = perSource.sort((a, b) => b.c - a.c)[0];
  return { overlapPct: Math.round((total / mine.length) * 1000) / 10, longestRun: best ? best + n - 1 : 0, copiedFrom: top && top.c > 0 ? top.idx : null, shingles: mine.length };
}

/** Jaccard similarity of two texts' 6-word phrases, in percent (near duplicates of an own article) */
function similarity(a, b, n = 6) {
  const A = new Set(shingles(words(a), n)); const B = new Set(shingles(words(b), n));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return Math.round((inter / (A.size + B.size - inter)) * 1000) / 10;
}

/** is `quote` (as written by a model) really in `source`? Compared without case, punctuation and extra spaces. */
const containsQuote = (source, quote) => { const q = norm(quote); return q.length >= 12 && norm(source).includes(q); };

module.exports = { norm, words, sentences, syllables, readability, keywordStats, copyOverlap, similarity, containsQuote };
