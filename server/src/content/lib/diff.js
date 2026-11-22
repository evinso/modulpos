/**
 * Word-level difference of two texts (Myers' O(ND) algorithm), for "what changed between version 2 and 3" and for the refresh proposals. Pure, no database.
 * Returns runs: [{ t: 'eq' | 'ins' | 'del', text }] with neighbouring words of the same kind joined. A comparison that would take too long (the texts have almost nothing in
 * common) is answered as one big deletion and one big insertion, flagged `coarse`.
 */
const MAX_D = 3000;

function myers(a, b) {
  const n = a.length; const m = b.length; const max = Math.min(n + m, MAX_D);
  const v = new Map([[1, 0]]); const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && (v.get(k - 1) || 0) < (v.get(k + 1) || 0))) ? (v.get(k + 1) || 0) : (v.get(k - 1) || 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) return backtrack(trace, a, b);
    }
  }
  return null;
}

function backtrack(trace, a, b) {
  const ops = []; let x = a.length; let y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]; const k = x - y;
    const prevK = (k === -d || (k !== d && (v.get(k - 1) || 0) < (v.get(k + 1) || 0))) ? k + 1 : k - 1;
    const prevX = v.get(prevK) || 0; const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ t: 'eq', text: a[x - 1] }); x--; y--; }
    if (d > 0) { if (x === prevX) ops.push({ t: 'ins', text: b[y - 1] }); else ops.push({ t: 'del', text: a[x - 1] }); }
    x = prevX; y = prevY;
  }
  return ops.reverse();
}

const words = (s) => String(s || '').split(/\s+/).filter(Boolean);

function diffWords(before, after) {
  const a = words(before); const b = words(after);
  let ops = myers(a, b); let coarse = false;
  if (!ops) { coarse = true; ops = [...a.map((text) => ({ t: 'del', text })), ...b.map((text) => ({ t: 'ins', text }))]; }
  const runs = [];
  for (const o of ops) { const last = runs[runs.length - 1]; if (last && last.t === o.t) last.text += ` ${o.text}`; else runs.push({ ...o }); }
  const stat = (t) => ops.filter((o) => o.t === t).length;
  return { runs, added: stat('ins'), removed: stat('del'), unchanged: stat('eq'), coarse, changedShare: a.length + b.length ? Math.round(((stat('ins') + stat('del')) / (a.length + b.length)) * 1000) / 10 : 0 };
}

module.exports = { diffWords, words };
