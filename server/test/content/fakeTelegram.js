/**
 * A fake of Telegram's Bot API behind an injectable fetch, in the documented shapes: every method answers `{ ok, result }` or `{ ok: false, error_code, description }`.
 * It checks the bot token in the URL, can "block" chats (403) and be "down" (network error), and remembers the webhook it was given (with its secret).
 */
const TOKEN = '123456789:AAFakeTokenFakeTokenFakeToken_0123';

function fakeTelegram({ token = TOKEN, blocked = [] } = {}) {
  const calls = []; const st = { webhook: null, down: false, blocked: new Set(blocked.map(String)), info: { pending: 2, error: 'Wrong response from the webhook: 503 Service Unavailable' }, updates: [] };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, o = {}) => {
    const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/([A-Za-z]+)$/.exec(String(url)); if (!m) throw new Error(`unexpected url ${url}`);
    if (st.down) throw new TypeError('fetch failed');
    const [, tok, method] = m; const body = o.body ? JSON.parse(o.body) : {};
    if (tok !== token) return json(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    calls.push({ method, body });
    if (method === 'getMe') return json(200, { ok: true, result: { id: 99, is_bot: true, first_name: 'Test Bot', username: 'modulpos_test_bot' } });
    if (method === 'sendMessage') {
      if (st.blocked.has(String(body.chat_id))) return json(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
      return json(200, { ok: true, result: { message_id: calls.length, chat: { id: body.chat_id }, text: body.text } });
    }
    if (method === 'setWebhook') {
      if (!/^https:\/\//.test(String(body.url))) return json(400, { ok: false, error_code: 400, description: 'Bad Request: bad webhook: HTTPS url must be provided for webhook' });
      st.webhook = { url: body.url, secret: body.secret_token, allowed: body.allowed_updates }; return json(200, { ok: true, result: true, description: 'Webhook was set' });
    }
    if (method === 'deleteWebhook') { st.webhook = null; return json(200, { ok: true, result: true }); }
    if (method === 'getWebhookInfo') return json(200, { ok: true, result: { url: st.webhook ? st.webhook.url : '', pending_update_count: st.info.pending, ...(st.info.error ? { last_error_message: st.info.error, last_error_date: 1700000000 } : {}) } });
    if (method === 'getUpdates') return st.webhook ? json(409, { ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first" }) : json(200, { ok: true, result: st.updates });
    return json(404, { ok: false, error_code: 404, description: 'Not Found' });
  };
  const sent = () => calls.filter((c) => c.method === 'sendMessage').map((c) => ({ chat: String(c.body.chat_id), text: c.body.text }));
  return { fetchImpl, calls, st, sent, token };
}

/** a text message from `chat` as Telegram's webhook delivers it */
const update = (id, chat, text, { date = Date.now(), bot = false } = {}) => ({ update_id: id, message: { message_id: id, date: Math.floor(date / 1000), chat: { id: Number(chat), type: Number(chat) < 0 ? 'group' : 'private' }, from: { id: Math.abs(Number(chat)), is_bot: bot }, text } });

module.exports = { fakeTelegram, update, TOKEN };
