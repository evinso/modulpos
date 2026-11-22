const { htmlToText, wordCount } = require('./html');

/**
 * AdSense site readiness: the pure part (no network, no database). `parseHtml` reads what a page says about itself, `evaluate` turns what was COLLECTED about a site into
 * a list of checks with one of five results (passed / missing / warning / manual / na).
 *
 * What this can and cannot say:
 *  - it only reads PUBLIC pages (the home page, a few pages, robots.txt, ads.txt, the sitemap, WordPress's public REST list); nothing is guessed about what it could not read
 *  - "required" marks what AdSense's own rules need (privacy policy with the cookie / advertising disclosure, a site that can be crawled and indexed, a secure address, the code or
 *    ads.txt once the account exists); everything else is a recommendation that is widely expected but that Google does not list as a rule, and the text says so
 *  - Google's decision, the AdSense account status, the originality and value of the content, and how the ads look are NEVER decided here: they are "manual" items
 *  - a clean result is not an approval and is never presented as one
 */
const STATUSES = ['passed', 'missing', 'warning', 'manual', 'na'];
const GROUPS = { pages: 'Gerekli sayfalar', tech: 'Teknik durum', content: 'İçerik', ads: 'Reklam ve onay', manual: 'Elle kontrol' };

const PAGE_PATTERNS = {
  about: /\babout(?:[ -]us)?\b|hakk[ıi]m[ıi]zda|\bwho we are\b|\bour story\b/i,
  contact: /\bcontact\b|\bget in touch\b|ileti[sş]im/i,
  privacy: /\bprivacy\b|gizlilik/i,
  editorial: /\beditorial\b|content[ -]policy|how we (?:work|test|review|write)|our (?:standards|process|methodology)|\bethics\b|fact[ -]?check|corrections?[ -]policy/i,
};

const CMP_MARKERS = [
  ['Google Funding Choices', /fundingchoicesmessages\.google\.com|googlefc/i], ['Complianz', /complianz/i], ['CookieYes / Cookie Law Info', /cookieyes|cookie-law-info|cli_cookie/i], ['Cookiebot', /cookiebot/i],
  ['OneTrust', /onetrust|optanon/i], ['Quantcast Choice', /quantcast\.mgr|quantserve|qc-cmp/i], ['Didomi', /didomi/i], ['iubenda', /iubenda/i], ['Termly', /termly/i], ['Borlabs Cookie', /borlabs/i],
  ['Cookie Notice', /cookie-notice|cookie_notice/i], ['CookieHub', /cookiehub/i], ['Usercentrics', /usercentrics/i],
];

const attrOf = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag || ''); return m ? (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]) : null; };
const sameHost = (a, b) => String(a).replace(/^www\./i, '').toLowerCase() === String(b).replace(/^www\./i, '').toLowerCase();
const clip = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const normTitle = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9ğüşöçıİ ]+/gi, ' ').replace(/\s+/g, ' ').trim();

/** What an HTML page says about itself. `base` is the address it was read from. */
function parseHtml(html, base) {
  const h = String(html || ''); let host = ''; try { host = new URL(base).hostname; } catch { /* keep empty */ }
  const metas = h.match(/<meta\b[^>]*>/gi) || []; const linksTags = h.match(/<link\b[^>]*>/gi) || [];
  const meta = (name) => { const t = metas.find((m) => String(attrOf(m, 'name') || '').toLowerCase() === name); return t ? attrOf(t, 'content') : null; };
  const canonicalTag = linksTags.find((l) => /\bcanonical\b/i.test(attrOf(l, 'rel') || ''));
  const ranges = []; const rx = /<(nav|header|footer)\b[\s\S]*?<\/\1>/gi; let b;
  while ((b = rx.exec(h))) ranges.push({ zone: b[1].toLowerCase(), from: b.index, to: b.index + b[0].length });
  const zoneAt = (i) => { const hit = ['footer', 'nav', 'header'].find((z) => ranges.some((r) => r.zone === z && i >= r.from && i < r.to)); return hit || 'body'; };
  const links = []; const ax = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let a;
  while ((a = ax.exec(h))) {
    const href = attrOf(a[1], 'href'); if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href.trim())) continue;
    let abs; try { abs = new URL(href.trim(), base); } catch { continue; }
    if (!/^https?:$/.test(abs.protocol)) continue;
    abs.hash = '';
    links.push({ href: abs.toString(), text: clip(a[2].replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&'), 80), zone: zoneAt(a.index), internal: sameHost(abs.hostname, host) });
  }
  const clientIds = new Set(); const cm = /(?:client=|data-ad-client=["']?)ca-pub-(\d{10,20})/gi; let c;
  while ((c = cm.exec(h))) clientIds.add(c[1]);
  const acct = meta('google-adsense-account'); if (acct && /^ca-pub-\d+$/i.test(acct.trim())) clientIds.add(acct.trim().slice(7));
  const mixed = (h.match(/<(?:img|script|iframe|source|video|audio)\b[^>]*\bsrc=["']http:\/\/[^"']+/gi) || []).length + linksTags.filter((l) => /stylesheet/i.test(attrOf(l, 'rel') || '') && /^http:\/\//i.test(attrOf(l, 'href') || '')).length;
  const lang = /<html\b[^>]*\blang=["']?([A-Za-z-]+)/i.exec(h);
  return {
    lang: lang ? lang[1] : null, title: clip((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h) || [])[1] || '', 140), viewport: metas.some((m) => String(attrOf(m, 'name') || '').toLowerCase() === 'viewport'),
    canonical: canonicalTag ? attrOf(canonicalTag, 'href') : null, robotsMeta: meta('robots'), generator: meta('generator'), links, navCount: (h.match(/<nav\b/gi) || []).length,
    adsenseClients: [...clientIds], adUnits: (h.match(/<ins\b[^>]*\badsbygoogle\b/gi) || []).length, autoAds: /enable_page_level_ads|data-ad-frequency-hint|google_ad_client/i.test(h),
    cmp: CMP_MARKERS.filter(([, re]) => re.test(h)).map(([n]) => n), mixedContent: mixed, bytes: h.length,
  };
}

/** robots.txt: is the whole site (or Google's crawlers) shut out? @returns { exists, blocksAll, blocksAdsCrawler, sitemaps } */
function parseRobots(text) {
  if (text === null || text === undefined) return { exists: false, blocksAll: false, blocksAdsCrawler: false, sitemaps: [] };
  const groups = []; let cur = null; const sitemaps = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line); if (!m) continue;
    const k = m[1].toLowerCase(); const v = m[2].trim();
    if (k === 'sitemap') { sitemaps.push(v); continue; }
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); continue; }
    if (cur && (k === 'disallow' || k === 'allow')) cur.rules.push([k, v]);
  }
  const shut = (g) => g.rules.some(([k, v]) => k === 'disallow' && v === '/') && !g.rules.some(([k, v]) => k === 'allow' && (v === '/' || v === ''));
  const forAgent = (names) => groups.filter((g) => g.agents.some((a) => names.includes(a)));
  const any = forAgent(['googlebot']).length ? forAgent(['googlebot']) : forAgent(['*']);
  const ads = forAgent(['mediapartners-google']);
  return { exists: true, blocksAll: any.some(shut), blocksAdsCrawler: ads.some(shut) || (!ads.length && forAgent(['*']).some(shut)), sitemaps };
}

/** the line AdSense wants in ads.txt for a publisher (case and spaces do not matter) */
function adsTxtHas(text, pubId) {
  const strip = (v) => String(v || '').trim().toLowerCase().replace(/^ca-/, '').replace(/^pub-/, '');
  const id = strip(pubId);
  return !!id && String(text || '').split(/\r?\n/).some((l) => { const p = l.replace(/#.*$/, '').split(',').map((x) => x.trim().toLowerCase()); return p[0] === 'google.com' && strip(p[1]) === id && p[2] === 'direct'; });
}

/** the first internal link of a page that looks like the page of this kind (by its text or its address); null when there is none */
const pickLink = (links, kind) => links.find((l) => l.internal && (PAGE_PATTERNS[kind].test(l.text) || PAGE_PATTERNS[kind].test(new URL(l.href).pathname))) || null;

const isDefaultTagline = (d) => /just another wordpress site|başka bir wordpress sitesi|baska bir wordpress sitesi/i.test(String(d || ''));

/**
 * @param snap  what the collector read (see services/adsenseAudit.js `collect`)
 * @param cfg   { language: 'en-US', pubId: '1234567890123456' | null }
 * @returns { reachable, items, summary, verdict, verdictText, facts }
 */
function evaluate(snap, cfg = {}) {
  const items = []; const pub = cfg.pubId ? String(cfg.pubId).replace(/^(ca-)?pub-/i, '') : null;
  const add = (key, group, label, status, o = {}) => items.push({ key, group, label, status, required: !!o.required, detail: o.detail || '', fix: o.fix || '', evidence: o.evidence || null });
  const home = snap.home;

  if (!home || home.error || !home.ok) {
    const why = !home ? 'Adres okunamadı' : (home.error || `Ana sayfa HTTP ${home.status} döndürdü`);
    add('reachable', 'tech', 'Site açılıyor mu', 'missing', { required: true, detail: `${snap.baseUrl} okunamadı: ${why}. Bu yüzden diğer kontroller yapılamadı (hiçbiri tahmin edilmedi).`, fix: 'Alan adının WordPress sitesine bağlı olduğundan, sitenin herkese açık olduğundan ve bakım/“yakında” ya da bot engeli (güvenlik eklentisi, Cloudflare) açık değilse kapalı olduğundan emin olun.', evidence: { error: home && home.error, status: home && home.status } });
    return finish(items, { reachable: false, facts: { url: snap.baseUrl } });
  }
  const pg = parseHtml(home.html, home.finalUrl || snap.baseUrl); const post = snap.postPage && snap.postPage.ok ? parseHtml(snap.postPage.html, snap.postPage.finalUrl) : null;
  const https = /^https:/i.test(home.finalUrl || snap.baseUrl);
  const rest = snap.rest || {}; const pages = rest.pages || []; const posts = rest.posts || [];
  const restOk = !!rest.ok;

  // ── technical ───────────────────────────────────────────────────────────────────────────────────────────────────
  add('reachable', 'tech', 'Site açılıyor mu', 'passed', { required: true, detail: `Ana sayfa okundu (HTTP ${home.status}, ${home.ms} ms${home.finalUrl && home.finalUrl.replace(/\/+$/, '') !== snap.baseUrl.replace(/\/+$/, '') ? `, ${home.finalUrl} adresine yönlendi` : ''}).` });
  const redirects = snap.httpRedirect;
  add('ssl', 'tech', 'SSL (https)', !https ? 'missing' : (redirects === false || pg.mixedContent > 0 ? 'warning' : 'passed'), { required: true,
    detail: !https ? 'Site https ile açılmıyor: adres http:// ile başlıyor.' : (redirects === false ? 'https çalışıyor ama http:// adresi https’e yönlenmiyor (iki ayrı sürüm kalıyor).' : pg.mixedContent > 0 ? `https çalışıyor ama ana sayfada ${pg.mixedContent} kaynak hâlâ http:// ile yükleniyor (karışık içerik).` : `https çalışıyor${redirects === true ? ' ve http:// adresi https’e yönleniyor' : ''}.`),
    fix: !https ? 'Hosting panelinden ücretsiz SSL (Let’s Encrypt) etkinleştirin, WordPress Ayarlar → Genel’de adresleri https yapın.' : (redirects === false ? 'http’den https’e kalıcı (301) yönlendirme ekleyin (hosting paneli ya da bir yönlendirme eklentisi).' : pg.mixedContent > 0 ? 'Resim/komut adreslerini https yapın (Better Search Replace gibi bir eklentiyle http:// → https://).' : ''), evidence: { redirects, mixed: pg.mixedContent } });
  const robots = snap.robots ? parseRobots(snap.robots.status === 200 ? snap.robots.body : null) : null;
  const noindex = /noindex/i.test(pg.robotsMeta || '') || /noindex/i.test(String((home.headers || {})['x-robots-tag'] || ''));
  add('indexable', 'tech', 'Arama motorlarına açık mı (noindex / robots engeli)', noindex || (robots && robots.blocksAll) ? 'missing' : 'passed', { required: true,
    detail: noindex ? 'Ana sayfa “noindex” diyor: Google siteyi dizine eklemez ve AdSense sayfaları tarayamaz.' : robots && robots.blocksAll ? 'robots.txt tüm siteyi (Disallow: /) engelliyor.' : 'Ana sayfada noindex yok ve robots.txt siteyi tümüyle engellemiyor.',
    fix: noindex || (robots && robots.blocksAll) ? 'WordPress → Ayarlar → Okuma → “Arama motorlarının siteyi dizine eklemesini engelle” kutusunun işaretini kaldırın; SEO eklentisinde noindex ayarına ve robots.txt’ye bakın.' : '', evidence: { robotsMeta: pg.robotsMeta } });
  add('robots', 'tech', 'robots.txt', !snap.robots ? 'manual' : snap.robots.status !== 200 ? 'warning' : (robots.blocksAdsCrawler && !robots.blocksAll ? 'warning' : 'passed'),
    { detail: !snap.robots ? 'robots.txt okunamadı.' : snap.robots.status !== 200 ? `robots.txt bulunamadı (HTTP ${snap.robots.status}). Zorunlu değil: dosya yoksa her şeye izin verilmiş sayılır, ama WordPress normalde bir tane üretir.` : robots.blocksAdsCrawler && !robots.blocksAll ? 'robots.txt AdSense tarayıcısını (Mediapartners-Google) engelliyor: reklamlar için sayfalar taranamaz.' : 'robots.txt var ve reklam tarayıcısını engellemiyor.',
      fix: snap.robots && snap.robots.status !== 200 ? 'Yönetim → SEO eklentisi ya da /robots.txt dosyası oluşturun (WordPress varsayılanı yeterlidir).' : robots && robots.blocksAdsCrawler ? 'robots.txt’deki Mediapartners-Google engelini kaldırın.' : '' });
  const sm = snap.sitemap || {};
  add('sitemap', 'tech', 'Site haritası (sitemap)', sm.found ? 'passed' : 'warning', { detail: sm.found ? `Site haritası bulundu: ${sm.url}${sm.urlCount ? ` (${sm.urlCount} adres)` : ''}.` : 'Site haritası bulunamadı (robots.txt’de, /wp-sitemap.xml, /sitemap_index.xml ve /sitemap.xml denendi). Zorunlu değil ama Google’ın sayfaları bulmasını kolaylaştırır.', fix: sm.found ? '' : 'WordPress 5.5+ kendi haritasını /wp-sitemap.xml adresinde sunar; bir SEO eklentisi (Rank Math, Yoast) kullanıyorsanız onun site haritasını açın ve Search Console’a gönderin.' });
  // WordPress core writes the canonical link only on single posts and pages (a SEO plugin adds it to the home page too): look at a post when the home page has none
  const canon = pg.canonical || (post && post.canonical) || null; const canonFrom = pg.canonical ? 'ana sayfada' : 'yazı sayfasında';
  let canonOk = null; if (canon) { try { canonOk = sameHost(new URL(canon, home.finalUrl).hostname, new URL(home.finalUrl).hostname); } catch { canonOk = false; } }
  add('canonical', 'tech', 'Canonical adres', !canon ? 'warning' : canonOk ? 'passed' : 'warning', { detail: !canon ? `Okunan sayfalarda canonical (rel="canonical") bağlantısı yok${post ? '' : ' (bir yazı sayfası okunamadı; WordPress çekirdeği bunu yalnızca yazı ve sayfalara ekler)'}.` : canonOk ? `Canonical ${canonFrom} var: ${canon}` : `Canonical başka bir alan adını gösteriyor: ${canon}`, fix: !canon ? 'WordPress çekirdeği yazı ve sayfalara kendisi ekler; yoksa tema ya da bir eklenti engelliyor olabilir. Bir SEO eklentisi (Rank Math, Yoast) tüm sayfalara ekler.' : canonOk ? '' : 'SEO eklentisinde canonical adresi sitenin kendi adresi olacak şekilde düzeltin.' });
  add('mobile', 'tech', 'Mobil uyumluluk (viewport)', pg.viewport ? 'passed' : 'missing', { detail: pg.viewport ? 'Sayfada mobil görünüm etiketi (viewport) var. Gerçek görünüm bu denetimde ÖLÇÜLMEDİ: telefonda açıp bakın.' : 'Sayfada mobil görünüm etiketi (meta viewport) yok: site telefonlarda masaüstü gibi küçük görünür.', fix: pg.viewport ? '' : 'Duyarlı (responsive) bir tema kullanın; temanın header’ında <meta name="viewport" content="width=device-width, initial-scale=1"> olmalı.' });
  add('language', 'tech', 'Sayfa dili', !pg.lang ? 'warning' : (String(cfg.language || 'en').slice(0, 2).toLowerCase() === pg.lang.slice(0, 2).toLowerCase() ? 'passed' : 'warning'), { detail: !pg.lang ? 'Sayfada dil (html lang) belirtilmemiş.' : `Sayfa dili: ${pg.lang}${String(cfg.language || 'en').slice(0, 2).toLowerCase() === pg.lang.slice(0, 2).toLowerCase() ? '' : ` (projenin dili ${cfg.language || 'en-US'})`}.`, fix: 'WordPress → Ayarlar → Genel → Site Dili alanını İngilizce (ABD) yapın.' });
  add('speed', 'tech', 'Açılış hızı (kaba ölçüm)', home.ms <= 2500 ? 'passed' : 'warning', { detail: `Ana sayfa bu sunucudan (Singapur) ${home.ms} ms’de, ${Math.round((pg.bytes || 0) / 1024)} KB olarak okundu. Tek bir ölçümdür; gerçek hız için PageSpeed Insights’a bakın.`, fix: home.ms > 2500 ? 'Önbellek eklentisi, görsel sıkıştırma ve daha hafif bir tema deneyin.' : '', evidence: { ms: home.ms } });
  const probes = snap.linkProbes || [];
  const broken = probes.filter((p) => p.status === 'broken'); const unknown = probes.filter((p) => p.status === 'error');
  add('broken_links', 'tech', 'Kırık bağlantılar (site içi)', !probes.length ? 'manual' : broken.length ? 'warning' : 'passed', { detail: !probes.length ? 'Ana sayfadaki site içi bağlantı bulunamadı ya da denenmedi.' : `${probes.length} site içi bağlantı denendi: ${broken.length} kırık${unknown.length ? `, ${unknown.length} tanesi anlaşılamadı (engel/yavaşlık; kırık sayılmadı)` : ''}.${broken.length ? ` Kırıklar: ${broken.slice(0, 5).map((b) => b.url).join(', ')}` : ''}`, fix: broken.length ? 'Menüdeki ya da içerikteki kırık bağlantıları düzeltin ya da kaldırın.' : '', evidence: { broken: broken.slice(0, 20).map((b) => ({ url: b.url, http: b.http })) } });

  // ── required pages ──────────────────────────────────────────────────────────────────────────────────────────────
  const find = (kind) => {
    const re = PAGE_PATTERNS[kind];
    const viaRest = pages.find((p) => re.test(p.slug || '') || re.test(p.title || ''));
    if (viaRest) return { url: viaRest.link, words: viaRest.words, text: viaRest.text, source: 'WordPress sayfa listesi' };
    const viaLink = pickLink(pg.links, kind);
    const fetched = viaLink && (snap.fetchedPages || {})[kind];
    if (viaLink) return { url: viaLink.href, words: fetched ? fetched.words : null, text: fetched ? fetched.text : '', source: `bağlantı (${viaLink.zone === 'body' ? 'sayfa içi' : viaLink.zone})`, zone: viaLink.zone };
    return null;
  };
  const draftHint = (kind) => (kind === 'privacy' && restOk ? ' WordPress kurulumda hazır bir “Privacy Policy” taslağı oluşturur: Ayarlar → Gizlilik’ten düzenleyip yayımlayabilirsiniz.' : '');
  for (const [kind, label, required, fix] of [
    ['about', 'Hakkımızda (About Us) sayfası', false, 'Siteyi kimin, neden yazdığını anlatan gerçek bir “About Us” sayfası ekleyin ve menüye/alt bilgiye bağlayın.'],
    ['contact', 'İletişim (Contact) sayfası', false, 'Okurların ulaşabileceği bir e-posta ya da form içeren “Contact” sayfası ekleyin.'],
    ['privacy', 'Gizlilik Politikası (Privacy Policy) sayfası', true, 'Çerezleri ve üçüncü taraf (Google) reklam çerezlerini anlatan bir gizlilik politikası yayımlayın (Ayarlar → Gizlilik).'],
  ]) {
    const f = find(kind);
    const thin = f && f.words !== null && f.words < (kind === 'privacy' ? 150 : 60);
    add(kind, 'pages', label, !f ? 'missing' : thin ? 'warning' : 'passed', { required,
      detail: !f ? `Herkese açık bir ${label.split(' (')[0]} sayfası bulunamadı (sayfa listesinde ve ana sayfa bağlantılarında arandı).${draftHint(kind)}${required ? '' : ' Google resmî bir koşul olarak yazmıyor ama güven için yaygın olarak beklenir.'}` : `Bulundu: ${f.url} (${f.source}${f.words !== null ? `, ${f.words} kelime` : ''}).${thin ? ' Çok kısa: yer tutucu gibi görünüyor.' : ''}`,
      fix: !f || thin ? fix : '', evidence: f ? { url: f.url, words: f.words } : null });
  }
  const priv = find('privacy');
  const ptxt = priv ? priv.text || '' : '';
  const hasCookie = /cookie|çerez/i.test(ptxt); const hasAds = /google|third[- ]party|üçüncü taraf|advertis|reklam|adsense|doubleclick|ad network|vendor/i.test(ptxt);
  add('cookie_disclosure', 'pages', 'Çerez ve reklam açıklaması (gizlilik politikasında)', !priv ? 'missing' : !ptxt ? 'manual' : hasCookie && hasAds ? 'passed' : 'warning', { required: true,
    detail: !priv ? 'Gizlilik politikası olmadığı için çerez/reklam açıklaması da yok.' : !ptxt ? 'Gizlilik sayfasının metni okunamadı: elle bakın.' : hasCookie && hasAds ? 'Gizlilik metni çerezlerden ve reklam/üçüncü taraf kullanımından söz ediyor. Metnin Google’ın istediği açıklamayı tam karşılayıp karşılamadığını elle doğrulayın.' : `Gizlilik metni ${!hasCookie ? 'çerezlerden' : 'Google/üçüncü taraf reklam çerezlerinden'} söz etmiyor.`,
    fix: 'Politikaya: sitenin çerez kullandığını, Google dahil üçüncü taraf satıcıların reklam göstermek için çerez kullandığını ve kullanıcının nasıl vazgeçebileceğini (Google Reklam Ayarları / aboutads.info) yazın.' });
  const ed = find('editorial');
  add('editorial', 'pages', 'Editoryal politika', ed ? 'passed' : 'warning', { detail: ed ? `Bulundu: ${ed.url}` : 'Editoryal politika / içerik standartları sayfası bulunamadı. Zorunlu değil; içeriğin nasıl hazırlandığını (kaynak, doğrulama, düzeltme) anlatması güven verir.', fix: ed ? '' : 'Haberlerin nasıl araştırıldığını, hataların nasıl düzeltildiğini ve yapay zekâ kullanılıyorsa nasıl denetlendiğini anlatan kısa bir sayfa ekleyin.' });
  const footerOrNav = (kind) => pg.links.some((l) => l.internal && ['footer', 'nav', 'header'].includes(l.zone) && (PAGE_PATTERNS[kind].test(l.text) || PAGE_PATTERNS[kind].test(new URL(l.href).pathname)));
  const navLinks = pg.links.filter((l) => l.internal && ['nav', 'header'].includes(l.zone));
  const uniqNav = new Set(navLinks.map((l) => l.href)).size;
  const linked = ['privacy', 'about', 'contact'].filter(footerOrNav); const unlinked = ['privacy', 'about', 'contact'].filter((k) => !footerOrNav(k) && find(k));
  add('navigation', 'pages', 'Gezinme (menü ve alt bilgi)', uniqNav >= 3 && !unlinked.length && linked.length ? 'passed' : 'warning', {
    detail: `Menü/başlıkta ${uniqNav} site içi bağlantı bulundu; menü ya da alt bilgiden ulaşılan zorunlu sayfalar: ${linked.length ? linked.join(', ') : 'yok'}.${unlinked.length ? ` Var olup menüde/alt bilgide bağlanmayanlar: ${unlinked.join(', ')}.` : ''}${uniqNav < 3 ? ' Menü çok kısa ya da bulunamadı.' : ''}`,
    fix: 'Ana menüye kategorileri, alt bilgiye Hakkımızda / İletişim / Gizlilik Politikası bağlantılarını koyun (Görünüm → Menüler).' });

  // ── content ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const total = rest.postsTotal;
  const thinPosts = posts.filter((p) => p.words < 300);
  if (!restOk) {
    add('content_volume', 'content', 'Yayımlanmış yazı sayısı ve uzunluğu', 'manual', { detail: 'WordPress’in herkese açık REST listesi okunamadı (kapalı ya da engelli): yazı sayısı ve uzunlukları denetlenemedi.', fix: 'Güvenlik eklentisi REST API’yi anonim isteklere kapatmış olabilir; yazı sayısına yönetim panelinden bakın.' });
  } else {
    const sampleAvg = posts.length ? Math.round(posts.reduce((a, p) => a + p.words, 0) / posts.length) : 0;
    const realPosts = posts.filter((p) => !/^hello world!?$/i.test((p.title || '').trim()));
    add('content_volume', 'content', 'Yayımlanmış yazı sayısı ve uzunluğu', !total || !realPosts.length ? 'missing' : (total < 10 || thinPosts.length > posts.length / 3 ? 'warning' : 'passed'), {
      detail: !total || !realPosts.length ? 'Henüz özgün yazı yok (hiç yazı ya da yalnızca WordPress’in örnek yazısı).' : `${total} yayımlanmış yazı; son ${posts.length} yazının ortalaması ${sampleAvg} kelime, ${thinPosts.length} tanesi 300 kelimeden kısa. Google bir yazı sayısı ya da uzunluk eşiği VERMİYOR; bunlar bizim kaba yönlendirmemiz (başlarken en az ~10-15 özgün, değerli yazı).`,
      fix: 'Başvurudan önce konuya özgü, kaynaklı ve okura gerçekten yardımcı olan yazılarla siteyi doldurun; çok kısa ya da ince yazıları genişletin.', evidence: { total, avgWords: sampleAvg, thin: thinPosts.length } });
    const sampleDefault = posts.some((p) => /^hello world!?$/i.test((p.title || '').trim())) || pages.some((p) => p.slug === 'sample-page');
    const tag = isDefaultTagline(rest.description);
    add('default_content', 'content', 'WordPress örnek içeriği ve varsayılan slogan', sampleDefault || tag ? 'warning' : 'passed', { detail: sampleDefault || tag ? `Kurulumdan kalan varsayılanlar var:${posts.some((p) => /^hello world/i.test(p.title)) ? ' “Hello world!” örnek yazısı;' : ''}${pages.some((p) => p.slug === 'sample-page') ? ' “Sample Page” örnek sayfası;' : ''}${tag ? ' “Just another WordPress site” sloganı;' : ''} Bunlar sitenin bitmemiş göründüğünü gösterir.` : 'Örnek yazı/sayfa ve varsayılan slogan görünmüyor.', fix: 'Örnek yazıyı ve sayfayı silin; Ayarlar → Genel’den sloganı kendi sitenize göre yazın ya da boş bırakın.' });
    const titles = new Map(); for (const x of [...posts, ...pages]) { const k = normTitle(x.title); if (k) titles.set(k, [...(titles.get(k) || []), x.link]); }
    const dups = [...titles.values()].filter((v) => v.length > 1);
    add('duplicates', 'content', 'Tekrarlayan sayfalar / başlıklar', dups.length ? 'warning' : 'passed', { detail: dups.length ? `Aynı başlığı taşıyan ${dups.length} yazı/sayfa grubu var (ör. ${dups[0].slice(0, 2).join(' ve ')}).` : `Son ${posts.length} yazı ve ${pages.length} sayfa arasında aynı başlık yok.`, fix: dups.length ? 'Aynı konuyu iki kez yayımlamayın; birini genişletip diğerini kaldırın ya da yönlendirin.' : '' });
    const authors = posts.map((p) => p.author).filter(Boolean); const named = authors.filter((a) => a.name && !/^(admin|administrator|wordpress|webmaster|editor)$/i.test(a.name.trim()));
    add('authors', 'content', 'Yazar bilgisi', !posts.length ? 'na' : !authors.length ? 'manual' : named.length < authors.length ? 'warning' : (authors.some((a) => a.bio) ? 'passed' : 'warning'), {
      detail: !posts.length ? 'Henüz yazı yok.' : !authors.length ? 'Yazı yazarları okunamadı (REST yazar bilgisini vermiyor).' : named.length < authors.length ? 'Bazı yazılar “admin” gibi genel bir kullanıcı adıyla yayımlanmış: okur yazarı göremez.' : authors.some((a) => a.bio) ? `Yazarlar görünüyor (${[...new Set(named.map((a) => a.name))].slice(0, 3).join(', ')}) ve en az birinin kısa tanıtımı var.` : 'Yazar adları var ama hiçbirinin biyografisi/tanıtımı yok. Zorunlu değil; güveni artırır.',
      fix: 'Kullanıcılar → Profil’de görünen adı gerçek bir ad/takma ad yapın, “Biyografik bilgi” alanını doldurun, temanın yazı sonunda yazar kutusunu göstermesini sağlayın.' });
  }

  // ── ads and approval ────────────────────────────────────────────────────────────────────────────────────────────
  const clients = new Set([...pg.adsenseClients, ...(post ? post.adsenseClients : [])]);
  const adsOnPage = Math.max(pg.adUnits, post ? post.adUnits : 0);
  if (pub) {
    add('adsense_code', 'ads', 'AdSense kodu / site doğrulaması', clients.has(pub) ? 'passed' : 'missing', { required: true, detail: clients.has(pub) ? `Sayfada pub-${pub} yayıncı numaralı AdSense kodu/meta etiketi bulundu.` : `Ana sayfada pub-${pub} numaralı AdSense kodu ya da google-adsense-account etiketi bulunamadı${clients.size ? ` (başka bir numara bulundu: ${[...clients].map((c) => `pub-${c}`).join(', ')})` : ''}.`, fix: 'AdSense → Siteler’deki kod parçasını temanın <head> bölümüne ekleyin (Site Kit ya da bir “header kodu” eklentisiyle).' });
    const ads = snap.adsTxt;
    add('ads_txt', 'ads', 'ads.txt', ads && ads.status === 200 && adsTxtHas(ads.body, pub) ? 'passed' : ads && ads.status === 200 ? 'warning' : 'missing', { detail: ads && ads.status === 200 ? (adsTxtHas(ads.body, pub) ? `ads.txt Google satırını içeriyor (pub-${pub}).` : `ads.txt var ama pub-${pub} için “google.com, pub-${pub}, DIRECT, f08c47fec0942fa0” satırı yok.`) : 'ads.txt bulunamadı.', fix: `Sitenin kök dizinine /ads.txt ekleyin ve içine şunu yazın: google.com, pub-${pub}, DIRECT, f08c47fec0942fa0` });
  } else {
    add('adsense_code', 'ads', 'AdSense kodu / site doğrulaması', clients.size ? 'passed' : 'na', { detail: clients.size ? `Sayfada AdSense kodu bulundu (${[...clients].map((c) => `pub-${c}`).join(', ')}). Denetimin doğrulama yapabilmesi için numarayı site ayarlarına yazın.` : 'AdSense yayıncı numarası yazılmadığı için kod doğrulaması yapılmadı (başvurudan sonra siteye yayıncı numarasını yazın).' });
    const ads = snap.adsTxt;
    add('ads_txt', 'ads', 'ads.txt', ads && ads.status === 200 && /google\.com\s*,/i.test(ads.body) ? 'passed' : 'na', { detail: ads && ads.status === 200 ? 'ads.txt var.' : 'ads.txt yok: AdSense hesabı açılınca Google’ın verdiği satırla eklenir (şimdilik gerekmez).' });
  }
  add('ad_density', 'ads', 'Sayfadaki reklam sayısı', !adsOnPage && !(pg.autoAds || (post && post.autoAds)) ? 'na' : adsOnPage > 3 ? 'warning' : 'passed', { detail: !adsOnPage && !pg.autoAds ? 'Sayfalarda henüz reklam alanı yok.' : adsOnPage > 3 ? `Bir sayfada ${adsOnPage} reklam alanı var: içerikten çok reklam görünmemeli.` : `Okunan sayfalarda en çok ${adsOnPage} reklam alanı var.`, fix: 'Reklamları içeriğin önüne geçmeyecek ve okumayı bozmayacak kadar az tutun.' });
  const cmp = [...new Set([...pg.cmp, ...(post ? post.cmp : [])])];
  add('cmp', 'ads', 'Çerez onayı (CMP) — AB, Birleşik Krallık, İsviçre', cmp.length ? 'manual' : 'warning', { detail: cmp.length ? `Bir onay aracı izi bulundu: ${cmp.join(', ')}. Google’ın sertifikalı CMP listesinde olduğunu ve AdSense için doğru yapılandırıldığını elle doğrulayın.` : 'Çerez onay aracı (CMP) izi bulunamadı. Avrupa Ekonomik Alanı, Birleşik Krallık ya da İsviçre’den ziyaretçi alacaksanız reklam göstermek için Google sertifikalı bir onay aracı gerekir.', fix: 'AdSense → Gizlilik ve mesajlar bölümündeki ücretsiz Google onay mesajını (Funding Choices) ya da sertifikalı bir CMP’yi (ör. Complianz, CookieYes) kurun.' });

  // ── things only a person can judge ──────────────────────────────────────────────────────────────────────────────
  add('manual_status', 'manual', 'AdSense onay durumu', 'manual', { detail: 'Onay durumu yalnızca AdSense hesabınızda görünür. Bu platform AdSense’e bağlı değildir ve durumu tahmin etmez.', fix: 'adsense.google.com → Siteler bölümünden bakın.' });
  add('manual_content', 'manual', 'İçeriğin özgünlüğü ve değeri', 'manual', { detail: 'Yazıların özgün, doğru ve okura gerçekten yararlı olup olmadığını Google değerlendirir; otomatik bir denetim bunu söyleyemez. (Makale bazında risk işaretleri “AdSense risk kontrolü”ndedir; o da resmî bir Google puanı değildir.)', fix: 'Yayımladıklarınızı bir okur gözüyle okuyun: kopya, aşırı yapay zekâ kalıbı ve ince içerik var mı?' });
  add('manual_ads', 'manual', 'Reklam yerleşimi ve görünümü', 'manual', { detail: 'Reklamların içerik gibi gösterilmemesi, tıklamaya özendirmemesi ve gezinmeyi engellememesi gerekir; bunu ancak sayfaya bakarak anlayabilirsiniz.', fix: 'Telefonda ve masaüstünde birkaç sayfayı açıp reklam yerleşimini inceleyin.' });
  return finish(items, { reachable: true, facts: { url: home.finalUrl || snap.baseUrl, https, ms: home.ms, postsTotal: total === undefined ? null : total, pages: pages.length, generator: pg.generator, title: pg.title, restOk } });
}

function finish(items, { reachable, facts }) {
  const summary = { passed: 0, missing: 0, warning: 0, manual: 0, na: 0 }; for (const i of items) summary[i.status]++;
  const requiredMissing = items.filter((i) => i.required && i.status === 'missing').map((i) => i.key);
  const requiredOpen = items.filter((i) => i.required && ['warning', 'manual'].includes(i.status)).map((i) => i.key);
  let verdict; let verdictText;
  if (!reachable) { verdict = 'unreachable'; verdictText = 'Site okunamadı: kontroller yapılamadı.'; }
  else if (requiredMissing.length) { verdict = 'not_ready'; verdictText = `AdSense başvurusu için eksikler var (${requiredMissing.length} zorunlu madde).`; }
  else if (summary.missing || summary.warning || requiredOpen.length) { verdict = 'almost'; verdictText = 'Zorunlu maddelerde büyük bir eksik görünmüyor; uyarıları ve eksik önerileri gözden geçirin.'; }
  else { verdict = 'checks_clean'; verdictText = 'Otomatik kontroller temiz. Elle kontrol maddeleri sizde; bu bir onay değildir ve AdSense onayını garanti etmez.'; }
  return { reachable, items, summary: { ...summary, requiredMissing, requiredOpen }, verdict, verdictText, facts };
}

module.exports = { STATUSES, GROUPS, PAGE_PATTERNS, CMP_MARKERS, parseHtml, parseRobots, adsTxtHas, pickLink, evaluate, wordCount, htmlToText };
