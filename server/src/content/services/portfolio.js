const db = require('../db');
const V = require('../lib/validate');
const { env } = require('../env');
const searchconsole = require('./searchconsole');
const { normalizeUrl } = require('./adsenseAudit');

/**
 * All sites of all projects side by side (phase 7): which site earns attention, which one has problems. Every figure is read from what is stored; a site without Search Console data
 * is listed as "not connected" (never as 0 clicks), sites are ranked by clicks only among the ones that have data, and the cost per article says "unknown" when any call of
 * the period had no price.
 */
const MICROS = 1e6;

async function overview({ days = 28, now = new Date(), tz = env().defaultTimezone } = {}) {
  const d = V.oneOf(Number(days), 'Dönem', [7, 28, 90]);
  const since = new Date(now.getTime() - d * 86400000);
  const projectRows = (await db.query("SELECT p.id, p.name, p.mode, p.domain, n.main_niche FROM content_projects p LEFT JOIN niche_profiles n ON n.project_id = p.id WHERE p.status = 'active' ORDER BY p.created_at")).rows;
  const out = []; const totals = { sites: 0, connected: 0, clicks: 0, impressions: 0, published: 0 };
  for (const p of projectRows) {
    const sites = (await db.query(`SELECT s.*, (SELECT count(*)::int FROM publications x WHERE x.site_id = s.id AND x.status = 'published') AS published, (SELECT count(*)::int FROM publications x WHERE x.site_id = s.id AND x.status = 'scheduled') AS scheduled,
        (SELECT count(*)::int FROM publications x WHERE x.site_id = s.id AND x.published_at >= $2) AS recent, (SELECT count(*)::int FROM publications x WHERE x.site_id = s.id AND x.status = 'failed' AND x.updated_at >= $2) AS failed
      FROM wp_sites s WHERE s.project_id = $1 ORDER BY s.created_at`, [p.id, since])).rows;
    const audits = new Map((await db.query("SELECT DISTINCT ON (url) url, verdict, summary, started_at FROM adsense_audits WHERE project_id = $1 AND status = 'done' ORDER BY url, started_at DESC", [p.id])).rows.map((r) => [r.url, r]));
    const siteOut = [];
    for (const s of sites) {
      const connected = !!s.gsc_property && !!s.gsc_synced_at; let seo = { connected, note: connected ? null : (s.gsc_property ? 'Search Console verisi henüz çekilmedi' : 'Search Console bağlı değil') };
      if (connected) {
        const perf = await searchconsole.performance(s.id, { days: d, now }).catch(() => null);
        if (perf && perf.current) { seo = { connected: true, through: perf.through, clicks: perf.current.clicks, impressions: perf.current.impressions, ctr: perf.current.ctr, position: perf.current.position, previousClicks: perf.previous.clicks, clicksChangePct: perf.change.clicksPct, impressionsChangePct: perf.change.impressionsPct, topPage: perf.pages[0] ? { page: perf.pages[0].page, clicks: perf.pages[0].clicks, title: perf.pages[0].article ? perf.pages[0].article.title : null } : null }; totals.connected++; totals.clicks += perf.current.clicks; totals.impressions += perf.current.impressions; }
        else seo = { connected: true, note: perf ? perf.note : 'Veri okunamadı' };
      }
      let url = null; try { url = normalizeUrl(s.api_url); } catch { /* keep null */ }
      const au = url && audits.get(url);
      totals.sites++; totals.published += s.published;
      siteOut.push({ id: s.id, name: s.name, url, status: s.status, published: s.published, scheduled: s.scheduled, publishedInPeriod: s.recent, failedSends: s.failed, seo,
        adsense: au ? { verdict: au.verdict, requiredMissing: au.summary ? au.summary.requiredMissing.length : null, warnings: au.summary ? au.summary.warning : null, at: au.started_at } : null, adsensePubId: s.adsense_pub_id });
    }
    const art = (await db.query("SELECT count(*) FILTER (WHERE created_at >= $2)::int created, count(*) FILTER (WHERE created_at >= $2 AND created_by = 'ai')::int ai, count(*) FILTER (WHERE status = 'published')::int published, count(*) FILTER (WHERE status = 'needs_update')::int needs_update FROM articles WHERE project_id = $1 AND status <> 'archived'", [p.id, since])).rows[0];
    const use = (await db.query("SELECT COALESCE(sum(cost_micros), 0)::bigint micros, count(*) FILTER (WHERE cost_micros IS NULL AND result = 'ok')::int unknown, COALESCE(sum(requests), 0)::int requests FROM api_usage WHERE project_id = $1 AND created_at >= $2 AND result <> 'blocked_budget'", [p.id, since])).rows[0];
    const cost = Number(use.micros) / MICROS;
    siteOut.sort((a, b) => (b.seo.clicks === undefined ? -1 : b.seo.clicks) - (a.seo.clicks === undefined ? -1 : a.seo.clicks));
    out.push({ id: p.id, name: p.name, mode: p.mode, domain: p.domain, niche: p.main_niche, sites: siteOut,
      articles: { created: art.created, aiDrafts: art.ai, published: art.published, needsUpdate: art.needs_update },
      cost: { usd: cost, unknownCalls: use.unknown, requests: use.requests, perAiArticleUsd: art.ai > 0 && use.unknown === 0 ? Math.round((cost / art.ai) * 10000) / 10000 : null,
        perArticleNote: art.ai === 0 ? 'Bu dönemde yapay zekâ taslağı yok' : use.unknown > 0 ? `${use.unknown} çağrının maliyeti bilinmiyor: makale başına gider hesaplanamaz` : 'Araştırma, kontrol ve yazım dahil bu projeye bağlı tüm API gideri / yapay zekâ taslağı sayısı' } });
  }
  out.sort((a, b) => Math.max(...b.sites.map((s) => (s.seo.clicks === undefined ? -1 : s.seo.clicks)), -2) - Math.max(...a.sites.map((s) => (s.seo.clicks === undefined ? -1 : s.seo.clicks)), -2));
  return { days: d, generatedAt: now.toISOString(), projects: out, totals,
    notes: ['Tıklama ve gösterim Search Console’un bildirdiği KESİNLEŞMİŞ verilerdir (2-3 gün gecikmeli); bağlı olmayan site 0 tıklama değil “veri yok” demektir.', 'Maliyet yalnızca sağlayıcıların bildirdiği tutarlardır; projeye bağlanamayan çağrılar (bağlantı testleri gibi) hiçbir projeye yazılmaz.', 'Siteler yalnızca verisi olanlar arasında tıklamaya göre sıralanır.'] };
}

module.exports = { overview };
