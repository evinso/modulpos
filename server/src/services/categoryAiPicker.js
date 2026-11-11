const { classifyAiError } = require('./aiErrors');

/**
 * Paid step of the product-level category feature: the AI does NOT search the whole Trendyol tree, it only
 * chooses among the few candidates the free rule-based matcher found for each product (cheap and hard to get wrong).
 * Every answer is checked against that product's candidate list; anything else counts as "no result" (and is not charged).
 */

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const CANDIDATES = 8;     // candidates shown to the AI per product
const BATCH = 20;         // products per AI request
const CONCURRENCY = 3;

const SYSTEM = 'Sen bir e-ticaret kategori eşleştirme asistanısın. Cevabını SADECE geçerli JSON olarak ver, başka hiçbir şey yazma.';

function buildPrompt(items) {
  const blocks = items.map((it) => {
    const cands = it.candidates.map((c) => `${c.id}|${c.path}`).join('\n');
    return `#${it.key}\nÜrün: ${String(it.title).slice(0, 160)}\nXML kategorisi: ${String(it.xmlCategory || '-').slice(0, 120)}\nAdaylar (id|yol):\n${cands}`;
  });
  return `Her ürün için, adaylar arasından ürünün GERÇEKTE ne olduğuna en uygun Trendyol kategorisini seç.

Kurallar:
- Sadece o ürünün altında verilen adayların id değerlerinden birini seç.
- XML kategorisi genelde çok geniştir; ürün başlığına göre karar ver.
- Hiçbir aday ürüne uymuyorsa 0 yaz (tahmin etme, yanlış kategori ürünün reddedilmesine yol açar).
- Sadece JSON döndür.

${blocks.join('\n\n')}

JSON formatı:
{"picks": {"1": 12345, "2": 0}}`;
}

function parsePicks(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON bulunamadı');
  const parsed = JSON.parse(text.slice(start, end + 1));
  return parsed.picks && typeof parsed.picks === 'object' ? parsed.picks : {};
}

/** One AI request for up to BATCH products. Returns { key: candidateId|null }. Throws on API errors. */
async function pickBatch(client, items, model) {
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(items) }],
  });
  const text = (message.content && message.content[0] && message.content[0].text || '').trim();
  if (!text) throw new Error('AI boş yanıt verdi');
  const picks = parsePicks(text);
  const out = {};
  for (const it of items) {
    const raw = picks[it.key];
    const hit = it.candidates.find((c) => String(c.id) === String(raw));
    out[it.key] = hit ? hit.id : null;
  }
  return out;
}

/**
 * @param client   Anthropic client (or a stand-in with messages.create)
 * @param products [{ id, title, category }]
 * @param matcher  CategoryMatcher
 * @returns { results: [{ productId, categoryId|null, path|null }], noCandidates, failure|null, error|null }
 *          failure = classifyAiError info of the first AI error (fatal ones stop the run at once)
 */
async function matchProducts({ client, products, matcher, model = DEFAULT_MODEL }) {
  const results = new Map();
  const work = [];
  let noCandidates = 0;
  for (const p of products) {
    const candidates = matcher.suggest(p.title, { context: p.category, top: CANDIDATES });
    if (candidates.length === 0) { results.set(p.id, null); noCandidates++; continue; }
    work.push({ product: p, candidates });
  }

  const batches = [];
  for (let i = 0; i < work.length; i += BATCH) batches.push(work.slice(i, i + BATCH));

  let failure = null;
  let firstError = null; // the raw error behind `failure`, so the caller can word it for its own reader
  let stopped = false;
  let next = 0;
  const worker = async () => {
    while (!stopped) {
      const idx = next++;
      if (idx >= batches.length) return;
      const batch = batches[idx];
      const items = batch.map((w, i) => ({ key: String(i + 1), title: w.product.title, xmlCategory: w.product.category, candidates: w.candidates }));
      try {
        const picks = await pickBatch(client, items, model);
        batch.forEach((w, i) => results.set(w.product.id, picks[String(i + 1)] ?? null));
      } catch (err) {
        const info = classifyAiError(err, { admin: true });
        if (!failure || (info.fatal && !failure.fatal)) { failure = info; firstError = err; }
        if (info.fatal) stopped = true;
        for (const w of batch) if (!results.has(w.product.id)) results.set(w.product.id, undefined); // undefined = not answered
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

  const out = products.map((p) => {
    const id = results.get(p.id);
    const leaf = id ? matcher.get(id) : null;
    return { productId: p.id, categoryId: leaf ? leaf.id : null, path: leaf ? leaf.path : null, answered: id !== undefined && results.has(p.id) };
  });
  return { results: out, noCandidates, failure, error: firstError };
}

module.exports = { matchProducts, pickBatch, buildPrompt, DEFAULT_MODEL, CANDIDATES, BATCH };
