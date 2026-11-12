const { classifyAiError } = require('./aiErrors');
const { normText } = require('./categoryMatcher');
const { words, NEVER_FROM_TEXT } = require('./attributeFromText');

/**
 * Paid step for the required attributes that the free text reading could not fill: the AI reads a product's title and description and chooses
 * the value of each open attribute - ONLY among the values Trendyol allows for it. Every answer is checked against that list; anything else,
 * and "not stated", counts as no result (and is not charged). The AI is told not to guess: an empty attribute is better than a wrong one.
 */

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const BATCH = 8;            // products per AI request
const CONCURRENCY = 3;
const MAX_OPTIONS = 60;     // lists up to this long are shown whole
const MAX_FILTERED = 40;    // longer lists (authors, countries, sizes): only values that share a word with the text, at most this many

const SYSTEM = 'Sen bir e-ticaret ürün özelliği doldurma asistanısın. Cevabını SADECE geçerli JSON olarak ver, başka hiçbir şey yazma.';

/** The values the AI may choose from for one attribute of one product, or null when it cannot be asked. */
function optionsFor(def, title, description) {
  if (NEVER_FROM_TEXT.has(words(def.name).join(' '))) return null;
  const values = (def.values || []).filter((v) => v && v.name && normText(v.name) !== 'belirtilmemis');
  if (values.length === 0) return null;
  if (values.length <= MAX_OPTIONS) return values;
  const textWords = new Set(words(`${title} ${description}`).filter((w) => w.length >= 3));
  const near = values.filter((v) => words(v.name).some((w) => w.length >= 3 && textWords.has(w))).slice(0, MAX_FILTERED);
  return near.length ? near : null;
}

function buildPrompt(items) {
  const blocks = items.map((it) => {
    const attrs = it.attrs.map((a) => `- [${a.id}] ${a.name}: ${a.options.map((o) => o.name).join(' | ')}`).join('\n');
    return `#${it.key}\nÜrün: ${String(it.title).slice(0, 160)}\nAçıklama: ${String(it.description || '-').slice(0, 500)}\nÖzellikler (köşeli parantez içindeki sayı özellik numarasıdır):\n${attrs}`;
  });
  return `Her ürün için, listelenen özelliklerin değerini ürünün başlığına ve açıklamasına bakarak seç.

Kurallar:
- Değer, o özelliğin yanında verilen seçeneklerden biri olmalı; seçeneği harfi harfine yaz.
- Yalnızca başlıkta ya da açıklamada AÇIKÇA yazan veya kesin olarak çıkarılabilen değerleri seç.
- Emin değilsen, metinde hiç geçmiyorsa ya da tahmin etmen gerekiyorsa null yaz. Yanlış değer, ürünün reddedilmesine yol açar; boş bırakmak daha iyidir.
- Sadece JSON döndür.

${blocks.join('\n\n')}

JSON formatı (özellik numarası -> seçilen değer ya da null):
{"picks": {"1": {"123": "Kadın", "124": null}, "2": {"123": null}}}`;
}

function parsePicks(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON bulunamadı');
  const parsed = JSON.parse(text.slice(start, end + 1));
  return parsed.picks && typeof parsed.picks === 'object' ? parsed.picks : {};
}

/** One AI request for up to BATCH products. Returns { key: { attrId: {valueId, valueName} } } with only valid answers. Throws on API errors. */
async function pickBatch(client, items, model) {
  const message = await client.messages.create({
    model,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(items) }],
  });
  const text = (message.content && message.content[0] && message.content[0].text || '').trim();
  if (!text) throw new Error('AI boş yanıt verdi');
  const picks = parsePicks(text);
  const out = {};
  for (const it of items) {
    const mine = picks[it.key] && typeof picks[it.key] === 'object' ? picks[it.key] : {};
    const got = {};
    for (const a of it.attrs) {
      const raw = mine[a.id];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const hit = a.options.find((o) => normText(o.name) === normText(raw));
      if (hit) got[a.id] = { valueId: String(hit.id), valueName: hit.name };
    }
    out[it.key] = got;
  }
  return out;
}

/**
 * @param client   Anthropic client (or a stand-in with messages.create)
 * @param products [{ key, title, description, defs: [{ id, name, values }] }]  defs = the open required attributes of that product
 * @returns { results: Map(key -> { attrId: { valueId, valueName } }), asked: [keys sent to the AI], failure, error }
 *          attributes that cannot be asked (no list, only about the seller) are left out; a product with nothing to ask is not in `asked`
 */
async function pickAttributes({ client, products, model = DEFAULT_MODEL }) {
  const work = [];
  for (const p of products) {
    const attrs = [];
    for (const d of p.defs) {
      const options = optionsFor(d, p.title, p.description);
      if (options) attrs.push({ id: String(d.id), name: d.name, options });
    }
    if (attrs.length) work.push({ key: p.key, title: p.title, description: p.description, attrs });
  }
  const results = new Map();
  const batches = [];
  for (let i = 0; i < work.length; i += BATCH) batches.push(work.slice(i, i + BATCH));

  let failure = null;
  let firstError = null;
  let stopped = false;
  let next = 0;
  const worker = async () => {
    while (!stopped) {
      const idx = next++;
      if (idx >= batches.length) return;
      const batch = batches[idx];
      const items = batch.map((w, i) => ({ ...w, key: String(i + 1) }));
      try {
        const picks = await pickBatch(client, items, model);
        batch.forEach((w, i) => results.set(w.key, picks[String(i + 1)] || {}));
      } catch (err) {
        const info = classifyAiError(err, { admin: true });
        if (!failure || (info.fatal && !failure.fatal)) { failure = info; firstError = err; }
        if (info.fatal) stopped = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return { results, asked: work.map((w) => w.key), failure, error: firstError };
}

module.exports = { pickAttributes, pickBatch, buildPrompt, optionsFor, DEFAULT_MODEL, BATCH, MAX_OPTIONS };
