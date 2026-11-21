const db = require('../db');
const V = require('../lib/validate');
const { isValidTimezone } = require('../lib/time');
const { HttpError, bad } = require('../lib/http');

/**
 * Content projects ("sites"), their niche, categories and excluded topics.
 *  - a project is one site's strategy: niche, categories with target shares, limits; articles belong to a project and a category
 *  - changing the main niche NEVER moves or deletes articles: it needs an explicit confirmation and only raises the niche version
 *  - the category shares of a project always add up to 100 (archived categories hold 0); they are a target for a rolling 30-day period, not a daily rule
 *  - topics out of scope are matched by whole phrases (matchExcluded); the AI later decides the rare exceptions, this is the hard filter
 */
const CONTENT_TYPES = ['breaking_news_explainer', 'latest_update', 'how_to_guide', 'comparison', 'faq', 'product_update', 'consumer_alert', 'evergreen_guide'];
const STATUSES = ['active', 'paused', 'archived'];

// ── the default technology project (spec sections 2 and 3.4) ──────────────────────────────────────────────
const DEFAULT_PROJECT = { name: 'Global Tech Content Site', siteName: 'Global Tech Content Site', domain: null, mode: 'archive' };
const DEFAULT_NICHE = {
  mainNiche: 'AI & Digital Technology Updates',
  description: 'Yapay zekâ araçları, dijital uygulamalar, yazılım güncellemeleri, internet güvenliği ve dijital servislerdeki gelişmeler. Güncel teknoloji gelişmelerini kullanıcıların anlayabileceği, uygulayabileceği ve karşılaştırabileceği faydalı içeriklere dönüştürür. Genel bir haber sitesi değildir.',
  targetAudience: 'English-speaking technology users in the United States, United Kingdom, Canada and Australia',
  targetCountries: ['US', 'GB', 'CA', 'AU'],
  language: 'en-US',
  tone: 'Clear, neutral and practical American English; explains updates so everyday users can understand, apply and compare them',
  contentTypes: CONTENT_TYPES,
  preferredTopics: ['AI tool updates and features', 'App and software updates', 'Online scams and account security', 'Step-by-step tech guides', 'Subscription and pricing changes'],
  minOpportunityScore: 70,
  dailyArticleLimit: 3,
};
const DEFAULT_CATEGORIES = [
  { name: 'Yapay Zekâ Araçları ve Güncellemeleri', nameEn: 'AI Tools & Updates', share: 35, dailyMax: 3, priority: 10,
    description: 'Yeni AI araçları, chatbot güncellemeleri, AI görsel/video araçları, karşılaştırmalar, abonelik değişiklikleri ve kullanım rehberleri.',
    scope: 'New AI tools, chatbot updates, AI image and video tools, AI software comparisons, feature updates, subscription changes, usage guides, productivity apps, platform announcements',
    keywords: ['chatgpt', 'gpt-4', 'gpt-5', 'openai', 'anthropic', 'claude', 'gemini', 'copilot', 'microsoft copilot', 'github copilot', 'midjourney', 'stable diffusion', 'sora', 'dall-e', 'perplexity', 'llama', 'mistral', 'deepseek', 'grok', 'hugging face', 'notebooklm', 'apple intelligence', 'meta ai', 'cursor', 'elevenlabs', 'suno', 'runway', 'chatbot', 'chatbots', 'ai assistant', 'ai agent', 'ai agents', 'agentic', 'large language model', 'llm', 'generative ai', 'genai', 'ai model', 'ai models', 'ai tool', 'ai tools', 'ai app', 'ai image generator', 'ai video', 'ai search', 'ai browser', 'ai coding', 'ai feature', 'ai pricing', 'ai subscription', 'voice assistant', 'alexa', 'siri', 'google assistant'], excluded: ['stock price of AI companies', 'AI doom speculation'] },
  { name: 'Uygulama ve Yazılım Güncellemeleri', nameEn: 'Apps & Software Updates', share: 25, dailyMax: 2, priority: 20,
    description: 'Popüler uygulama ve yazılım güncellemeleri, mobil/masaüstü işletim sistemi değişiklikleri, kaldırılan özellikler, uygulama hataları ve çözümleri.',
    scope: 'Popular app updates, new app features, mobile and desktop OS changes, software subscription changes, removed features, new integrations, app bugs and fixes',
    keywords: ['app update', 'software update', 'ios', 'ipados', 'macos', 'watchos', 'android', 'windows 11', 'windows 10', 'windows', 'linux', 'chrome', 'chromeos', 'firefox', 'safari', 'edge browser', 'whatsapp', 'instagram', 'tiktok', 'youtube', 'spotify', 'zoom', 'slack', 'microsoft 365', 'microsoft teams', 'excel', 'photoshop', 'adobe', 'figma', 'notion', 'github', 'patch notes', 'release notes', 'changelog', 'rolls out', 'rolling out', 'now available', 'beta', 'redesign', 'removes feature', 'discontinue', 'discontinued', 'shutting down', 'bug fix', 'outage', 'pixel', 'galaxy', 'iphone', 'ipad', 'macbook', 'chromebook', 'playstation', 'xbox', 'steam', 'telegram', 'discord', 'signal app', 'app store', 'google play', 'play store', 'microsoft store', 'sunsetting', 'retiring', 'end of support', 'no longer supported', 'google home', 'nest app', 'nest thermostat', 'google nest', 'smart home', 'chrome os', 'stable channel'], excluded: [] },
  { name: 'Dijital Gizlilik ve Güvenlik', nameEn: 'Digital Privacy & Security', share: 15, dailyMax: 1, priority: 30,
    description: 'Veri ihlalleri, kimlik avı ve dolandırıcılık uyarıları, hesap güvenliği, güvenlik güncellemeleri. Savunma ve farkındalık amaçlıdır; saldırıyı kolaylaştıran talimat içermez.',
    scope: 'Data breaches, digital privacy, phishing and online scams, account security, security updates, safe internet use, threats that affect users. Defensive and awareness content only',
    keywords: ['data breach', 'breach', 'breached', 'leak', 'leaked', 'ransomware', 'phishing', 'online scam', 'text scam', 'phishing scam', 'scam texts', 'scam calls', 'malware', 'spyware', 'stalkerware', 'infostealer', 'vulnerability', 'vulnerabilities', 'zero-day', 'zero day', 'exploit', 'exploited', 'cve', 'patch tuesday', 'security update', 'security patch', 'security flaw', 'password', 'passwords', 'passkey', 'passkeys', 'two-factor', '2fa', 'mfa', 'encryption', 'vpn', 'privacy settings', 'tracking', 'hackers', 'hacker', 'hacked', 'cyberattack', 'botnet', 'account takeover', 'deepfake', 'identity theft', 'data privacy', 'kev catalog', 'known exploited', 'security advisory', 'security breach', 'cyberattacks', 'cybersecurity', 'data leak', 'stolen data', 'hijack', 'hijacked'], excluded: ['hacking tutorials', 'exploit instructions'] },
  { name: 'Teknoloji Rehberleri ve Çözümler', nameEn: 'Tech Guides & Solutions', share: 15, dailyMax: null, priority: 40,
    description: 'Teknoloji kullanım rehberleri, uygulama sorunlarının çözümleri, kurulum rehberleri, yeni özelliklerin kullanımı, uygulama karşılaştırmaları.',
    scope: 'Technology how-to guides, AI tool usage, app problem fixes, software setup guides, using new features, practical tips, digital workflows, app comparisons',
    keywords: ['how to', 'step by step', 'tutorial', 'troubleshoot', 'troubleshooting', 'not working', 'how do i', 'set up', 'setup guide', 'settings you should', 'hidden feature', 'hidden features', 'tips and tricks', 'workaround', 'login problem', 'update error', 'fix for', 'explained', 'what is', 'beginner', 'cheat sheet', 'checklist', 'turn off', 'turn on', 'disable', 'enable', 'recover', 'reset'], excluded: [] },
  { name: 'Dijital Servisler ve Fiyatlandırma', nameEn: 'Digital Services & Pricing', share: 10, dailyMax: null, priority: 50,
    description: 'Dijital abonelik fiyatları, ücretsiz/ücretli plan karşılaştırmaları, yazılım abonelik değişiklikleri, kullanım şartı değişiklikleri. Fiyatlar güncel ve gerçek kaynaklardan doğrulanır.',
    scope: 'Digital subscription prices, free vs paid plan comparisons, software subscription changes, membership models, paid features, terms-of-use changes',
    keywords: ['subscription', 'subscriptions', 'price increase', 'price hike', 'raises price', 'raises prices', 'pricing plan', 'free plan', 'paid plan', 'premium', 'per month', 'a month', 'plus plan', 'pro plan', 'membership', 'tier', 'ad-supported', 'ads tier', 'netflix', 'disney+', 'hulu', 'max streaming', 'youtube premium', 'icloud', 'google one', 'terms of service', 'terms of use', 'bundle', 'cancel', 'worth it', 'free vs paid', 'chatgpt plus', 'gemini advanced', 'claude pro', 'prime video', 'apple one', 'game pass'], excluded: [] },
];

/** The lists of the SECOND default (what projects seeded before 2026-11-21 evening received): kept so an untouched list can be recognised and upgraded. */
const DEFAULTS_V2 = {"AI Tools & Updates": {"keywords": ["chatgpt", "gpt-4", "gpt-5", "openai", "anthropic", "claude", "gemini", "copilot", "microsoft copilot", "github copilot", "midjourney", "stable diffusion", "sora", "dall-e", "perplexity", "llama", "mistral", "deepseek", "grok", "hugging face", "notebooklm", "apple intelligence", "meta ai", "cursor", "elevenlabs", "suno", "runway", "chatbot", "chatbots", "ai assistant", "ai agent", "ai agents", "agentic", "large language model", "llm", "generative ai", "genai", "ai model", "ai models", "ai tool", "ai tools", "ai app", "ai image generator", "ai video", "ai search", "ai browser", "ai coding", "ai feature", "ai pricing", "ai subscription", "voice assistant", "alexa", "siri", "google assistant"], "excluded": ["stock price of AI companies", "AI doom speculation"]}, "Apps & Software Updates": {"keywords": ["app update", "software update", "ios", "ipados", "macos", "watchos", "android", "windows 11", "windows 10", "windows", "linux", "chrome", "chromeos", "firefox", "safari", "edge browser", "whatsapp", "instagram", "tiktok", "youtube", "spotify", "zoom", "slack", "microsoft 365", "microsoft teams", "excel", "photoshop", "adobe", "figma", "notion", "github", "patch notes", "release notes", "changelog", "rolls out", "rolling out", "now available", "beta", "redesign", "removes feature", "discontinue", "discontinued", "shutting down", "bug fix", "outage", "pixel", "galaxy", "iphone", "ipad", "macbook", "chromebook", "playstation", "xbox", "steam", "telegram", "discord", "signal app", "app store", "google play", "play store", "microsoft store", "sunsetting", "retiring", "end of support", "no longer supported", "google home", "nest app", "nest thermostat", "google nest", "smart home", "chrome os", "stable channel"], "excluded": []}, "Digital Privacy & Security": {"keywords": ["data breach", "breach", "breached", "leak", "leaked", "ransomware", "phishing", "online scam", "text scam", "phishing scam", "scam texts", "scam calls", "malware", "spyware", "stalkerware", "infostealer", "vulnerability", "vulnerabilities", "zero-day", "zero day", "exploit", "exploited", "cve", "patch tuesday", "security update", "security patch", "security flaw", "password", "passwords", "passkey", "passkeys", "two-factor", "2fa", "mfa", "encryption", "vpn", "privacy settings", "tracking", "hackers", "hacker", "hacked", "cyberattack", "botnet", "account takeover", "deepfake", "identity theft", "data privacy", "kev catalog", "known exploited", "security advisory", "security breach", "cyberattacks", "cybersecurity", "data leak", "stolen data", "hijack", "hijacked"], "excluded": ["hacking tutorials", "exploit instructions"]}, "Tech Guides & Solutions": {"keywords": ["how to", "step by step", "tutorial", "troubleshoot", "troubleshooting", "not working", "how do i", "set up", "setup guide", "settings you should", "hidden feature", "hidden features", "tips and tricks", "workaround", "login problem", "update error", "fix for", "explained", "what is", "beginner", "cheat sheet", "checklist", "turn off", "turn on", "disable", "enable", "recover", "reset"], "excluded": []}, "Digital Services & Pricing": {"keywords": ["subscription", "subscriptions", "price increase", "price hike", "raises price", "raises prices", "pricing plan", "free plan", "paid plan", "premium", "per month", "a month", "plus plan", "pro plan", "membership", "tier", "ad-supported", "ads tier", "netflix", "disney+", "hulu", "max streaming", "youtube premium", "icloud", "google one", "terms of service", "terms of use", "bundle", "cancel", "worth it", "free vs paid", "chatgpt plus", "gemini advanced", "claude pro", "prime video", "apple one", "game pass"], "excluded": []}};

/**
 * THIRD default (tuned on 490 real headlines): what was added to / taken out of the second lists, and why.
 *  - device names (iphone, galaxy, pixel, macbook, airpods ...) are no longer strong terms: a phone review or deal is not a software/app update; the OS names (ios, android ...) still match updates
 *  - new real terms the first scans missed (Meta Muse, Codex, ClickFix, "flaw", Google Search AI, wallets, privacy-policy / AI-training changes ...)
 *  - category exclusions of "Digital Privacy & Security": enterprise infrastructure products (VMware, Cisco, F5, PHP, KVM ...) and legal / crime reports are not for readers of a consumer tech site
 */
const DELTA_V3 = {
  'AI Tools & Updates': { add: ['meta muse', 'muse ai', 'codex', 'claude code', 'claude opus', 'gemini 4', 'gpt-6', 'genie 4', 'claude ai', 'claude sonnet', 'claude haiku', 'claude pro', 'claude free', 'claude max', 'claude settings', 'claude desktop', 'ai mode', 'ai overviews', 'prompting', 'prompt engineering', 'search homepage', 'ai chat'], remove: [] },
  'Apps & Software Updates': { add: ['apple wallet', 'google wallet', 'car keys', 'imessage', 'facetime', 'carplay', 'android auto', 'wear os', 'tvos', 'visionos', 'google search'], remove: ['pixel', 'galaxy', 'iphone', 'ipad', 'macbook', 'chromebook', 'playstation', 'xbox', 'steam'] },
  'Digital Privacy & Security': { add: ['clickfix', 'trojan', 'remote access trojan', 'credential theft', 'data stolen', 'flaw', 'flaws', 'critical flaw', 'hard-coded', 'sim swap', 'fake app', 'fake apps', 'privacy policy', 'policy changes', 'ai training', 'train ai', 'training data', 'private chats'], remove: [],
    excluded: ['lawsuit', 'suit', 'sues', 'sued', 'class action', 'sentenced', 'pleads guilty', 'indicted', 'arrested', 'vmware', 'vcenter', 'cisco', 'f5', 'big-ip', 'sonicwall', 'fortinet', 'citrix', 'ivanti', 'palo alto', 'juniper', 'nginx', 'apache', 'php', 'drupal', 'ruby', 'rails', 'gnupg',
      'postgresql', 'mysql', 'oracle', 'kvm', 'linux kernel', 'kubernetes', 'docker', 'jenkins', 'gitlab', 'scada', 'plc', 'industrial control', 'openplc', 'siemens'] },
  'Tech Guides & Solutions': { add: [], remove: [] },
  'Digital Services & Pricing': { add: ['price change', 'price changes', 'paramount plus', 'peacock', 'hbo max'], remove: [] },
};
const v3 = (name, field) => {
  const base = DEFAULTS_V2[name][field === 'excluded' ? 'excluded' : 'keywords']; const d = DELTA_V3[name];
  const removed = new Set(d.remove || []); const extra = field === 'excluded' ? (d.excluded || []) : d.add;
  return [...new Set([...base.filter((x) => !removed.has(x)), ...extra])];
};
for (const c of DEFAULT_CATEGORIES) { c.keywords = v3(c.nameEn, 'keywords'); c.excluded = v3(c.nameEn, 'excluded'); }
const LEGACY_KEYWORDS_V1 = {"AI Tools & Updates": ["ai tool", "chatbot", "ai image generator", "ai video", "ai update", "ai feature", "ai pricing"], "Apps & Software Updates": ["app update", "software update", "ios update", "android update", "windows update", "feature removed", "new feature"], "Digital Privacy & Security": ["data breach", "phishing", "online scam", "account security", "privacy settings", "security update", "password leak"], "Tech Guides & Solutions": ["how to", "fix", "troubleshoot", "step by step", "setup guide", "login problem", "update error"], "Digital Services & Pricing": ["subscription price", "free vs paid", "pricing change", "premium plan", "basic plan", "worth it"]};
const DEFAULT_EXCLUDED = [
  ['celebrity gossip', 'Magazin ve ünlü dedikoduları'], ['celebrity news', 'Magazin ve ünlü dedikoduları'], ['celebrity biography', 'Ünlü yaşam hikâyeleri'],
  ['sports news', 'Spor haberleri'], ['football match', 'Spor haberleri'], ['basketball game', 'Spor haberleri'], ['match result', 'Spor haberleri'],
  ['election', 'Genel siyasi haberler'], ['political party', 'Parti siyaseti'], ['presidential campaign', 'Genel siyasi haberler'],
  ['stock market', 'Genel finans ve borsa haberleri'], ['stock price', 'Genel finans ve borsa haberleri'], ['interest rates', 'Genel finans ve borsa haberleri'],
  ['medical diagnosis', 'Sağlık teşhis ve tedavi içerikleri'], ['treatment plan', 'Sağlık teşhis ve tedavi içerikleri'], ['cure for', 'Sağlık teşhis ve tedavi içerikleri'],
  ['crypto price prediction', 'Kripto fiyat tahminleri'], ['bitcoin price', 'Kripto fiyat tahminleri'], ['price forecast', 'Kripto fiyat tahminleri'],
  ['online casino', 'Kumar içerikleri'], ['sports betting', 'Kumar içerikleri'], ['gambling', 'Kumar içerikleri'], ['porn', 'Yetişkin içerikler'], ['adult content', 'Yetişkin içerikler'],
  ['visa requirements', 'Genel seyahat ve vize haberleri'], ['travel ban', 'Genel seyahat ve vize haberleri'],
  ['grand prix', 'Spor haberleri'], ['formula 1', 'Spor haberleri'], ['premier league', 'Spor haberleri'], ['champions league', 'Spor haberleri'], ['world cup', 'Spor haberleri'], ['super bowl', 'Spor haberleri'], ['nfl', 'Spor haberleri'], ['nba', 'Spor haberleri'],
  ['real estate', 'Genel finans haberleri'], ['mansion', 'Genel finans haberleri'], ['mortgage', 'Genel finans haberleri'], ['stock market', 'Genel finans haberleri'],
  ['black friday', 'Alışveriş fırsatı / indirim haberleri'], ['cyber monday', 'Alışveriş fırsatı / indirim haberleri'], ['deal', 'Alışveriş fırsatı / indirim haberleri'], ['deals', 'Alışveriş fırsatı / indirim haberleri'], ['discount', 'Alışveriş fırsatı / indirim haberleri'],
  ['discounts', 'Alışveriş fırsatı / indirim haberleri'], ['promo code', 'Alışveriş fırsatı / indirim haberleri'], ['promo codes', 'Alışveriş fırsatı / indirim haberleri'], ['coupon', 'Alışveriş fırsatı / indirim haberleri'], ['coupons', 'Alışveriş fırsatı / indirim haberleri'],
  ['coupon code', 'Alışveriş fırsatı / indirim haberleri'], ['coupon codes', 'Alışveriş fırsatı / indirim haberleri'], ['gift guide', 'Alışveriş fırsatı / indirim haberleri'],
  ['ipo', 'Finans, yatırım ve halka arz haberleri'], ['valuation', 'Finans, yatırım ve halka arz haberleri'], ['market cap', 'Finans, yatırım ve halka arz haberleri'], ['investors', 'Finans, yatırım ve halka arz haberleri'], ['earnings', 'Finans, yatırım ve halka arz haberleri'],
  ['funding round', 'Finans, yatırım ve halka arz haberleri'], ['shareholders', 'Finans, yatırım ve halka arz haberleri'], ['wall street', 'Finans, yatırım ve halka arz haberleri'],
  ['seeking alpha', 'Finans/düşük kaliteli yayıncı'], ['investing com', 'Finans/düşük kaliteli yayıncı'], ['tradingview', 'Finans/düşük kaliteli yayıncı'], ['yahoo finance', 'Finans/düşük kaliteli yayıncı'], ['cointribune', 'Finans/düşük kaliteli yayıncı'],
  ['benzinga', 'Finans/düşük kaliteli yayıncı'], ['motley fool', 'Finans/düşük kaliteli yayıncı'], ['marketwatch', 'Finans/düşük kaliteli yayıncı'], ['substack', 'Düşük kaliteli yayıncı'],
  ['chrome dev', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'], ['chrome beta', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'], ['early stable', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'], ['public beta', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'],
  ['developer beta', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'], ['release candidate', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'], ['rcs', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'], ['insider preview', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'],
  ['windows insider', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'], ['new builds for', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'], ['beta channel', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'], ['dev channel', 'Beta/Insider sürüm notları (genel kullanıcıya değil)'],
  ['9to5mac daily', 'Podcast / özet yayınları'], ['9to5mac overtime', 'Podcast / özet yayınları'], ['top five stories', 'Podcast / özet yayınları'], ['weekly roundup', 'Podcast / özet yayınları'], ['news roundup', 'Podcast / özet yayınları'], ['podcast', 'Podcast / özet yayınları'],
  ['newsletter', 'Podcast / özet yayınları'], ['week in review', 'Podcast / özet yayınları'], ['drug discovery', 'Sağlık teşhis ve tedavi içerikleri'], ['drug candidates', 'Sağlık teşhis ve tedavi içerikleri'], ['f1', 'Spor haberleri'], ['race week', 'Spor haberleri'],
  ['horoscope', 'Burç / astroloji (alakasız)'], ['zodiac', 'Burç / astroloji (alakasız)'], ['astrology', 'Burç / astroloji (alakasız)'], ['lowest price', 'Alışveriş fırsatı / indirim haberleri'], ['price cut', 'Alışveriş fırsatı / indirim haberleri'],
  ['daas', 'Kurumsal BT / altyapı haberleri'], ['virtual desktops', 'Kurumsal BT / altyapı haberleri'], ['azure', 'Kurumsal BT / altyapı haberleri'], ['aws', 'Kurumsal BT / altyapı haberleri'], ['data center', 'Kurumsal BT / altyapı haberleri'], ['data centers', 'Kurumsal BT / altyapı haberleri'],
  ['oncology', 'Sağlık teşhis ve tedavi içerikleri'], ['cancer', 'Sağlık teşhis ve tedavi içerikleri'], ['clinical trial', 'Sağlık teşhis ve tedavi içerikleri'], ['patients', 'Sağlık teşhis ve tedavi içerikleri'],
  ['estate planning', 'Genel finans haberleri'], ['wealth management', 'Genel finans haberleri'], ['financial planning', 'Genel finans haberleri'], ['investment advice', 'Genel finans haberleri'],
];

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────
const { fold } = require('../lib/text');

/** Which of the excluded topics does this text contain, as whole phrases? ("football match" in "A football match ended" yes; "porn" in "pornography" no) */
function matchExcluded(text, topics) {
  const hay = ` ${fold(text)} `;
  const hits = [];
  for (const t of topics || []) {
    const phrase = fold(typeof t === 'string' ? t : t.topic);
    if (phrase && hay.includes(` ${phrase} `)) hits.push(typeof t === 'string' ? t : t.topic);
  }
  return hits;
}

/**
 * Takes the share of one removed category and gives it to the others in proportion to their own shares (largest remainder, so the total stays exactly 100).
 * @param list [{ id, share }]  @returns Map id -> new share (the removed one is not in it)
 */
function redistribute(list, removedId) {
  const removed = list.find((x) => x.id === removedId);
  const rest = list.filter((x) => x.id !== removedId);
  const out = new Map(rest.map((x) => [x.id, x.share]));
  if (!removed || rest.length === 0 || removed.share === 0) return out;
  const base = rest.reduce((a, x) => a + x.share, 0);
  const weights = rest.map((x) => (base > 0 ? x.share : 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const exact = rest.map((x, i) => x.share + (removed.share * weights[i]) / wsum);
  const floor = exact.map(Math.floor);
  let left = rest.reduce((a, x) => a + x.share, 0) + removed.share - floor.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - floor[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; floor[i]++; left--; }
  rest.forEach((x, i) => out.set(x.id, floor[i]));
  return out;
}

// ── projects ───────────────────────────────────────────────────────────────────────────────────────────────
const projectRow = (r) => r && ({ id: r.id, name: r.name, siteName: r.site_name, domain: r.domain, mode: r.mode, status: r.status, isDefault: r.is_default, timezone: r.timezone, createdAt: r.created_at, updatedAt: r.updated_at });
const nicheRow = (r) => r && ({ projectId: r.project_id, mainNiche: r.main_niche, description: r.description, targetAudience: r.target_audience, targetCountries: r.target_countries, language: r.language, tone: r.tone,
  contentTypes: r.content_types, preferredTopics: r.preferred_topics, minOpportunityScore: r.min_opportunity_score, dailyArticleLimit: r.daily_article_limit, version: r.version, updatedAt: r.updated_at });
const categoryRow = (r) => ({ id: r.id, projectId: r.project_id, name: r.name, nameEn: r.name_en, description: r.description, scope: r.scope, relatedKeywords: r.related_keywords, excludedTopics: r.excluded_topics,
  targetSharePct: r.target_share_pct, dailyMax: r.daily_max, minOpportunityScore: r.min_opportunity_score, status: r.status, priority: r.priority, articleCount: r.article_count === undefined ? undefined : Number(r.article_count) });

async function listProjects() {
  const r = await db.query(`SELECT p.*, n.main_niche, (SELECT count(*)::int FROM articles a WHERE a.project_id = p.id) AS article_count,
    (SELECT count(*)::int FROM categories c WHERE c.project_id = p.id AND c.status <> 'archived') AS category_count
    FROM content_projects p LEFT JOIN niche_profiles n ON n.project_id = p.id ORDER BY p.is_default DESC, p.created_at`);
  return r.rows.map((x) => ({ ...projectRow(x), mainNiche: x.main_niche, articleCount: x.article_count, categoryCount: x.category_count }));
}

async function getProject(id) {
  const p = (await db.query('SELECT * FROM content_projects WHERE id = $1', [id])).rows[0];
  if (!p) throw new HttpError(404, 'Proje bulunamadı');
  const n = (await db.query('SELECT * FROM niche_profiles WHERE project_id = $1', [id])).rows[0];
  return { ...projectRow(p), niche: nicheRow(n) };
}

function projectFields(v, { partial = false } = {}) {
  const out = {};
  if (!partial || v.name !== undefined) out.name = V.str(v.name, 'İçerik projesi adı', { required: true, max: 120 });
  if (!partial || v.siteName !== undefined) out.siteName = V.str(v.siteName === undefined ? v.name : v.siteName, 'Site adı', { required: true, max: 120 });
  if (!partial || v.domain !== undefined) {
    const d = V.str(v.domain, 'Alan adı', { max: 200 });
    if (d && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(d)) throw bad('Alan adı geçerli olmalı (ör. example.com); https:// yazmayın');
    out.domain = d ? d.toLowerCase() : null;
  }
  if (v.timezone !== undefined) { const tz = V.str(v.timezone, 'Saat dilimi', { required: true, max: 60 }); if (!isValidTimezone(tz)) throw bad('Saat dilimi geçersiz'); out.timezone = tz; }
  if (v.status !== undefined) out.status = V.oneOf(v.status, 'Durum', STATUSES);
  return out;
}

function nicheFields(v, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || v[k] !== undefined;
  if (has('mainNiche')) out.main_niche = V.str(v.mainNiche, 'Ana niş', { required: true, max: 150 });
  if (has('description')) out.description = V.str(v.description, 'Niş açıklaması', { max: 2000, multiline: true });
  if (has('targetAudience')) out.target_audience = V.str(v.targetAudience, 'Hedef kitle', { max: 500 });
  if (has('targetCountries')) out.target_countries = V.strList(v.targetCountries, 'Hedef ülkeler', { maxItems: 12, maxLen: 2 }).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  if (has('language')) out.language = V.str(v.language || 'en-US', 'İçerik dili', { required: true, max: 10 });
  if (has('tone')) out.tone = V.str(v.tone, 'İçerik üslubu', { max: 500 });
  if (has('contentTypes')) { const l = V.strList(v.contentTypes, 'İçerik türleri', { maxItems: 20, maxLen: 40 }); for (const t of l) if (!CONTENT_TYPES.includes(t)) throw bad(`Bilinmeyen içerik türü: ${t}`); out.content_types = l; }
  if (has('preferredTopics')) out.preferred_topics = V.strList(v.preferredTopics, 'Öncelikli konular', { maxItems: 50, maxLen: 150 });
  if (has('minOpportunityScore')) out.min_opportunity_score = V.int(v.minOpportunityScore, 'Minimum SEO fırsat puanı', { min: 0, max: 100 });
  if (has('dailyArticleLimit')) out.daily_article_limit = V.int(v.dailyArticleLimit, 'Günlük içerik limiti', { min: 0, max: 50 });
  return out;
}

async function insertNiche(c, projectId, f, userId) {
  const cols = ['project_id', ...Object.keys(f), 'updated_by'];
  const vals = [projectId, ...Object.values(f), userId];
  await c.query(`INSERT INTO niche_profiles (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
}

async function createProject(body, { userId = null } = {}) {
  const f = projectFields(body);
  // a new project must name its own main niche; the rest starts from neutral defaults (the technology defaults belong only to the seeded project)
  const nf = nicheFields({ language: 'en-US', contentTypes: CONTENT_TYPES, minOpportunityScore: 70, dailyArticleLimit: 3, ...(body.niche || {}) });
  return db.tx(async (c) => {
    const isFirst = (await c.query('SELECT count(*)::int n FROM content_projects')).rows[0].n === 0;
    const r = (await c.query('INSERT INTO content_projects (name, site_name, domain, mode, timezone, is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [f.name, f.siteName, f.domain, f.domain ? 'connected' : 'archive', f.timezone || 'Europe/Istanbul', isFirst])).rows[0];
    await insertNiche(c, r.id, nf, userId);
    return r.id;
  }).then((id) => getProject(id));
}

async function updateProject(id, body) {
  await getProject(id);
  const f = projectFields(body, { partial: true });
  const sets = []; const vals = [];
  const map = { name: 'name', siteName: 'site_name', domain: 'domain', timezone: 'timezone', status: 'status' };
  for (const [k, col] of Object.entries(map)) if (f[k] !== undefined) { vals.push(f[k]); sets.push(`${col} = $${vals.length}`); }
  if (f.domain !== undefined) sets.push(`mode = '${f.domain ? 'connected' : 'archive'}'`);
  if (sets.length) { vals.push(id); await db.query(`UPDATE content_projects SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals); }
  return getProject(id);
}

/**
 * Niche profile update. Changing the MAIN NICHE needs `confirmNicheChange: true` (it can change the SEO strategy);
 * the answer without it is a 409 that says what stays as it is. Articles are never touched.
 */
async function updateNiche(projectId, body, { userId = null } = {}) {
  const proj = await getProject(projectId);
  const f = nicheFields(body, { partial: true });
  const nicheChanges = f.main_niche !== undefined && f.main_niche !== proj.niche.mainNiche;
  if (nicheChanges && body.confirmNicheChange !== true) {
    const articles = (await db.query('SELECT count(*)::int n FROM articles WHERE project_id = $1', [projectId])).rows[0].n;
    throw new HttpError(409, `Ana nişi “${proj.niche.mainNiche}” iken “${f.main_niche}” olarak değiştirmek mevcut SEO stratejinizi etkileyebilir. Bu projedeki ${articles} makale silinmez ve başka nişe taşınmaz; yalnızca sonraki haber, anahtar kelime ve içerik kararları yeni nişe göre verilir.`, { requiresConfirmation: true, articles });
  }
  if (Object.keys(f).length) {
    const cols = Object.keys(f); const vals = Object.values(f);
    await db.query(`UPDATE niche_profiles SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')}, ${nicheChanges ? 'version = version + 1, ' : ''}updated_by = $${vals.length + 1}, updated_at = now() WHERE project_id = $${vals.length + 2}`, [...vals, userId, projectId]);
  }
  return getProject(projectId);
}

// ── categories ─────────────────────────────────────────────────────────────────────────────────────────────
async function listCategories(projectId) {
  const r = await db.query(`SELECT c.*, (SELECT count(*) FROM articles a WHERE a.category_id = c.id) AS article_count FROM categories c WHERE c.project_id = $1 ORDER BY (c.status = 'archived'), c.priority, c.name`, [projectId]);
  return r.rows.map(categoryRow);
}

function categoryFields(v, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || v[k] !== undefined;
  if (has('name')) out.name = V.str(v.name, 'Kategori adı', { required: true, max: 120 });
  if (has('nameEn')) out.name_en = V.str(v.nameEn, 'İngilizce kategori adı', { required: true, max: 120 });
  if (has('description')) out.description = V.str(v.description, 'Açıklama', { max: 1000, multiline: true });
  if (has('scope')) out.scope = V.str(v.scope, 'İçerik kapsamı', { max: 1500, multiline: true });
  if (has('relatedKeywords')) out.related_keywords = V.strList(v.relatedKeywords, 'İlgili anahtar kelimeler', { maxItems: 100, maxLen: 80 });
  if (has('excludedTopics')) out.excluded_topics = V.strList(v.excludedTopics, 'Hariç tutulan konular', { maxItems: 100, maxLen: 120 });
  if (v.dailyMax !== undefined) out.daily_max = V.int(v.dailyMax, 'Günlük maksimum makale', { min: 0, max: 50, nullable: true });
  if (v.minOpportunityScore !== undefined) out.min_opportunity_score = V.int(v.minOpportunityScore, 'Minimum fırsat puanı', { min: 0, max: 100, nullable: true });
  if (v.status !== undefined) out.status = V.oneOf(v.status, 'Durum', ['active', 'paused']);
  if (v.priority !== undefined) out.priority = V.int(v.priority, 'Öncelik sırası', { min: 0, max: 10000 });
  return out;
}

async function createCategory(projectId, body) {
  await getProject(projectId);
  const f = categoryFields(body);
  const cols = ['project_id', ...Object.keys(f)]; const vals = [projectId, ...Object.values(f)];
  try {
    const r = (await db.query(`INSERT INTO categories (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals)).rows[0];
    return categoryRow(r);               // a new category starts with a 0% share: the total stays 100 until the person moves some
  } catch (err) { if (err.code === '23505') throw new HttpError(409, 'Bu projede aynı İngilizce adla bir kategori var'); throw err; }
}

async function getCategory(id) {
  const r = (await db.query('SELECT * FROM categories WHERE id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'Kategori bulunamadı');
  return r;
}

async function updateCategory(id, body) {
  const cur = await getCategory(id);
  if (cur.status === 'archived') throw new HttpError(409, 'Arşivlenmiş kategori düzenlenemez');
  const f = categoryFields(body, { partial: true });
  const cols = Object.keys(f);
  if (cols.length) {
    try { await db.query(`UPDATE categories SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = $${cols.length + 1}`, [...Object.values(f), id]); }
    catch (err) { if (err.code === '23505') throw new HttpError(409, 'Bu projede aynı İngilizce adla bir kategori var'); throw err; }
  }
  return categoryRow(await getCategory(id));
}

/** All shares at once: every non-archived category of the project must be listed and the total must be exactly 100. */
async function setShares(projectId, shares) {
  if (!Array.isArray(shares)) throw bad('Kategori payları bir liste olmalı');
  const cats = (await db.query("SELECT id, name FROM categories WHERE project_id = $1 AND status <> 'archived'", [projectId])).rows;
  const want = new Map();
  for (const s of shares) { const id = V.uuid(s && s.id, 'Kategori'); if (want.has(id)) throw bad('Aynı kategori iki kez gönderildi'); want.set(id, V.int(s.share, 'Yayın payı', { min: 0, max: 100 })); }
  for (const c of cats) if (!want.has(c.id)) throw bad(`“${c.name}” kategorisinin payı gönderilmedi`);
  if (want.size !== cats.length) throw bad('Bu projeye ait olmayan ya da arşivlenmiş bir kategori gönderildi');
  const total = [...want.values()].reduce((a, b) => a + b, 0);
  if (cats.length && total !== 100) throw bad(`Kategori paylarının toplamı %100 olmalı (şu an %${total})`);
  await db.tx(async (c) => { for (const [id, share] of want) await c.query('UPDATE categories SET target_share_pct = $1, updated_at = now() WHERE id = $2', [share, id]); });
  return listCategories(projectId);
}

async function takeOut(c, cat) {
  const rest = (await c.query("SELECT id, target_share_pct FROM categories WHERE project_id = $1 AND status <> 'archived'", [cat.project_id])).rows.map((r) => ({ id: r.id, share: r.target_share_pct }));
  const next = redistribute(rest, cat.id);
  for (const [id, share] of next) await c.query('UPDATE categories SET target_share_pct = $1, updated_at = now() WHERE id = $2', [share, id]);
}

/** Archive: the category stays (with its articles), its share goes to the others. */
async function archiveCategory(id) {
  const cat = await getCategory(id);
  if (cat.status === 'archived') return categoryRow(cat);
  await db.tx(async (c) => { await takeOut(c, cat); await c.query("UPDATE categories SET status = 'archived', target_share_pct = 0, updated_at = now() WHERE id = $1", [id]); });
  return categoryRow(await getCategory(id));
}

async function deleteCategory(id) {
  const cat = await getCategory(id);
  const n = (await db.query('SELECT count(*)::int n FROM articles WHERE category_id = $1', [id])).rows[0].n;
  if (n > 0) throw new HttpError(409, `Bu kategoride ${n} makale var; silmek yerine arşivleyin`, { articles: n });
  await db.tx(async (c) => { if (cat.status !== 'archived') await takeOut(c, cat); await c.query('DELETE FROM categories WHERE id = $1', [id]); });
}

// ── excluded topics ───────────────────────────────────────────────────────────────────────────────────────
const topicRow = (r) => ({ id: r.id, projectId: r.project_id, categoryId: r.category_id, topic: r.topic, reason: r.reason, isDefault: r.is_default, isActive: r.is_active });

async function listExcluded(projectId) { return (await db.query('SELECT * FROM excluded_topics WHERE project_id = $1 ORDER BY is_default DESC, topic', [projectId])).rows.map(topicRow); }

async function addExcluded(projectId, { topic, reason, categoryId }) {
  await getProject(projectId);
  const t = V.str(topic, 'Konu', { required: true, max: 150 });
  if (!fold(t)) throw bad('Konu harf ya da rakam içermeli');
  const cat = categoryId ? V.uuid(categoryId, 'Kategori') : null;
  if (cat) { const c = await getCategory(cat); if (c.project_id !== projectId) throw bad('Kategori bu projeye ait değil'); }
  const dup = (await db.query('SELECT 1 FROM excluded_topics WHERE project_id = $1 AND lower(topic) = lower($2) AND category_id IS NOT DISTINCT FROM $3', [projectId, t, cat])).rows[0];
  if (dup) throw new HttpError(409, 'Bu konu zaten listede');
  return topicRow((await db.query('INSERT INTO excluded_topics (project_id, category_id, topic, reason) VALUES ($1,$2,$3,$4) RETURNING *', [projectId, cat, t, V.str(reason, 'Neden', { max: 300 })])).rows[0]);
}

async function setExcludedActive(id, active) {
  const r = (await db.query('UPDATE excluded_topics SET is_active = $1 WHERE id = $2 RETURNING *', [V.bool(active, 'Aktif'), id])).rows[0];
  if (!r) throw new HttpError(404, 'Konu bulunamadı');
  return topicRow(r);
}

async function removeExcluded(id) { const r = await db.query('DELETE FROM excluded_topics WHERE id = $1', [id]); if (!r.rowCount) throw new HttpError(404, 'Konu bulunamadı'); }

/** Is this text in scope? Checks the active excluded topics of the project (and of the given category). */
async function checkTopic(projectId, text, categoryId = null) {
  const rows = (await db.query('SELECT topic, reason FROM excluded_topics WHERE project_id = $1 AND is_active AND (category_id IS NULL OR category_id = $2)', [projectId, categoryId])).rows;
  const cat = categoryId ? (await db.query('SELECT excluded_topics FROM categories WHERE id = $1', [categoryId])).rows[0] : null;
  const all = [...rows, ...((cat ? cat.excluded_topics : []).map((t) => ({ topic: t, reason: 'Kategori kapsamı dışı' })))];
  const hits = matchExcluded(text, all);
  return { allowed: hits.length === 0, matched: all.filter((x) => hits.includes(x.topic)).map((x) => ({ topic: x.topic, reason: x.reason })) };
}

// ── the default project ───────────────────────────────────────────────────────────────────────────────────
/** Creates "Global Tech Content Site" (AI & Digital Technology Updates) with its 5 categories, shares and excluded topics, unless a project exists already. */
async function seedDefault({ userId = null } = {}) {
  const existing = (await db.query('SELECT id FROM content_projects ORDER BY is_default DESC, created_at LIMIT 1')).rows[0];
  if (existing) return { created: false, projectId: existing.id };
  const f = projectFields(DEFAULT_PROJECT);
  const nf = nicheFields(DEFAULT_NICHE);
  const projectId = await db.tx(async (c) => {
    const r = (await c.query('INSERT INTO content_projects (name, site_name, domain, mode, is_default) VALUES ($1,$2,$3,$4,true) RETURNING id', [f.name, f.siteName, null, 'archive'])).rows[0];
    await insertNiche(c, r.id, nf, userId);
    for (const k of DEFAULT_CATEGORIES) {
      await c.query('INSERT INTO categories (project_id, name, name_en, description, scope, related_keywords, excluded_topics, target_share_pct, daily_max, priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [r.id, k.name, k.nameEn, k.description, k.scope, k.keywords, k.excluded, k.share, k.dailyMax, k.priority]);
    }
    for (const [topic, reason] of DEFAULT_EXCLUDED) await c.query('INSERT INTO excluded_topics (project_id, topic, reason, is_default) VALUES ($1,$2,$3,true)', [r.id, topic, reason]);
    await c.query("INSERT INTO automation_settings (scope, project_id, key, value) VALUES ('project', $1, 'defaults_version', $2) ON CONFLICT DO NOTHING", [r.id, JSON.stringify({ version: 3 })]);
    return r.id;
  });
  return { created: true, projectId };
}


/**
 * The first live seed had short keyword lists. Replaces a default category's list ONLY when it still equals that first seed exactly (so anything the owner edited stays),
 * with the richer list the news filter needs. Safe to run at every start.
 */
async function upgradeDefaultKeywords(projectId) {
  let n = 0;
  for (const k of DEFAULT_CATEGORIES) {
    const old = LEGACY_KEYWORDS_V1[k.nameEn];
    if (!old) continue;
    const r = await db.query('UPDATE categories SET related_keywords = $1, updated_at = now() WHERE project_id = $4 AND name_en = $2 AND related_keywords = $3 RETURNING id', [k.keywords, k.nameEn, old, projectId]);
    n += r.rowCount;
  }
  return n;
}

/**
 * Brings a project seeded with an OLDER default up to date, step by step (marker `defaults_version` in automation_settings): a category's keyword list / excluded list is replaced
 * ONLY when it still equals the older default exactly (anything the owner edited stays), and missing default excluded topics are added once per step.
 * A default topic the owner removes AFTER an upgrade is not brought back (the marker moves on).
 */
async function upgradeDefaults(projectId) {
  const m = (await db.query("SELECT value FROM automation_settings WHERE scope = 'project' AND project_id = $1 AND key = 'defaults_version'", [projectId])).rows[0];
  const current = m ? (m.value.version || 1) : 0;
  if (current >= 3) return { upgraded: false };
  const out = { upgraded: true, from: current, keywords: 0, topics: 0, excludedLists: 0 };
  if (current < 2) out.keywords += await upgradeDefaultKeywords(projectId);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of DEFAULT_CATEGORIES) {                                    // 2 -> 3
    const v2 = DEFAULTS_V2[k.nameEn]; if (!v2) continue;
    const r1 = await db.query('UPDATE categories SET related_keywords = $1, updated_at = now() WHERE project_id = $2 AND name_en = $3 AND related_keywords = $4 RETURNING id', [k.keywords, projectId, k.nameEn, v2.keywords]);
    const r2 = await db.query('UPDATE categories SET excluded_topics = $1, updated_at = now() WHERE project_id = $2 AND name_en = $3 AND excluded_topics = $4 RETURNING id', [k.excluded, projectId, k.nameEn, v2.excluded]);
    out.keywords += r1.rowCount; out.excludedLists += r2.rowCount; void same;
  }
  for (const [topic, reason] of DEFAULT_EXCLUDED) {
    const r = await db.query('INSERT INTO excluded_topics (project_id, topic, reason, is_default) SELECT $1,$2,$3,true WHERE NOT EXISTS (SELECT 1 FROM excluded_topics WHERE project_id = $1 AND lower(topic) = lower($2) AND category_id IS NULL)', [projectId, topic, reason]);
    out.topics += r.rowCount;
  }
  await db.query(`INSERT INTO automation_settings (scope, project_id, key, value) VALUES ('project', $1, 'defaults_version', $2)
    ON CONFLICT (scope, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [projectId, JSON.stringify({ version: 3 })]);
  return out;
}

module.exports = {
  CONTENT_TYPES, DEFAULT_PROJECT, DEFAULT_NICHE, DEFAULT_CATEGORIES, DEFAULT_EXCLUDED, fold, matchExcluded, redistribute,
  listProjects, getProject, createProject, updateProject, updateNiche, listCategories, createCategory, getCategory, updateCategory, setShares, archiveCategory, deleteCategory,
  listExcluded, addExcluded, setExcludedActive, removeExcluded, checkTopic, seedDefault, upgradeDefaults, upgradeDefaultKeywords, LEGACY_KEYWORDS_V1, DEFAULTS_V2,
};
