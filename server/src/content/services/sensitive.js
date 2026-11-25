const db = require('../db');
const H = require('../lib/html');
const checks = require('./checks');
const notifications = require('./notifications');

/**
 * THE SENSITIVE CONTENT BOT (key `sensitive_scanner`). The owner took the AdSense gate off the publishing path ("makale yine paylaşılsın") and asked for this instead: a separate bot that FINDS the sensitive details
 * of an article - a data breach, a ransomware attack, personal data in the text, health data, children, violence, scams, financial / legal advice - and says what and where. It never holds an article back
 * and never changes its text: it only records (`sensitive_findings`), shows an information line in the editor ("Hazır mı?" list), a badge next to the published article and tells the owner once per kind.
 * Free: patterns over the text (deterministic, no model), plus the AdSense reviewer's own note for its "sensitive" category when the checks already produced one.
 */
const BOT = 'sensitive_scanner';

/** kind -> { label, severity, re }. The patterns are deliberately plain words (English articles); a hit is a pointer for a person, not a verdict. */
const KINDS = {
  data_breach: { label: 'Veri ihlali', severity: 'notice', re: /\b(data breach(?:es)?|data leaks?|leaked data|breach(?:ed)?|(?:exposed|stolen|compromised) (?:personal|customer|patient|user|sensitive|account|login|credential)\w*|unauthori[sz]ed access|hackers?|hacked|cyber ?attacks?|credential (?:leaks?|dumps?)|(?:information|data|records) (?:was|were) (?:exposed|stolen|accessed))\b/i },
  ransomware: { label: 'Fidye yazılımı', severity: 'notice', re: /\b(ransomware|ransom (?:demand|note|payment|negotiat\w+)|extort\w*|encrypted (?:files|systems|data)|lockbit|black ?cat|alphv|black basta|akira|double extortion|decryptor)\b/i },
  phishing_scam: { label: 'Kimlik avı / dolandırıcılık', severity: 'notice', re: /\b(phishing|smishing|scams?|scammers?|fraud\w*|social engineering|identity theft|spoof\w*|impersonat\w+)\b/i },
  health: { label: 'Sağlık verisi / tıbbi içerik', severity: 'notice', re: /\b(patients?|medical records?|health records?|health data|HIPAA|protected health information)\b/i },
  minors: { label: 'Çocuklar / küçükler', severity: 'high', re: /\b(?:children|child|minors?|kids|students|underage)\b[^.!?]{0,80}\b(?:data|records|abuse|exploit\w*|images|photos|leak\w*|exposed|breach\w*)\b|\b(?:data|records|abuse|exploit\w*|leak\w*|breach\w*)\b[^.!?]{0,80}\b(?:children|child|minors?|kids|students|underage)\b/i },
  violence: { label: 'Şiddet / suç', severity: 'notice', re: /\b(shooting|shot dead|stabb\w+|murder\w*|homicide|assault\w*|terroris\w+|bomb(?:ing|ed)?|kidnap\w*)\b/i },
  advice: { label: 'Hukuki / finansal tavsiye', severity: 'notice', re: /\b(guaranteed (?:returns?|profits?)|investment advice|financial advice|legal advice|get rich)\b/i },
};

const luhn = (digits) => { let sum = 0; let alt = false; for (let i = digits.length - 1; i >= 0; i--) { let n = Number(digits[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; };
/** personal data that sits in the text itself (not a topic: a reader can see it): an SSN-shaped number, an e-mail address, a phone number, a card number */
function personalData(text) {
  const hits = [];
  for (const m of text.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) hits.push({ what: 'SSN biçiminde numara', at: m.index });
  for (const m of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) hits.push({ what: 'e-posta adresi', at: m.index });
  for (const m of text.matchAll(/\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g)) hits.push({ what: 'telefon numarası', at: m.index });
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) { const d = m[0].replace(/\D/g, ''); if (d.length >= 13 && d.length <= 19 && luhn(d)) hits.push({ what: 'kart numarası biçiminde sayı', at: m.index }); }
  return hits;
}

const sentences = (text) => String(text).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const clip = (s) => (s.length > 220 ? `${s.slice(0, 217).replace(/\s+\S*$/, '')}…` : s);

/** @returns [{ kind, label, severity, count, snippet }] (most serious first) */
function scanText(text) {
  const t = String(text || ''); const ss = sentences(t); const out = [];
  for (const [kind, k] of Object.entries(KINDS)) {
    const re = new RegExp(k.re.source, 'gi'); let count = 0; let snippet = '';
    for (const s of ss) { const m = s.match(re); if (m) { count += m.length; if (!snippet) snippet = clip(s); } }
    if (count) out.push({ kind, label: k.label, severity: k.severity, count, snippet });
  }
  const pd = personalData(t);
  if (pd.length) { const first = pd[0]; const s = ss.find((x) => t.indexOf(x) <= first.at && first.at < t.indexOf(x) + x.length) || t.slice(Math.max(0, first.at - 60), first.at + 80); out.push({ kind: 'personal_data', label: 'Kişisel veri (metinde)', severity: 'high', count: pd.length, snippet: clip(`${s}`), what: [...new Set(pd.map((x) => x.what))] }); }
  return out.sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'high' ? -1 : 1));
}

const shape = (r) => (r ? { articleId: r.article_id, projectId: r.project_id, version: r.article_version, kinds: r.kinds, severity: r.severity, reviewerNote: r.reviewer_note, scannedAt: r.scanned_at } : null);
async function get(articleId) { return shape((await db.query('SELECT * FROM sensitive_findings WHERE article_id = $1', [articleId])).rows[0]); }

/** the AdSense reviewer's own words about the "sensitive" category of this version, when the checks produced them and it did not say "pass" */
async function reviewerNote(articleId, version) {
  const c = await checks.latestOf(articleId, 'review', version);
  const cat = c && c.result && c.result.categories && c.result.categories.sensitive;
  return cat && cat.status && cat.status !== 'pass' ? String(cat.note || '').slice(0, 400) : '';
}

/**
 * Scans one article (its current text version). Nothing happens when this version was scanned already, unless `force`. Tells the owner about every kind it has not told about yet (once).
 * @returns { articleId, kinds, severity, scanned, notified: [kind] }
 */
async function scanArticle(articleId, { force = false } = {}) {
  const a = (await db.query('SELECT id, project_id, h1, status, current_version, content_html FROM articles WHERE id = $1', [articleId])).rows[0];
  if (!a) return null;
  const prev = (await db.query('SELECT * FROM sensitive_findings WHERE article_id = $1', [a.id])).rows[0];
  if (prev && prev.article_version === a.current_version && !force) return { articleId: a.id, kinds: prev.kinds, severity: prev.severity, scanned: false, notified: [] };
  const kinds = scanText(H.htmlToText(a.content_html));
  const note = await reviewerNote(a.id, a.current_version);
  const severity = !kinds.length ? 'none' : kinds.some((k) => k.severity === 'high') ? 'high' : 'notice';
  const told = new Set(prev ? prev.notified_kinds : []); const fresh = kinds.filter((k) => !told.has(k.kind));
  await db.query(`INSERT INTO sensitive_findings (article_id, project_id, article_version, kinds, severity, reviewer_note, notified_kinds, scanned_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())
    ON CONFLICT (article_id) DO UPDATE SET article_version = $3, kinds = $4, severity = $5, reviewer_note = $6, notified_kinds = $7, scanned_at = now()`,
  [a.id, a.project_id, a.current_version, JSON.stringify(kinds), severity, note, [...told, ...fresh.map((k) => k.kind)]]);
  if (fresh.length) {
    const live = ['published', 'scheduled'].includes(a.status);
    await notifications.create({ type: 'sensitive_found', severity: fresh.some((k) => k.severity === 'high') ? 'warning' : 'info',
      title: `Hassas konu bulundu: ${fresh.map((k) => k.label).join(', ')} — “${String(a.h1).slice(0, 80)}”`,
      body: `${live ? 'Makale yayında' : 'Makale taslak/hazır'}; bot yayını engellemez, yalnızca gösterir.\n${fresh.map((k) => `• ${k.label} (${k.count} yer): ${k.snippet}`).join('\n')}${note ? `\nAdSense inceleyicisinin notu: ${note}` : ''}`, data: { articleId: a.id, kinds: fresh.map((k) => k.kind) } });
  }
  return { articleId: a.id, kinds, severity, scanned: true, notified: fresh.map((k) => k.kind) };
}

/** the scheduled pass: every article of the project (not archived / failed) whose current text has not been scanned yet */
async function scanProject(projectId, { limit = 60 } = {}) {
  const ids = (await db.query(`SELECT a.id FROM articles a LEFT JOIN sensitive_findings s ON s.article_id = a.id
     WHERE a.project_id = $1 AND a.status NOT IN ('archived', 'failed') AND (s.article_id IS NULL OR s.article_version <> a.current_version) ORDER BY a.created_at DESC LIMIT $2`, [projectId, limit])).rows.map((r) => r.id);
  const stats = { scanned: 0, withFindings: 0, kinds: {} };
  for (const id of ids) {
    const r = await scanArticle(id); if (!r || !r.scanned) continue;
    stats.scanned++; if (r.kinds.length) { stats.withFindings++; for (const k of r.kinds) stats.kinds[k.kind] = (stats.kinds[k.kind] || 0) + 1; }
  }
  return stats;
}

/** kind labels per article for a list of articles (the Otomatik Üretim card's badge) */
async function labelsFor(articleIds) {
  if (!articleIds.length) return new Map();
  const rows = (await db.query("SELECT article_id, kinds FROM sensitive_findings WHERE article_id = ANY($1) AND severity <> 'none'", [articleIds])).rows;
  return new Map(rows.map((r) => [r.article_id, r.kinds.map((k) => k.label)]));
}

module.exports = { BOT, KINDS, scanText, scanArticle, scanProject, get, labelsFor };
