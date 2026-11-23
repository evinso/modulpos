/**
 * A fake of the three model vendors for the phase 3 tests: answers in the vendors' documented shapes, decides what to say from the ROLE of the request
 * (writer / fact checker / reviewer, told apart by their system prompts) and remembers every call. No network, no key.
 */
const SRC = 'OpenAI said on Tuesday that ChatGPT Plus will cost 22 dollars a month starting in January 2027, up from 20 dollars. The company said higher compute costs were behind the increase. Existing subscribers keep the current price through December.';
const PAGE = (extra = '') => `<html><head><title>x</title></head><body><nav>Home Menu</nav><article><h1>ChatGPT Plus price</h1>${[SRC, 'Analysts noted that the change follows similar moves by rivals in the assistant market this year.', 'A spokesperson declined to say how many people pay for the plan today.', 'The company did not give a date for when the new price will be shown inside the app.', extra].filter(Boolean).map((p) => `<p>${p}</p>`).join('')}</article><footer>junk</footer></body></html>`;

/** original text about a subscription price change: long enough to pass the length rule, nothing like the source word for word */
const ORIGINAL = [
  'A higher monthly bill is never welcome, but the useful question is whether the tool earns its place in your routine. Think about how often you open it and which tasks it actually saves you time on.',
  'Before the new price arrives, list the three jobs you give the assistant most often. If one of them is something a free option handles well enough, the premium plan may be harder to justify than it was last year.',
  'Teams should look at the cost per person rather than the headline number. A small increase multiplied across a department can quietly turn into a line item that deserves a review at the next budget meeting.',
  'It also helps to read the plan details. Features, usage limits and priority access change from time to time, and paying for a tier you rarely push to its limits is the most common way people overspend on software.',
  'If you decide to cancel, do it before the next billing date and export anything you want to keep. Most services let you downgrade without losing your history, but it is worth confirming that before you click anything.',
];
const sectionHtml = (kw) => {
  const p = (i) => `<p>${ORIGINAL[i % ORIGINAL.length]}</p>`;
  return `<p>${kw[0].toUpperCase() + kw.slice(1)} is changing, and the details matter more than the headline. This guide explains what is known, what is not, and how to decide what to do next.</p>
<h2>What changes and when</h2>${p(0)}${p(1)}<h2>Why the price is moving</h2>${p(2)}${p(3)}<h2>How to decide whether to keep paying</h2>${p(4)}${p(0)}${p(1)}
<h2>What this means for teams and budgets</h2>${p(2)}${p(3)}${p(4)}<h2>Practical steps this week</h2><ul><li>Write down how often you use the plan.</li><li>Compare it with the free option.</li><li>Set a reminder before the billing date.</li></ul>${p(0)}${p(1)}${p(2)}`;
};

/** a tiny valid-looking JPEG (recognised by its first bytes) for the picture tests */
const PICTURE = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF fake cover picture '.repeat(60)), Buffer.from([0xff, 0xd9])]);
const header = (h, n) => { if (!h) return undefined; if (typeof h.get === 'function') return h.get(n); const k = Object.keys(h).find((x) => x.toLowerCase() === n.toLowerCase()); return k ? h[k] : undefined; };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const roleOf = (system) => (/senior staff writer/.test(system) ? 'write' : /UPDATE an existing article/.test(system) ? 'update' : /meticulous fact checker/.test(system) ? 'fact' : /ad-policy reviewer/.test(system) ? 'review' : 'other');

function fakeModels() {
  const calls = []; const st = { fail: {}, override: {}, finish: {}, tokens: { in: 1500, out: 900 }, openaiModels: ['gpt-4o', 'gpt-image-1', 'gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08', 'dall-e-3'] };
  const focusOf = (user) => (/FOCUS KEYWORD \(use exactly this phrase\): (.+)/.exec(user) || [])[1] || 'the topic';
  const defaults = {
    write: (user) => { const kw = focusOf(user); return { seoTitle: `${kw[0].toUpperCase()}${kw.slice(1)}: What Changes`, h1: `${kw[0].toUpperCase()}${kw.slice(1)}: what you need to know`, slug: kw.replace(/ /g, '-'), metaDescription: `What is changing with ${kw}, why it is happening and what readers can do about it before the new price takes effect this winter.`,
      focusKeyword: kw, secondaryKeywords: ['subscription price'], excerpt: `A plain-language look at ${kw}.`, articleType: 'latest_update', contentHtml: sectionHtml(kw), faq: [{ q: 'Will current subscribers pay more?', a: 'Existing subscribers keep the current price until the change takes effect.' }, { q: 'Is there a free option?', a: 'A free tier exists, with lower limits.' }], tags: ['ai', 'pricing'] }; },
    update: (user) => { const html = (/CURRENT HTML:\n([\s\S]*?)\n\nNEW MATERIAL/.exec(user) || [])[1] || '<p>x</p>'; return { noChange: false, changeType: 'minor', reasons: [{ code: 'other', text: 'A small correction.' }], summary: 'Added one clarifying sentence.',
      fields: { contentHtml: `${html.replace(/<a [^>]*>([^<]*)<\/a>/g, '$1')}<p>Update: the plan details were rechecked against the latest reports and nothing else changed for subscribers.</p>` } }; },
    fact: () => ({ claims: [
      { claim: 'ChatGPT Plus will cost 22 dollars a month starting in January 2027', importance: 'major', verdict: 'supported', sourceIds: [1], evidence: 'ChatGPT Plus will cost 22 dollars a month starting in January 2027', note: '' },
      { claim: 'The company blamed higher compute costs', importance: 'major', verdict: 'supported', sourceIds: [1], evidence: 'higher compute costs were behind the increase', note: '' },
      { claim: 'Existing subscribers keep the current price through December', importance: 'minor', verdict: 'supported', sourceIds: [1], evidence: 'Existing subscribers keep the current price through December', note: '' }] }),
    review: () => ({ categories: Object.fromEntries(['originality', 'user_value', 'source_accuracy', 'hallucination', 'copyright', 'keyword_stuffing', 'misleading_title', 'spam', 'low_value_auto', 'sensitive', 'ad_restrictions', 'image_rights', 'integrity'].map((k) => [k, { status: 'pass', note: 'Fine.' }])),
      risk: 'low', ratings: { originality: 82, usefulness: 80, editorial: 84 }, improvements: ['Add one concrete example.'], summary: 'Solid, original explainer.' }),
  };
  const fetchImpl = async (url, o) => {
    const u = String(url); let vendor; let system; let user; let body;
    if (u === 'https://api.openai.com/v1/models') { calls.push({ vendor: 'openai', role: 'models', url: u }); return json(200, { object: 'list', data: st.openaiModels.map((id) => ({ id, object: 'model' })) }); }
    if (u === 'https://api.openai.com/v1/images/generations') {                                          // the cover picture, in OpenAI's documented shape (b64_json + usage)
      body = JSON.parse(o.body); calls.push({ vendor: 'openai', role: 'image', url: u, body, key: header(o.headers, 'authorization') });
      const f = st.fail.image; if (f) return json(f.status, { error: { message: f.message || 'failed', code: f.type } });
      return json(200, { created: 1, size: body.size, quality: body.quality, output_format: 'jpeg', data: [{ b64_json: PICTURE.toString('base64') }], usage: { input_tokens: 100, output_tokens: 1400, total_tokens: 1500 } });
    }
    if (u.startsWith('https://api.anthropic.com/v1/messages')) { vendor = 'anthropic'; body = JSON.parse(o.body); system = body.system; user = body.messages[0].content; }
    else if (u.startsWith('https://api.openai.com/v1/chat/completions')) { vendor = 'openai'; body = JSON.parse(o.body); system = body.messages[0].content; user = body.messages[1].content; }
    else if (u.includes('generativelanguage.googleapis.com') && u.includes(':generateContent')) { vendor = 'gemini'; body = JSON.parse(o.body); system = body.systemInstruction.parts[0].text; user = body.contents[0].parts[0].text; }
    else throw new Error(`unexpected model url ${u}`);
    const role = roleOf(system); calls.push({ vendor, role, url: u, system, user, body, headers: o.headers, key: header(o.headers, 'x-api-key') || header(o.headers, 'authorization') || header(o.headers, 'x-goog-api-key') });
    const f = st.fail[role] || st.fail[`${vendor}:${role}`] || st.fail[vendor];
    if (f) {
      if (f.throw) { const e = new Error('network down'); e.name = f.throw; throw e; }
      return vendor === 'anthropic' ? json(f.status, { type: 'error', error: { type: f.type || 'api_error', message: f.message || 'failed' } }) : json(f.status, { error: { message: f.message || 'failed', code: f.type } });
    }
    const ov = st.override[role]; const a = ov !== undefined ? (typeof ov === 'function' ? ov(user, calls.length) : ov) : defaults[role](user);
    const text = typeof a === 'string' ? a : JSON.stringify(a); const fin = st.finish[role]; const { in: i, out: n } = st.tokens;
    if (vendor === 'anthropic') return json(200, { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: fin || 'end_turn', stop_sequence: null, usage: { input_tokens: i, output_tokens: n } });
    if (vendor === 'openai') return json(200, { id: 'c1', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text, ...(fin === 'refusal' ? { refusal: 'no' } : {}) }, finish_reason: fin === 'length' ? 'length' : 'stop' }], usage: { prompt_tokens: i, completion_tokens: n, total_tokens: i + n } });
    return json(200, { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: fin === 'length' ? 'MAX_TOKENS' : fin === 'refusal' ? 'SAFETY' : 'STOP' }], usageMetadata: { promptTokenCount: i, candidatesTokenCount: n, totalTokenCount: i + n } });
  };
  return { fetchImpl, calls, st, byRole: (r) => calls.filter((c) => c.role === r) };
}

module.exports = { SRC, PAGE, ORIGINAL, sectionHtml, fakeModels, json, PICTURE };
