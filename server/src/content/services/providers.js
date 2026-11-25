const db = require('../db');
const V = require('../lib/validate');
const cryptoBox = require('../lib/crypto');
const { env } = require('../env');
const { startOfDay, startOfMonth } = require('../lib/time');
const { HttpError, bad } = require('../lib/http');
const settings = require('./settings');

/**
 * External services (OpenAI, Apify, Serper, Telegram ...): their keys, a connection test, every call that costs money, and the budget guard.
 *  - a key is stored AES-256-GCM encrypted and is NEVER returned: the panel only learns "configured" and the last four characters
 *  - the test calls a free endpoint of the service itself (list models / account data / getMe); the answer is a sentence, the secret never appears in it
 *  - usage rows hold the cost in micro-USD; a call whose cost cannot be computed is stored with NULL and shown as "Bilinmiyor" (never as 0)
 *  - budgets: per provider (daily / monthly) and for the platform (settings group "budget"); guard() answers before a paid call starts
 * Real calls need real keys: nothing here has been run against the live services without them. The tests use a fake fetch.
 */
const PROVIDERS = {
  openai: {
    label: 'OpenAI', secretLabel: 'API anahtarı', secretPattern: /^sk-[A-Za-z0-9_\-.]{16,}$/, paid: true,
    extra: { model: { label: 'Makale modeli (tam adı, ör. hesabınızda görünen)', max: 80, def: '' }, cheapModel: { label: 'Hızlı / ucuz model', max: 80, def: '' },
      inputPricePerM: { label: 'Giriş fiyatı (USD / 1 milyon token, isteğe bağlı)', max: 12, def: '', numeric: true }, outputPricePerM: { label: 'Çıkış fiyatı (USD / 1 milyon token, isteğe bağlı)', max: 12, def: '', numeric: true },
      imageModel: { label: 'Görsel modeli (kapak görseli için; boş = hesabınızdaki en yeni)', max: 80, def: '' }, imagePriceUsd: { label: 'Görsel başına fiyat (USD, isteğe bağlı; yazmazsanız maliyet “Bilinmiyor” görünür)', max: 10, def: '', numeric: true } },
    help: 'platform.openai.com → API keys. Anahtar yalnızca sunucuda şifreli saklanır. Model adını OpenAI hesabınızdaki güncel adıyla yazın; fiyatları girerseniz maliyet hesaplanır, girmezseniz “Bilinmiyor” yazılır.',
  },
  anthropic: {
    label: 'Anthropic (Claude)', secretLabel: 'API anahtarı', secretPattern: /^sk-ant-[A-Za-z0-9_\-]{16,}$/, paid: true,
    extra: { model: { label: 'Makale modeli (boş = claude-sonnet-5-5)', max: 80, def: '' },
      inputPricePerM: { label: 'Giriş fiyatı (USD / 1 milyon token, isteğe bağlı)', max: 12, def: '', numeric: true }, outputPricePerM: { label: 'Çıkış fiyatı (USD / 1 milyon token, isteğe bağlı)', max: 12, def: '', numeric: true } },
    help: 'console.anthropic.com → API Keys (Plans & Billing’de kredi gerekir). ModulPOS’un kendi Anthropic anahtarından ayrıdır. Fiyatları girerseniz maliyet hesaplanır, girmezseniz “Bilinmiyor” yazılır.',
  },
  gemini: {
    label: 'Google (Gemini)', secretLabel: 'API anahtarı', secretPattern: /^[A-Za-z0-9._~+\/=-]{20,256}$/, paid: true,
    extra: { model: { label: 'Makale modeli (tam adı, ör. hesabınızda görünen)', max: 80, def: '' },
      inputPricePerM: { label: 'Giriş fiyatı (USD / 1 milyon token, isteğe bağlı)', max: 12, def: '', numeric: true }, outputPricePerM: { label: 'Çıkış fiyatı (USD / 1 milyon token, isteğe bağlı)', max: 12, def: '', numeric: true } },
    help: 'aistudio.google.com → Get API key. Anahtarı kaydedip “Bağlantıyı test et”e basın: anahtarınızla kullanılabilen modeller listelenir, birini tek tıkla seçersiniz (model adı seçilmeden anahtar makale yazımında kullanılamaz). Fiyatları girerseniz maliyet hesaplanır, girmezseniz “Bilinmiyor” yazılır.',
  },
  apify: {
    label: 'Apify (Google anahtar kelime verisi)', secretLabel: 'Apify API belirteci (token)', secretPattern: /^[A-Za-z0-9_.-]{20,200}$/, paid: false,
    extra: { actor: { label: 'Aktör (kullanıcı/ad)', max: 120, def: 'gaelasao/keyword-research-api' },
      batchSize: { label: 'Çalıştırma başına anahtar kelime (ücretsiz Apify planında 20)', max: 5, def: '20', range: [1, 1000] },
      monthlyKeywordCap: { label: 'Aylık en çok sorgulanacak anahtar kelime (güvenlik sınırı)', max: 6, def: '600', range: [0, 100000] } },
    help: 'Aranma hacmi, CPC ve rekabet verisi için ÖNERİLEN ÜCRETSİZ BAŞLANGIÇ: apify.com’da kart gerektirmeyen ücretsiz hesap açın (Apify’ın fiyat sayfasına göre aylık 5 USD kredi verir), Settings → API & Integrations’tan belirteci kopyalayıp buraya yapıştırın. Aktör, anahtar kelime başına ücret alan bir Apify programıdır (varsayılanı DataForSEO verisini satar; fiyat birkaç USD / 1.000 kelime, Apify’ın aktör sayfasında yazar). Aktör başkasının programıdır: değişebilir ya da kalkabilir (bağlantı testi var olup olmadığına bakar). Maliyeti biz bilemeyiz (“Bilinmiyor” görünür): güvenlik için aylık kelime sınırı vardır; ücretsiz planda kredi bitince Apify kendisi durdurur, kart bağlamadıkça borçlanamazsınız. Hiç ödeme yapmak istemezseniz “Dosyadan hacim aktar” ücretsiz yoldur.',
  },
  serper: {
    label: 'Serper.dev', secretLabel: 'API anahtarı', secretPattern: /^[A-Za-z0-9_-]{16,128}$/, paid: true, extra: {},
    help: 'serper.dev → ücretsiz hesap açın (2.500 ücretsiz sorgu, kart gerekmez) → API Key. Yalnızca Google ilk-10 sonuçlarını verir (organik rekabet tahmini için); aranma hacmi vermez. Bağlantı testi 1 sorgu (1 kredi) harcar.',
  },
  pixabay: {
    label: 'Pixabay (ücretsiz fotoğraflar)', secretLabel: 'API anahtarı', secretPattern: /^[A-Za-z0-9-]{12,80}$/, paid: false, extra: {},
    help: 'pixabay.com → ücretsiz hesap açın (kart gerekmez) → giriş yapıp pixabay.com/api/docs sayfasına gidin: anahtarınız orada “key” parametresinin yanında yazar. Kapak görseli için ücretsiz fotoğraf aranır ve seçilen fotoğraf sizin sunucunuza indirilir (Pixabay’ın isteği). Pixabay lisansı ticari kullanıma izin verir, kaynak göstermek zorunlu değildir; yine de tanınabilir kişi, logo ya da marka içeren fotoğraflar sizin sorumluluğunuzdadır (sistem bunları elemeye çalışır, garanti vermez). Sınır: dakikada 100 istek.',
  },
  searchconsole: {
    label: 'Google Search Console', secretLabel: 'Servis hesabı anahtarı (JSON)', secretKind: 'json', paid: false, extra: {},
    help: 'Google Cloud → IAM → Servis Hesapları → bir hesap oluşturun → Anahtarlar → JSON anahtar indirin (Search Console API açık olmalı). Sonra Search Console → Ayarlar → Kullanıcılar ve izinler’de o hesabın e-postasını siteye “Kısıtlı” kullanıcı olarak ekleyin. JSON dosyasının tüm içeriğini buraya yapıştırın; sunucuda şifreli saklanır, bir daha gösterilmez. Ücretsizdir.',
  },
  telegram: {
    label: 'Telegram', secretLabel: 'Bot token', secretPattern: /^\d{6,}:[A-Za-z0-9_-]{20,}$/, paid: false,
    extra: { chatIds: { label: 'Yetkili sohbet kimlikleri (virgülle)', max: 300, def: '' } },
    help: 'Telegram’da @BotFather ile bir bot oluşturup belirteci (token) buraya yapıştırın. Sonra bota /start yazın: size sohbet kimliğinizi söyler; onu “Yetkili sohbet kimlikleri” alanına yazın (birden çok sohbet virgülle). Yalnızca burada yazılı sohbetler komut verebilir ve bildirim alır. Sonra Bildirimler sayfasından webhook’u kurun.',
  },
};
const KEYS = Object.keys(PROVIDERS);
const MICROS = 1_000_000;
const toMicros = (usd) => (usd === null || usd === undefined || usd === '' ? null : Math.round(Number(usd) * MICROS));
const toUsd = (micros) => (micros === null || micros === undefined ? null : Number(micros) / MICROS);

const assertKey = (key) => { if (!PROVIDERS[key]) throw bad(`Bilinmeyen sağlayıcı: ${key}`); return PROVIDERS[key]; };

function shape(r, key) {
  const def = PROVIDERS[key];
  return {
    key, label: def.label, paid: def.paid, help: def.help, secretLabel: def.secretLabel,
    configured: !!(r && r.encrypted_secret), secretLast4: r ? r.secret_last4 : null,
    extra: r ? r.extra : {}, extraFields: Object.entries(def.extra).map(([k, f]) => ({ key: k, label: f.label, required: !!f.required })),
    dailyBudgetUsd: r ? toUsd(r.daily_budget_micros) : null, monthlyBudgetUsd: r ? toUsd(r.monthly_budget_micros) : null,
    lastTestedAt: r ? r.last_tested_at : null, lastTestOk: r ? r.last_test_ok : null, lastTestMessage: r ? r.last_test_message : null,
  };
}

async function list() {
  const rows = new Map((await db.query('SELECT * FROM api_providers')).rows.map((r) => [r.key, r]));
  return KEYS.map((k) => shape(rows.get(k), k));
}

async function get(key) { assertKey(key); return shape((await db.query('SELECT * FROM api_providers WHERE key = $1', [key])).rows[0], key); }

/**
 * Saves one provider. `secret` empty/undefined keeps the stored key (the panel never has it to send back); `clearSecret: true` removes it.
 * Budgets are USD; null removes the budget.
 */
async function save(key, body) {
  const def = assertKey(key);
  const cur = (await db.query('SELECT * FROM api_providers WHERE key = $1', [key])).rows[0];
  let enc = cur ? cur.encrypted_secret : null; let l4 = cur ? cur.secret_last4 : null;
  if (body.clearSecret === true) { enc = null; l4 = null; }
  else if (typeof body.secret === 'string' && body.secret.trim() !== '') {
    const s = body.secret.trim();
    if (def.secretKind === 'json') {                                   // a Google service-account key: the whole JSON file, checked for the two fields we need
      let j; try { j = JSON.parse(s); } catch { throw bad(`${def.secretLabel} geçerli bir JSON değil: indirilen dosyanın TÜM içeriğini yapıştırın`); }
      if (s.length > 12000 || !j || typeof j.client_email !== 'string' || !/BEGIN (RSA )?PRIVATE KEY/.test(String(j.private_key || ''))) throw bad(`${def.secretLabel} beklenen biçimde değil: client_email ve private_key alanları olmalı`);
      enc = cryptoBox.encrypt(s); l4 = cryptoBox.last4(String(j.private_key_id || j.client_email));
    } else {
      if (s.length > 400 || /\s/.test(s)) throw bad(`${def.secretLabel} geçersiz görünüyor (boşluk içermemeli)`);
      if (def.secretPattern && !def.secretPattern.test(s)) throw bad(`${def.secretLabel} beklenen biçimde değil`);
      enc = cryptoBox.encrypt(s); l4 = cryptoBox.last4(s);
    }
  } else if (body.secret !== undefined && body.secret !== null && typeof body.secret !== 'string') throw bad(`${def.secretLabel} metin olmalı`);
  const extra = { ...(cur ? cur.extra : {}) };
  if (body.extra !== undefined) {
    if (body.extra === null || typeof body.extra !== 'object' || Array.isArray(body.extra)) throw bad('Ek ayarlar bir nesne olmalı');
    for (const [k, f] of Object.entries(def.extra)) {
      if (body.extra[k] === undefined) continue;
      extra[k] = V.str(body.extra[k], f.label, { max: f.max });
      if (k === 'model') extra[k] = extra[k].replace(/^models\//, '').trim();             // Google lists models as "models/gemini-…": the call adds that part itself
      if (f.numeric && extra[k] !== '' && !(Number.isFinite(Number(extra[k])) && Number(extra[k]) >= 0 && Number(extra[k]) <= 1000)) throw bad(`${f.label}: 0 ile 1000 arasında bir sayı yazın (ör. 3 ya da 15.5)`);
      if (f.range && extra[k] !== '' && !(Number.isInteger(Number(extra[k])) && Number(extra[k]) >= f.range[0] && Number(extra[k]) <= f.range[1])) throw bad(`${f.label}: ${f.range[0]} ile ${f.range[1]} arasında bir tam sayı yazın`);
    }
  }
  if (key === 'telegram' && extra.chatIds) {
    const ids = extra.chatIds.split(',').map((x) => x.trim()).filter(Boolean);
    if (ids.some((x) => !/^-?\d{3,20}$/.test(x))) throw bad('Sohbet kimlikleri yalnızca sayı olmalı (virgülle ayırın)');
    extra.chatIds = ids.join(',');
  }
  const budget = (v, label) => { if (v === undefined) return undefined; if (v === null || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1000000) throw bad(`${label} 0 ile 1.000.000 arasında (USD) olmalı`); return toMicros(n); };
  const daily = budget(body.dailyBudgetUsd, 'Günlük bütçe'); const monthly = budget(body.monthlyBudgetUsd, 'Aylık bütçe');
  const secretChanged = enc !== (cur ? cur.encrypted_secret : null);
  const row = (await db.query(`INSERT INTO api_providers (key, label, encrypted_secret, secret_last4, extra, daily_budget_micros, monthly_budget_micros)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (key) DO UPDATE SET encrypted_secret = $3, secret_last4 = $4, extra = $5,
      daily_budget_micros = CASE WHEN $8 THEN $6 ELSE api_providers.daily_budget_micros END, monthly_budget_micros = CASE WHEN $9 THEN $7 ELSE api_providers.monthly_budget_micros END,
      ${secretChanged ? 'last_tested_at = NULL, last_test_ok = NULL, last_test_message = NULL,' : ''} updated_at = now() RETURNING *`,
  [key, def.label, enc, l4, JSON.stringify(extra), daily === undefined ? null : daily, monthly === undefined ? null : monthly, daily !== undefined, monthly !== undefined])).rows[0];
  return shape(row, key);
}

/** The stored secret in plain text, for the server's own calls ONLY (never returned by a route). null when none is saved. */
async function secretFor(key) {
  assertKey(key);
  const r = (await db.query('SELECT encrypted_secret FROM api_providers WHERE key = $1', [key])).rows[0];
  return r && r.encrypted_secret ? cryptoBox.decrypt(r.encrypted_secret) : null;
}

// ── connection tests (free endpoints of the services) ──────────────────────────────────────────────────────
const TESTS = {
  async openai({ secret, fetchImpl }) {
    const res = await fetchImpl('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(12000) });
    if (res.status === 401) return { ok: false, message: 'OpenAI anahtarı reddedildi (401). Anahtarı kontrol edin.' };
    if (res.status === 429) return { ok: false, message: 'OpenAI isteği sınırladı (429): kota/bakiye ya da hız sınırı. Hesabınızı kontrol edin.' };
    if (!res.ok) return { ok: false, message: `OpenAI beklenmedik cevap verdi (${res.status}).` };
    const j = await res.json().catch(() => ({}));
    const ids = (Array.isArray(j.data) ? j.data : []).map((m) => String(m && m.id || ''));
    const models = ids.filter((id) => /^(gpt-|o\d)/i.test(id) && !/embed|audio|image|tts|whisper|realtime|moderation|transcribe|search|codex|instruct|vision-preview|dall|sora/i.test(id)).sort().map((id) => ({ id, label: id }));
    const imgs = require('../lib/imageModels'); const imageModels = imgs.imageModels(ids); const suggestedImage = imgs.pickImageModel(ids);
    return { ok: true, message: `OpenAI bağlantısı çalışıyor (${Array.isArray(j.data) ? j.data.length : '?'} model görünüyor).${models.length ? ' Makale için bir model seçin.' : ''}${imageModels.length ? ` Kapak görseli için ${imageModels.length} görsel modeli de görünüyor.` : ' Hesabınızda görsel modeli görünmüyor (OpenAI görsel modelleri için kuruluş doğrulaması isteyebilir).'}`, models, imageModels, suggestedImage };
  },
  async apify({ secret, extra, fetchImpl }) {
    const apify = require('./apify');
    const client = apify.createClient({ token: secret, actor: extra.actor || apify.DEFAULT_ACTOR, fetchImpl });
    const acc = await client.account();
    let info; try { info = await client.actorInfo(); } catch (err) { if (err.code === 'not_found') return { ok: false, message: `Belirteç doğru (${acc.username || 'hesap'}) ama ${err.message}` }; throw err; }
    const u = acc.usage && acc.usage.usedUsd !== null && acc.usage.limitUsd !== null ? ` Bu ay kullanılan: $${acc.usage.usedUsd.toFixed(2)} / $${acc.usage.limitUsd.toFixed(2)}.` : '';
    return { ok: true, message: `Apify bağlantısı çalışıyor (hesap: ${acc.username || '?'}${acc.plan ? `, plan: ${acc.plan}` : ''}). Aktör “${info.username ? `${info.username}/` : ''}${info.name || extra.actor}” bulundu.${u} Test ücretsizdir; anahtar kelime sorgusu yalnızca “veri çek” dediğinizde çalışır.` };
  },
  async anthropic({ secret, fetchImpl }) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: secret, fetch: fetchImpl, maxRetries: 0, timeout: 12000, dangerouslyAllowBrowser: true });          // server code only (see services/llm.js)
    try { const page = await client.models.list({ limit: 5 }); return { ok: true, message: `Anthropic bağlantısı çalışıyor (${(page.data || []).length} model görünüyor).` }; }
    catch (err) {
      const st = Number(err && err.status) || 0;
      if (st === 401 || st === 403) return { ok: false, message: `Anthropic anahtarı reddedildi (${st}). Anahtarı kontrol edin.` };
      if (st === 429) return { ok: false, message: 'Anthropic isteği sınırladı (429); biraz sonra tekrar deneyin.' };
      if (st) return { ok: false, message: `Anthropic beklenmedik cevap verdi (${st}).` };
      throw err;
    }
  },
  async gemini({ secret, extra, fetchImpl }) {
    const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': secret }, signal: AbortSignal.timeout(12000) });
    if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, message: `Gemini anahtarı reddedildi (${res.status}). Anahtarı kontrol edin: aistudio.google.com → Get API key; anahtarın başında/sonunda boşluk olmamalı.` };
    if (res.status === 429) return { ok: false, message: 'Gemini isteği sınırladı (429); biraz sonra tekrar deneyin.' };
    if (!res.ok) return { ok: false, message: `Gemini beklenmedik cevap verdi (${res.status}).` };
    const j = await res.json().catch(() => ({}));
    const all = Array.isArray(j.models) ? j.models : [];
    // the models that can write text with this key (embedding / image / speech models cannot)
    const usable = all.filter((m) => m && /^models\/gemini/i.test(String(m.name)) && (!Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent')) && !/embed|image|tts|live|audio|robotics|computer-use|aqa/i.test(String(m.name)))
      .map((m) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName ? `${m.displayName} (${String(m.name).replace(/^models\//, '')})` : String(m.name).replace(/^models\//, '') })).sort((a, b) => a.id.localeCompare(b.id));
    // a suggestion, not a decision: the stable "flash" family (usually the faster and cheaper one; check Google's price page)
    const stable = usable.filter((m) => !/preview|exp|lite|thinking|-\d{3}$|latest/i.test(m.id)); const flash = stable.filter((m) => /flash/i.test(m.id));
    const suggested = (flash.length ? flash : stable)[(flash.length ? flash : stable).length - 1];
    const has = extra && extra.model;
    return { ok: true, message: `Gemini bağlantısı çalışıyor (${all.length} model görünüyor, ${usable.length} tanesi makale yazabilir).${has ? ` Seçili model: ${extra.model}.` : ' Anahtar kabul edildi, ama makale yazımında kullanılabilmesi için aşağıdan bir MODEL seçmeniz gerekir.'}`, models: usable, suggested: suggested ? suggested.id : null };
  },
  async telegram({ secret, extra, fetchImpl }) { return require('./telegram').testConnection({ secret, extra, fetchImpl }); },
  async searchconsole({ secret, fetchImpl }) {
    const gsc = require('./searchconsole');
    const client = gsc.createClient({ keyJson: secret, fetchImpl });
    const sites = await client.listSites();
    return { ok: true, message: `Search Console bağlantısı çalışıyor: servis hesabı (${client.email}) ${sites.length} siteye erişebiliyor${sites.length ? ` (${sites.slice(0, 3).map((s) => s.siteUrl).join(', ')})` : '. Search Console’da siteye bu e-postayı kullanıcı olarak ekleyin'}.` };
  },
  async pixabay({ secret, fetchImpl }) {
    const res = await fetchImpl(`https://pixabay.com/api/?key=${encodeURIComponent(secret)}&q=laptop&per_page=3&safesearch=true`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text().catch(() => '');
    if (res.status === 429) return { ok: false, message: 'Pixabay hız sınırına takıldı (dakikada 100 istek); biraz sonra tekrar deneyin.' };
    if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, message: /key/i.test(text) || res.status !== 400 ? `Pixabay API anahtarı reddedildi (${res.status}). Anahtarı pixabay.com/api/docs sayfasından kopyalayın (giriş yapmış olmalısınız).` : `Pixabay isteği reddetti (400): ${text.slice(0, 120)}` };
    if (!res.ok) return { ok: false, message: `Pixabay beklenmedik cevap verdi (${res.status}).` };
    let j = {}; try { j = JSON.parse(text); } catch { return { ok: false, message: 'Pixabay cevabı okunamadı (JSON değil).' }; }
    return { ok: true, message: `Pixabay bağlantısı çalışıyor (${Number(j.totalHits) || 0} sonuç görünüyor). Fotoğraflar ücretsizdir; kapak görseli bu anahtarla aranır.` };
  },
  async serper({ secret, fetchImpl }) {
    // Serper has no free "who am I" endpoint that is documented: the test is one real query (1 credit) and says so
    const res = await fetchImpl('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'test', num: 1 }), signal: AbortSignal.timeout(15000) });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) return { ok: false, message: `Serper API anahtarı reddedildi (${res.status}).` };
    if (res.status === 400 && /credit/i.test(String(j && j.message))) return { ok: false, message: 'Anahtar doğru ama Serper kredisi bitmiş: serper.dev panelinden kredi alın.' };
    if (res.status === 429) return { ok: false, message: 'Serper isteği sınırladı (429); biraz sonra tekrar deneyin.' };
    if (!res.ok) return { ok: false, message: `Serper beklenmedik cevap verdi (${res.status}).` };
    return { ok: true, message: 'Serper bağlantısı çalışıyor (test 1 kredi harcadı).' };
  },
};

/** Calls the service's free endpoint with the saved key; remembers and returns the result. `fetchImpl` is injectable for tests. */
async function test(key, { fetchImpl = globalThis.fetch } = {}) {
  assertKey(key);
  const row = (await db.query('SELECT * FROM api_providers WHERE key = $1', [key])).rows[0];
  if (!row || !row.encrypted_secret) throw new HttpError(409, `${PROVIDERS[key].label} için önce ${PROVIDERS[key].secretLabel.toLowerCase()} kaydedin`);
  const secret = cryptoBox.decrypt(row.encrypted_secret);
  let out;
  try { out = await TESTS[key]({ secret, extra: row.extra || {}, fetchImpl }); }
  catch (err) {
    const msg = err && err.name === 'TimeoutError' ? 'Servis 12 saniyede cevap vermedi.' : (err && (err.name === 'GscError' || err.name === 'TelegramError' || err.name === 'ApifyError') ? err.message : 'Servise ulaşılamadı (ağ hatası).');
    out = { ok: false, message: msg };
  }
  const message = String(out.message).split(secret).join('[gizli]').slice(0, 300);        // the secret must never end up in a stored sentence
  await db.query('UPDATE api_providers SET last_tested_at = now(), last_test_ok = $1, last_test_message = $2 WHERE key = $3', [out.ok, message, key]);
  return { ok: out.ok, message, ...(out.balanceUsd !== undefined ? { balanceUsd: out.balanceUsd } : {}), ...(Array.isArray(out.models) ? { models: out.models.slice(0, 80), suggested: out.suggested || null } : {}), ...(Array.isArray(out.imageModels) ? { imageModels: out.imageModels.slice(0, 40), suggestedImage: out.suggestedImage || null } : {}) };
}

// ── usage and budgets ──────────────────────────────────────────────────────────────────────────────────────
/** Writes one external call. costUsd null/undefined = unknown. Never throws into the caller's work (a lost usage row must not lose a paid result). */
async function recordUsage({ provider, endpoint = '', operation = '', requests = 1, units = null, costUsd = null, currency = 'USD', result = 'ok', projectId = null, meta = {} }) {
  try {
    const micros = costUsd === null || costUsd === undefined ? null : Math.round(Number(costUsd) * MICROS);
    if (micros !== null && (!Number.isFinite(micros) || micros < 0)) throw new Error('invalid cost');
    const row = (await db.query(`INSERT INTO api_usage (provider, endpoint, operation, requests, units, cost_micros, currency, result, project_id, meta)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [String(provider).slice(0, 40), String(endpoint).slice(0, 200), String(operation).slice(0, 100), Math.max(0, requests | 0), units === null ? null : Math.round(units), micros,
      String(currency).slice(0, 8), ['ok', 'error', 'blocked_budget'].includes(result) ? result : 'ok', projectId, JSON.stringify(meta || {})])).rows[0];
    if (micros !== null && micros > 0 && result === 'ok') await require('./costs').warnIfNearBudget(String(provider).slice(0, 40));
    return row.id;
  } catch (err) { console.error('[Content] api usage could not be written:', err.message); return null; }
}

async function spent({ provider = null, since }) {
  const r = (await db.query(`SELECT COALESCE(sum(cost_micros), 0)::bigint AS micros, count(*) FILTER (WHERE cost_micros IS NULL AND result = 'ok')::int AS unknown, COALESCE(sum(requests), 0)::int AS requests
    FROM api_usage WHERE created_at >= $1 ${provider ? 'AND provider = $2' : ''} AND result <> 'blocked_budget'`, provider ? [since, provider] : [since])).rows[0];
  return { micros: Number(r.micros), unknown: r.unknown, requests: r.requests };
}

/**
 * May a paid call that is expected to cost about `estimateUsd` start now?  { ok: true } or { ok: false, reason, message }.
 * Checks the provider's own daily/monthly budget and the platform budget (settings "budget"). Unknown past costs are counted as 0 here (they cannot be added) and reported.
 * A refused request is written as a "blocked_budget" usage row, so the panel shows that the guard worked.
 */
async function guard(provider, estimateUsd = 0, { tz = env().defaultTimezone, now = new Date(), projectId = null, operation = '' } = {}) {
  assertKey(provider);
  const est = Math.max(0, toMicros(estimateUsd) || 0);
  const row = (await db.query('SELECT daily_budget_micros, monthly_budget_micros FROM api_providers WHERE key = $1', [provider])).rows[0] || {};
  const plat = (await settings.get('budget')).value;
  const dayStart = startOfDay(now, tz); const monthStart = startOfMonth(now, tz);
  const checks = [
    { label: `${PROVIDERS[provider].label} günlük bütçesi`, limit: row.daily_budget_micros, since: dayStart, provider },
    { label: `${PROVIDERS[provider].label} aylık bütçesi`, limit: row.monthly_budget_micros, since: monthStart, provider },
    { label: 'Platform günlük bütçesi', limit: toMicros(plat.dailyTotalUsd), since: dayStart, provider: null },
    { label: 'Platform aylık bütçesi', limit: toMicros(plat.monthlyTotalUsd), since: monthStart, provider: null },
  ];
  for (const c of checks) {
    if (c.limit === null || c.limit === undefined) continue;
    const s = await spent({ provider: c.provider, since: c.since });
    if (s.micros + est > Number(c.limit)) {
      const message = `${c.label} doldu ($${(s.micros / MICROS).toFixed(2)} / $${(Number(c.limit) / MICROS).toFixed(2)}${est ? `, bu işlem ~$${(est / MICROS).toFixed(2)}` : ''})`;
      await recordUsage({ provider, operation, requests: 0, costUsd: null, result: 'blocked_budget', projectId, meta: { budget: c.label } });
      await announceBudget(c.label, message, dayStart);
      return { ok: false, reason: 'budget', message };
    }
  }
  return { ok: true };
}

/** "budget full" tells the owner ONCE per budget and day (every refused call is still written as a usage row) */
async function announceBudget(label, message, dayStart) {
  try {
    const seen = (await db.query("SELECT 1 FROM notifications WHERE type = 'budget_full' AND data->>'budget' = $1 AND created_at >= $2 LIMIT 1", [label, dayStart])).rows[0];
    if (!seen) await require('./notifications').create({ type: 'budget_full', severity: 'warning', title: 'API bütçesi doldu', body: `${message}. Bu bütçe dolana kadar ücretli işlemler başlamaz; bütçeyi API Kullanımı sayfasından değiştirebilirsiniz.`, data: { budget: label } });
  } catch (err) { console.error('[Content] budget notice failed:', err.message); }
}

/** The numbers of the cost page: today, this month, per provider, per day (last `days` days) and the latest calls. Unknown costs are counted, never added as 0. */
async function usageReport({ days = 30, tz = env().defaultTimezone, now = new Date(), limit = 50, provider = null } = {}) {
  const d = Math.min(90, Math.max(1, days | 0));
  const dayStart = startOfDay(now, tz); const monthStart = startOfMonth(now, tz);
  const since = new Date(dayStart.getTime() - (d - 1) * 86400000);
  const sum = async (since2, p) => { const s = await spent({ provider: p, since: since2 }); return { costUsd: s.micros / MICROS, unknownCalls: s.unknown, requests: s.requests }; };
  const per = (await db.query(`SELECT provider, COALESCE(sum(cost_micros), 0)::bigint AS micros, COALESCE(sum(requests), 0)::int AS requests, COALESCE(sum(units), 0)::bigint AS units,
      count(*) FILTER (WHERE cost_micros IS NULL AND result = 'ok')::int AS unknown, count(*) FILTER (WHERE result = 'error')::int AS errors, count(*) FILTER (WHERE result = 'blocked_budget')::int AS blocked
    FROM api_usage WHERE created_at >= $1 GROUP BY provider ORDER BY provider`, [since])).rows;
  const daily = (await db.query(`SELECT (created_at AT TIME ZONE $2)::date AS day, provider, COALESCE(sum(cost_micros), 0)::bigint AS micros, COALESCE(sum(requests), 0)::int AS requests
    FROM api_usage WHERE created_at >= $1 AND result <> 'blocked_budget' GROUP BY 1, 2 ORDER BY 1`, [since, tz])).rows;
  const params = [Math.min(200, Math.max(1, limit | 0))]; let w = '';
  if (provider) { params.push(provider); w = 'WHERE provider = $2'; }
  const recent = (await db.query(`SELECT id, provider, endpoint, operation, requests, units, cost_micros, currency, result, created_at FROM api_usage ${w} ORDER BY id DESC LIMIT $1`, params)).rows;
  return {
    today: await sum(dayStart, null), month: await sum(monthStart, null),
    providers: per.map((p) => ({ provider: p.provider, costUsd: Number(p.micros) / MICROS, requests: p.requests, units: Number(p.units), unknownCalls: p.unknown, errors: p.errors, blockedByBudget: p.blocked })),
    daily: daily.map((x) => ({ day: x.day instanceof Date ? x.day.toISOString().slice(0, 10) : String(x.day), provider: x.provider, costUsd: Number(x.micros) / MICROS, requests: x.requests })),
    recent: recent.map((x) => ({ id: Number(x.id), provider: x.provider, endpoint: x.endpoint, operation: x.operation, requests: x.requests, units: x.units === null ? null : Number(x.units),
      costUsd: x.cost_micros === null ? null : Number(x.cost_micros) / MICROS, costText: x.cost_micros === null ? 'Bilinmiyor' : `$${(Number(x.cost_micros) / MICROS).toFixed(4)}`, currency: x.currency, result: x.result, createdAt: x.created_at })),
  };
}

/**
 * Is every budget (the platform's and each provider's, day and month) comfortably open? Read only (nothing is recorded, nobody is told). Used by the production line to stop waiting for "tomorrow"
 * the moment the owner raises or removes a budget; "comfortably" = below 90% so a budget that is a hair under its limit does not make the line knock on the door every minute.
 */
async function budgetsOpen({ tz = env().defaultTimezone, now = new Date() } = {}) {
  const plat = (await settings.get('budget')).value; const dayStart = startOfDay(now, tz); const monthStart = startOfMonth(now, tz);
  const rows = (await db.query('SELECT key, daily_budget_micros, monthly_budget_micros FROM api_providers')).rows;
  const defs = [[toMicros(plat.dailyTotalUsd), dayStart, null], [toMicros(plat.monthlyTotalUsd), monthStart, null], ...rows.flatMap((r) => [[r.daily_budget_micros, dayStart, r.key], [r.monthly_budget_micros, monthStart, r.key]])];
  for (const [limit, since, provider] of defs) {
    if (limit === null || limit === undefined) continue;
    if ((await spent({ provider, since })).micros >= Number(limit) * 0.9) return false;
  }
  return true;
}

module.exports = { PROVIDERS, KEYS, list, get, save, secretFor, test, recordUsage, guard, usageReport, spent, budgetsOpen };
