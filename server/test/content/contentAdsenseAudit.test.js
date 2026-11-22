process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const fakeSite = require('./fakeSite');
const P = require('../../src/content/services/projects');
const SI = require('../../src/content/services/sites');
const AU = require('../../src/content/services/adsenseAudit');
const SC = require('../../src/content/services/scheduler');
const NT = require('../../src/content/services/notifications');
const LIB = require('../../src/content/lib/siteAudit');

/**
 * Phase 7a, AdSense site audit: what is read from a (fake, but real-HTTP) WordPress site, which checks come out of it, what is NEVER decided (Google's answer, the account status),
 * and the safety around it (one audit at a time per address, a limit per hour, only public pages, only GET/HEAD).
 */
const opts = { skip: H.skip };
let site;
test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) { await H.clean(); process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1'; } });
test.afterEach(async () => { if (site) { await site.close(); site = null; } });
test.after(async () => { if (!H.skip) await H.close(); });

const setup = async () => (await P.seedDefault()).projectId;
const byKey = (a) => Object.fromEntries(a.items.map((i) => [i.key, i]));
const st = (a) => Object.fromEntries(a.items.map((i) => [i.key, i.status]));
/** the same site as if it were served over https (the fake server is plain http): used to reach the verdicts that need a secure address */
const asHttps = (snap) => { const s = JSON.parse(JSON.stringify(snap)); s.baseUrl = s.baseUrl.replace('http:', 'https:'); s.home.finalUrl = s.home.finalUrl.replace('http:', 'https:'); s.httpRedirect = true; return s; };

test('a brand new WordPress install: what is missing is named, the draft privacy page is explained, defaults are flagged, and nothing unknown is invented', opts, async () => {
  const pid = await setup(); site = await fakeSite.start(fakeSite.FRESH);
  const a = await AU.run({ projectId: pid, url: site.url });
  assert.deepEqual([a.status, a.verdict, a.reachable], ['done', 'not_ready', true]);
  const s = st(a); const k = byKey(a);
  assert.deepEqual([s.reachable, s.ssl, s.indexable, s.about, s.contact, s.privacy, s.cookie_disclosure, s.editorial, s.content_volume, s.default_content, s.authors],
    ['passed', 'missing', 'passed', 'missing', 'missing', 'missing', 'missing', 'warning', 'missing', 'warning', 'warning']);
  assert.match(k.privacy.detail, /Privacy Policy” taslağı oluşturur/, 'WordPress creates a DRAFT privacy page on install: say so'); assert.match(k.default_content.detail, /Hello world.*Sample Page.*Just another WordPress site/s);
  assert.deepEqual(a.summary.requiredMissing.sort(), ['cookie_disclosure', 'privacy', 'ssl']);
  assert.deepEqual([s.manual_status, s.manual_content, s.manual_ads], ['manual', 'manual', 'manual'], 'what only Google or a person can judge is never decided');
  assert.equal(k.manual_status.detail.includes('tahmin etmez'), true);
  assert.deepEqual([s.adsense_code, s.ads_txt, s.ad_density], ['na', 'na', 'na'], 'no AdSense account number: nothing to verify, said as "not applicable"');
  assert.equal(s.cmp, 'warning'); assert.ok(a.items.every((i) => ['passed', 'missing', 'warning', 'manual', 'na'].includes(i.status)) && a.items.every((i) => i.detail.length > 10));
  assert.deepEqual(Object.values(a.summary).slice(0, 5).reduce((x, y) => x + y, 0), a.items.length);
  assert.ok(site.hits.every((h) => /^(GET|HEAD) /.test(h)), 'only reads: no request that writes anything'); assert.ok(site.hits.length < 60, `${site.hits.length} requests`);
  assert.equal((await AU.get(a.id)).items.length, a.items.length, 'the audit and its items are stored');
});

test('a finished site: every page and signal is found; only the secure address is missing locally (the test server is http), and the https view reaches a clean result that says it is NOT an approval', opts, async () => {
  const pid = await setup(); site = await fakeSite.start({ ...fakeSite.READY, adsTxt: null });
  const a = await AU.run({ projectId: pid, url: site.url }); const s = st(a);
  assert.deepEqual([s.ssl, s.indexable, s.robots, s.sitemap, s.canonical, s.mobile, s.language, s.about, s.contact, s.privacy, s.cookie_disclosure, s.editorial, s.navigation, s.content_volume, s.default_content, s.duplicates, s.authors, s.broken_links, s.cmp],
    ['missing', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'manual']);
  assert.deepEqual(a.summary.requiredMissing, ['ssl'], 'the only thing in the way is that the TEST server is not https');
  assert.match(byKey(a).cmp.detail, /Complianz.*elle doğrulayın/s, 'a consent tool was DETECTED, not certified'); assert.match(byKey(a).content_volume.detail, /Google bir yazı sayısı ya da uzunluk eşiği VERMİYOR/);
  // the https view of the same snapshot
  const snap = await AU.collect(site.url); const clean = LIB.evaluate(asHttps(snap), { language: 'en-US', pubId: null });
  assert.deepEqual([clean.verdict, clean.summary.missing, clean.summary.warning, clean.summary.requiredMissing.length], ['checks_clean', 0, 0, 0], 'a consent tool is a MANUAL item (detected, not certified) and ads.txt is not applicable yet: no warning, nothing missing');
  assert.equal(clean.items.find((i) => i.key === 'ssl').status, 'passed');
  assert.match(clean.verdictText, /bu bir onay değildir ve AdSense onayını garanti etmez/, 'even the clean result says it is not an approval');
  const strip = (h) => h.replace(/<script[^>]*complianz[^>]*><\/script>/, ''); const noCmp = LIB.evaluate(asHttps({ ...snap, home: { ...snap.home, html: strip(snap.home.html) }, postPage: { ...snap.postPage, html: strip(snap.postPage.html) } }), { language: 'en-US', pubId: null });
  assert.deepEqual([noCmp.verdict, noCmp.items.find((i) => i.key === 'cmp').status], ['almost', 'warning'], 'no consent tool found is a warning, and a warning keeps the verdict from being "clean"');
});

test('the verdicts: unreachable site, blocked from search engines, no privacy policy, and the wording of a clean result', opts, async () => {
  const pid = await setup();
  const down = await AU.run({ projectId: pid, url: 'http://127.0.0.1:9' });
  assert.deepEqual([down.status, down.verdict, down.reachable, down.items.length, down.items[0].key, down.items[0].status], ['done', 'unreachable', false, 1, 'reachable', 'missing'], 'an unreachable site is a RESULT; no other check is invented');
  assert.match(down.items[0].detail, /diğer kontroller yapılamadı/);
  site = await fakeSite.start({ ...fakeSite.READY, noindex: true }); let a = await AU.run({ projectId: pid, url: site.url });
  assert.equal(st(a).indexable, 'missing'); assert.match(byKey(a).indexable.detail, /noindex/); assert.ok(a.summary.requiredMissing.includes('indexable')); await site.close();
  site = await fakeSite.start({ ...fakeSite.READY, robotsBlocksAll: true }); a = await AU.run({ projectId: pid, url: site.url }); assert.equal(st(a).indexable, 'missing'); assert.match(byKey(a).indexable.detail, /robots\.txt tüm siteyi/); await site.close();
  site = await fakeSite.start({ ...fakeSite.READY, robotsBlocksAds: true }); a = await AU.run({ projectId: pid, url: site.url }); assert.deepEqual([st(a).robots, st(a).indexable], ['warning', 'passed']); assert.match(byKey(a).robots.detail, /Mediapartners-Google/); await site.close();
  site = await fakeSite.start({ ...fakeSite.READY, homeStatus: 503 }); a = await AU.run({ projectId: pid, url: site.url }); assert.equal(a.verdict, 'unreachable'); assert.match(byKey(a).reachable.detail, /bakımda|503/);
  // an empty but reachable https site: the verdict names the missing required pages
  const base = { baseUrl: 'https://x.example', home: { ok: true, status: 200, ms: 300, html: '<html lang="en"><head><meta name="viewport" content="width=device-width"></head><body></body></html>', finalUrl: 'https://x.example/', headers: {} } };
  const v = LIB.evaluate({ ...base, httpRedirect: true }, { language: 'en-US' });
  assert.equal(v.verdict, 'not_ready'); assert.ok(v.summary.requiredMissing.includes('privacy')); assert.match(v.verdictText, /eksikler var/i);
});

test('AdSense account details: the code and ads.txt are checked ONLY when the publisher number is known, the wrong number is named, and ads that are too many are flagged', opts, async () => {
  const pid = await setup(); const PUB = '1234567890123456';
  site = await fakeSite.start({ ...fakeSite.READY, adsenseCode: '1111111111111111', adsTxt: 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n', ads: 5 });
  const s1 = await SI.create(pid, { name: 'Blog', apiUrl: site.url, username: 'u', password: 'abcd efgh ijkl mnop', adsensePubId: `ca-pub-${PUB}` });
  assert.equal(s1.adsensePubId, `pub-${PUB}`, 'ca- is dropped, the form is pub-…');
  await assert.rejects(SI.update(s1.id, { adsensePubId: 'abc' }), /pub-1234567890123456” biçiminde/); assert.equal((await SI.update(s1.id, { adsensePubId: null })).adsensePubId, null); await SI.update(s1.id, { adsensePubId: `pub-${PUB}` });
  const a = await AU.run({ siteId: s1.id }); const s = st(a);
  assert.deepEqual([s.adsense_code, s.ads_txt, s.ad_density], ['missing', 'passed', 'warning']); assert.match(byKey(a).adsense_code.detail, /pub-1234567890123456.*bulunamadı.*pub-1111111111111111/s); assert.ok(a.summary.requiredMissing.includes('adsense_code'));
  assert.match(byKey(a).ad_density.detail, /5 reklam alanı/);
  // the owner fixes the site (same address): the right code, but ads.txt names another publisher, and fewer ads
  Object.assign(site.config, { adsenseCode: PUB, adsTxt: 'google.com, pub-9999999999999999, DIRECT, f08c47fec0942fa0\n', ads: 2 });
  const b = await AU.run({ siteId: s1.id });
  assert.deepEqual([st(b).adsense_code, st(b).ads_txt, st(b).ad_density], ['passed', 'warning', 'passed']); assert.match(byKey(b).ads_txt.detail, /pub-1234567890123456 için/);
  assert.equal(b.facts.changes.find((c) => c.key === 'adsense_code').from, 'missing', 'the change against the previous audit of the same address is stored');
  site.config.adsTxt = null; assert.equal(st(await AU.run({ siteId: s1.id })).ads_txt, 'missing', 'the number is known and there is no ads.txt: missing');
});

test('content and honesty: REST closed = "manual", duplicate titles and thin posts are named, a generic author name is flagged, a broken link and mixed content are found', opts, async () => {
  const pid = await setup();
  site = await fakeSite.start({ ...fakeSite.READY, rest: false }); let a = await AU.run({ projectId: pid, url: site.url });
  assert.equal(st(a).content_volume, 'manual'); assert.ok(!('duplicates' in st(a)) && !('authors' in st(a)), 'what could not be read is not reported as fine'); assert.equal(st(a).privacy, 'passed', 'pages found through the links are still read'); await site.close();
  site = await fakeSite.start({ ...fakeSite.READY, posts: 12, postWords: 120, duplicateTitle: true, author: { name: 'admin', bio: '' }, brokenLink: true, mixed: true });
  a = await AU.run({ projectId: pid, url: site.url }); const s = st(a); const k = byKey(a);
  assert.deepEqual([s.content_volume, s.duplicates, s.authors, s.broken_links], ['warning', 'warning', 'warning', 'warning']); assert.match(k.broken_links.detail, /gone-page/); assert.match(k.content_volume.detail, /300 kelimeden kısa/); assert.match(k.authors.detail, /admin/);
  assert.match(k.ssl.detail, /karışık içerik|http:\/\/ ile başlıyor/);
});

test('an audit is stored per address with changes against the previous one; worse required items raise a notification; only the last 15 are kept', opts, async () => {
  const pid = await setup(); site = await fakeSite.start(fakeSite.READY);
  const first = await AU.run({ projectId: pid, url: `${site.url}/` }); assert.equal(first.url, site.url, 'the trailing slash is not a different address'); assert.deepEqual(first.facts.changes, [], 'the first audit has nothing to compare with');
  assert.equal(st(first).privacy, 'passed');
  const again = await AU.run({ projectId: pid, url: site.url }); assert.deepEqual(again.facts.changes, [], 'nothing changed'); assert.equal((await NT.list({})).items.filter((n) => n.type === 'adsense_site').length, 0);
  site.config.pages = site.config.pages.filter((p) => p[0] !== 'privacy-policy');                  // the privacy page disappears from the live site
  const worse = await AU.run({ projectId: pid, url: site.url });
  assert.ok(worse.facts.changes.some((c) => c.key === 'privacy' && c.from === 'passed' && c.to === 'missing' && c.required)); assert.equal(st(worse).privacy, 'missing');
  const note = (await NT.list({})).items.find((n) => n.type === 'adsense_site'); assert.ok(note && note.severity === 'warning' && /Gizlilik/.test(note.body), 'a required item that got worse is told');
  site.config.pages = fakeSite.READY.pages; const better = await AU.run({ projectId: pid, url: site.url }); assert.ok(better.facts.changes.some((c) => c.key === 'privacy' && c.to === 'passed')); assert.equal((await NT.list({})).items.filter((n) => n.type === 'adsense_site').length, 1, 'getting better is not announced');
  await H.db().query("UPDATE adsense_audits SET started_at = started_at - interval '2 hours' WHERE project_id = $1", [pid]);       // (the hourly limit is not what is tested here)
  for (let i = 0; i < 17; i++) await H.db().query("INSERT INTO adsense_audits (project_id, url, status, verdict, started_at) VALUES ($1,$2,'done','almost', now() - ($3 || ' hours')::interval - interval '3 hours')", [pid, site.url, String(i)]);
  await AU.run({ projectId: pid, url: site.url });
  assert.equal((await H.db().query('SELECT count(*)::int n FROM adsense_audits WHERE project_id = $1 AND url = $2', [pid, site.url])).rows[0].n, AU.KEEP, 'older audits are dropped, the newest are kept');
  assert.equal((await AU.list(pid, { url: site.url }))[0].status, 'done');
});

test('safety: one audit per address at a time, an hourly limit, addresses are validated, and the inside network is unreachable', opts, async () => {
  const pid = await setup(); site = await fakeSite.start(fakeSite.READY);
  assert.equal(AU.normalizeUrl('techupdatebrief.com'), 'https://techupdatebrief.com'); assert.equal(AU.normalizeUrl('HTTPS://Www.Example.com/blog/?x=1#top'), 'https://www.example.com/blog'); assert.equal(AU.normalizeUrl('https://a.com/wp-admin/x'), 'https://a.com');
  for (const bad of ['', 'ftp://x.com', 'https://user:pw@x.com', 'nodots', 'javascript:alert(1)']) assert.throws(() => AU.normalizeUrl(bad), (e) => e.status === 400, bad);
  await H.db().query("INSERT INTO adsense_audits (project_id, url, status) VALUES ($1,$2,'running')", [pid, site.url]);
  await assert.rejects(AU.run({ projectId: pid, url: site.url }), (e) => e.status === 409 && /zaten çalışıyor/.test(e.message));
  await H.db().query("UPDATE adsense_audits SET started_at = now() - interval '11 minutes'"); assert.equal((await AU.run({ projectId: pid, url: site.url })).status, 'done', 'an audit that hung for more than 10 minutes is given up and a new one may start');
  for (let i = 0; i < AU.HOURLY_LIMIT; i++) await H.db().query("INSERT INTO adsense_audits (project_id, url, status) VALUES ($1,$2,'done')", [pid, `https://other${i}.example.com`]);
  await assert.rejects(AU.run({ projectId: pid, url: site.url }), (e) => e.status === 429);
  await H.clean(); const pid2 = await setup(); delete process.env.CONTENT_ALLOW_PRIVATE_FETCH;
  const inner = await AU.run({ projectId: pid2, url: site.url }); assert.deepEqual([inner.verdict, inner.reachable], ['unreachable', false]); assert.match(byKey(inner).reachable.detail, /izin verilmez|iç ağ adresi/);
  const meta = await AU.run({ projectId: pid2, url: 'http://169.254.169.254/latest/meta-data' }); assert.equal(meta.verdict, 'unreachable', 'the cloud metadata address is not fetched'); assert.match(byKey(meta).reachable.detail, /iç ağ adresi/);
});

test('the bot: a person\'s request goes through the queue; the weekly pass audits active sites that were not audited this week; an unreachable site is not a failed job', opts, async () => {
  const pid = await setup(); site = await fakeSite.start(fakeSite.READY);
  const s = await SI.create(pid, { name: 'Blog', apiUrl: site.url, username: 'u', password: 'abcd efgh ijkl mnop' });
  const q = await require('../../src/content/services/queue').enqueue({ botKey: 'adsense_compliance', projectId: pid, payload: { url: site.url }, trigger: 'manual', dedupeKey: `adsense_compliance:${pid}:${site.url}`, maxAttempts: 2 });
  assert.equal(q.duplicate, false); const j = await SC.workOnce({ ctx: {} });
  assert.deepEqual([j.botKey, j.outcome, j.result.stats.verdict], ['adsense_compliance', 'done', 'not_ready']); assert.equal((await AU.list(pid)).length, 1);
  assert.equal((await AU.overview(pid)).sites[0].id, s.id);
  await SC.tick({ now: new Date() }); let w; do { w = await SC.workOnce({ ctx: {} }); } while (w && w.botKey !== 'adsense_compliance');
  assert.equal(w.outcome, 'skipped', 'audited this week already'); assert.match(w.result.message, /bu hafta zaten denetlendi/);
  await H.db().query("UPDATE adsense_audits SET started_at = now() - interval '8 days'"); await H.db().query('UPDATE schedule_settings SET next_run_at = now() - interval \'1 minute\' WHERE bot_key = \'adsense_compliance\'');
  await SC.tick({ now: new Date() }); do { w = await SC.workOnce({ ctx: {} }); } while (w && w.botKey !== 'adsense_compliance');
  assert.deepEqual([w.outcome, w.result.stats.audited], ['done', 1]); assert.equal((await AU.list(pid)).length, 2);
  await site.close(); site = null; await H.db().query("UPDATE adsense_audits SET started_at = now() - interval '8 days'");
  await H.db().query('UPDATE schedule_settings SET next_run_at = now() - interval \'1 minute\' WHERE bot_key = \'adsense_compliance\''); await SC.tick({ now: new Date() });
  do { w = await SC.workOnce({ ctx: {} }); } while (w && w.botKey !== 'adsense_compliance');
  assert.equal(w.outcome, 'done', 'a site that is down is an audit RESULT, not a failed job'); assert.equal((await AU.list(pid))[0].verdict, 'unreachable');
});
