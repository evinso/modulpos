const providers = require('./providers');
const { HttpError } = require('../lib/http');

/**
 * One way to ask a language model, whichever vendor the owner chose (Anthropic Claude, OpenAI, Google Gemini). The article writer, the fact checker and the reviewer only
 * know `complete()`; nothing else in the platform talks to a model.
 *  - the key and the model come from the provider's saved settings (the panel's API page); a model the owner did not name is refused for OpenAI / Gemini (their names change
 *    too often to guess), Claude defaults to claude-sonnet-5-5
 *  - EVERY call is written to the usage table; the cost is computed from the token counts and the prices the owner typed in (USD per 1M tokens). No price = cost NULL =
 *    "Bilinmiyor", never 0; the budget guard runs BEFORE the call and counts an unknown price as 0 (and says so in the docs)
 *  - never retried on its own (a retry of a call that may have been billed would be billed twice); a cut-off answer (token limit) is an error, not a result
 *  - what a model answers is DATA: json answers are parsed defensively, and callers validate the fields they use
 * Written from the vendors' public API documentation; not run against a real key (no key available): the tests use a fake fetch with the documented answer shapes.
 */
const DEFAULT_MODEL = { anthropic: 'claude-sonnet-5-5' };
const VENDORS = ['anthropic', 'openai', 'gemini'];

class LlmError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'LlmError'; this.code = code; Object.assign(this, extra); }
}

/** one human sentence for whatever went wrong; `fatal` = no other call can work either (rejected key, empty balance) */
function explain(label, status, raw) {
  const text = String(raw || '').slice(0, 200);
  if (/credit balance|billing|insufficient[_ ]quota|exceeded your current quota|payment/i.test(text) || status === 402) return new LlmError('funds', `${label} hesabının kredisi/bakiyesi yetersiz: ${label} panelinden kredi yükleyin`, { fatal: true, status });
  if (status === 401 || status === 403 || /invalid x-api-key|authentication|api key not valid|invalid_api_key|permission/i.test(text)) return new LlmError('auth', `${label} API anahtarı reddedildi (${status || '?'}): anahtarı ve model adını kontrol edin`, { fatal: true, status });
  if (status === 404) return new LlmError('model', `${label} bu model adını bulamadı: model adını API Kullanımı sayfasında kontrol edin`, { fatal: true, status });
  if (status === 429) return new LlmError('rate_limit', `${label} istek sınırına takıldı; biraz sonra tekrar deneyin`, { status, retryable: true });
  if (status === 529 || status >= 500) return new LlmError('overloaded', `${label} şu an yoğun ya da yanıt vermiyor; biraz sonra tekrar deneyin`, { status, retryable: true });
  return new LlmError('api', `${label} isteği başarısız oldu${status ? ` (HTTP ${status})` : ''}: ${text || 'bilinmeyen hata'}`, { status });
}

const adapters = {
  async anthropic({ secret, model, system, user, maxTokens, fetchImpl, timeoutMs }) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: secret, fetch: fetchImpl, maxRetries: 0, timeout: timeoutMs, dangerouslyAllowBrowser: true });      // server code only: the flag exists for test harnesses that define `window` (jsdom)
    let msg;
    try { msg = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }); }
    catch (err) {
      if (err && (err.name === 'APIConnectionTimeoutError' || err.name === 'TimeoutError')) throw new LlmError('timeout', `Claude ${Math.round(timeoutMs / 1000)} saniyede cevap vermedi`, { maybeBilled: true });
      if (err && err.status) throw explain('Anthropic', err.status, err.message);
      throw new LlmError('network', 'Anthropic’e ulaşılamadı (ağ hatası)', { maybeBilled: true });
    }
    const text = (msg.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    return { text, input: msg.usage && msg.usage.input_tokens, output: msg.usage && msg.usage.output_tokens, truncated: msg.stop_reason === 'max_tokens', refused: msg.stop_reason === 'refusal' };
  },
  async openai({ secret, model, system, user, maxTokens, json, fetchImpl, timeoutMs }) {
    let res;
    try {
      res = await fetchImpl('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_completion_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}) }) });
    } catch (err) { throw new LlmError(err && err.name === 'TimeoutError' ? 'timeout' : 'network', err && err.name === 'TimeoutError' ? `OpenAI ${Math.round(timeoutMs / 1000)} saniyede cevap vermedi` : 'OpenAI’ye ulaşılamadı (ağ hatası)', { maybeBilled: true }); }
    const j = await res.json().catch(() => null);
    if (!res.ok) throw explain('OpenAI', res.status, j && j.error && (j.error.message || j.error.code));
    const choice = j && Array.isArray(j.choices) ? j.choices[0] : null;
    return { text: choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '', input: j && j.usage && j.usage.prompt_tokens, output: j && j.usage && j.usage.completion_tokens,
      truncated: !!choice && choice.finish_reason === 'length', refused: !!(choice && choice.message && choice.message.refusal) };
  },
  async gemini({ secret, model, system, user, maxTokens, json, fetchImpl, timeoutMs }) {
    let res;
    try {
      res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': secret, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) } }) });
    } catch (err) { throw new LlmError(err && err.name === 'TimeoutError' ? 'timeout' : 'network', err && err.name === 'TimeoutError' ? `Gemini ${Math.round(timeoutMs / 1000)} saniyede cevap vermedi` : 'Gemini’ye ulaşılamadı (ağ hatası)', { maybeBilled: true }); }
    const j = await res.json().catch(() => null);
    if (!res.ok) throw explain('Gemini', res.status, j && j.error && (j.error.message || j.error.status));
    const cand = j && Array.isArray(j.candidates) ? j.candidates[0] : null;
    const text = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('') : '';
    return { text, input: j && j.usageMetadata && j.usageMetadata.promptTokenCount, output: j && j.usageMetadata && j.usageMetadata.candidatesTokenCount, truncated: !!cand && cand.finishReason === 'MAX_TOKENS', refused: !!cand && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(cand.finishReason) || (!!j && !!j.promptFeedback && !!j.promptFeedback.blockReason) };
  },
};

/** the first {...} of an answer as an object (models often wrap JSON in prose or a code fence) */
function extractJson(text) {
  const s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new LlmError('bad_json', 'Modelin cevabında JSON bulunamadı', { maybeBilled: true });
  try { const v = JSON.parse(s.slice(a, b + 1)); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* fall through */ }
  throw new LlmError('bad_json', 'Modelin cevabı geçerli JSON değil', { maybeBilled: true });
}

const price = (extra, k) => { const n = Number(extra[k]); return extra[k] !== undefined && extra[k] !== '' && Number.isFinite(n) && n >= 0 ? n : null; };

/** which vendors are ready to be used: { key, label, model, ready, reason } (the panel's pickers) */
async function available() {
  const list = await providers.list();
  return VENDORS.map((k) => {
    const p = list.find((x) => x.key === k);
    const model = (p.extra && p.extra.model) || DEFAULT_MODEL[k] || '';
    const ready = p.configured && !!model;
    return { key: k, label: p.label, model, ready, reason: ready ? '' : (!p.configured ? 'API anahtarı yok' : 'Model adı yazılmamış'), pricesKnown: price(p.extra || {}, 'inputPricePerM') !== null && price(p.extra || {}, 'outputPricePerM') !== null };
  });
}

/**
 * Asks one model.  @param o { provider, system, user, maxTokens, json, projectId, operation, fetchImpl, now, timeoutMs }
 * @returns { text, data (when json), provider, model, inputTokens, outputTokens, costUsd (null = unknown) }
 */
async function complete({ provider, system, user, maxTokens = 6000, json = false, projectId = null, operation = 'complete', fetchImpl = globalThis.fetch, now = new Date(), timeoutMs = 150000 }) {
  if (!VENDORS.includes(provider)) throw new HttpError(400, `Bilinmeyen yapay zekâ sağlayıcısı: ${provider}`);
  const p = await providers.get(provider);
  const secret = await providers.secretFor(provider);
  const model = (p.extra && p.extra.model) || DEFAULT_MODEL[provider] || '';
  if (!secret) throw new HttpError(409, `${p.label} henüz ayarlanmadı: API Kullanımı sayfasından API anahtarını kaydedip bağlantıyı test edin`);
  if (!model) throw new HttpError(409, `${p.label} için model adı yazılmamış: API Kullanımı sayfasındaki “Makale modeli” alanına hesabınızdaki model adını yazın`);
  const pin = price(p.extra || {}, 'inputPricePerM'); const pout = price(p.extra || {}, 'outputPricePerM');
  const estimate = pin !== null && pout !== null ? ((String(system).length + String(user).length) / 4 * pin + maxTokens * 0.6 * pout) / 1e6 : 0;
  const guard = await providers.guard(provider, estimate, { projectId, now, operation });
  if (!guard.ok) throw new LlmError('budget', guard.message, { budget: true });
  let out;
  try { out = await adapters[provider]({ secret, model, system, user, maxTokens, json, fetchImpl, timeoutMs }); }
  catch (err) {
    await providers.recordUsage({ provider, endpoint: model, operation, requests: 1, units: null, costUsd: null, result: 'error', projectId, meta: { code: err.code } });
    if (err && typeof err.message === 'string') err.message = err.message.split(secret).join('[gizli]');          // a vendor's error text must never carry the key into a run record or the panel
    throw err;
  }
  const inT = Number.isFinite(Number(out.input)) ? Number(out.input) : null; const outT = Number.isFinite(Number(out.output)) ? Number(out.output) : null;
  const costUsd = pin !== null && pout !== null && inT !== null && outT !== null ? (inT * pin + outT * pout) / 1e6 : null;
  await providers.recordUsage({ provider, endpoint: model, operation, requests: 1, units: inT !== null && outT !== null ? inT + outT : null, costUsd, projectId, meta: { inputTokens: inT, outputTokens: outT } });
  const base = { provider, model, inputTokens: inT, outputTokens: outT, costUsd };
  if (out.refused) throw new LlmError('refused', 'Model bu isteği yanıtlamayı reddetti (güvenlik filtresi); konuyu ya da kaynak metni kontrol edin', { ...base, maybeBilled: true });
  if (out.truncated) throw new LlmError('truncated', 'Model cevabı token sınırında kesildi; makale tamamlanamadı', { ...base, maybeBilled: true });
  if (!String(out.text || '').trim()) throw new LlmError('empty', 'Model boş cevap verdi', { ...base, maybeBilled: true });
  if (!json) return { ...base, text: out.text };
  try { return { ...base, text: out.text, data: extractJson(out.text) }; } catch (err) { Object.assign(err, base); throw err; }
}

module.exports = { VENDORS, DEFAULT_MODEL, LlmError, complete, available, extractJson, explain };
