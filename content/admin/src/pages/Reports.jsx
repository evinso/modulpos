import { useEffect, useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Empty, NeedsProject, PageHead, Tabs, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, num, usd } from '../format.js';

const VERDICT = { unreachable: 'okunamadı', not_ready: 'eksikler var', almost: 'uyarılar var', checks_clean: 'otomatik kontroller temiz' };
const dayText = (k) => new Date(`${k}T00:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const pct = (v) => (v === null || v === undefined ? '' : ` (${v > 0 ? '+' : ''}${String(v).replace('.', ',')}%)`);

function Row({ l, children }) { return <tr><td className="faint" style={{ width: 190, verticalAlign: 'top' }}>{l}</td><td>{children}</td></tr>; }

function View({ id }) {
  const st = useLoad(() => api.get(`/reports/${id}`), [id]); const [raw, setRaw] = useState(false);
  return (
    <Async state={st}>{(r) => { const d = r.data; const c = d.cost.project; const u = d.cost.unattributed; return (
      <div className="stack">
        <div className="row"><strong>{r.kind === 'weekly' ? `${dayText(r.dayFrom)} – ${dayText(r.dayTo)}` : dayText(r.dayTo)}</strong><Badge>{r.kind === 'weekly' ? 'Haftalık' : 'Günlük'}</Badge><small className="faint">hazırlandı {dt(r.createdAt)} · {r.timezone} günleri{r.trigger === 'manual' ? ' · elle' : ''}</small></div>
        <small className="faint">Bu rapor hazırlandığı anda ölçülmüş sayıları saklar; sonradan değişmez.</small>
        <div className="tbl-wrap"><table className="tbl"><tbody>
          <Row l="Makaleler">{d.articles.created} yeni taslak ({d.articles.aiDrafts} yapay zekâ); sitede yayına çıkan {d.publishing.wentPublic}.<div className="faint">Şu an: {d.articles.now.awaitingReview} onay/kontrol bekliyor · {d.articles.now.ready} hazır · {d.articles.now.published} yayında · {d.articles.now.needsUpdate} güncelleme bekliyor{d.articles.adsenseRisky.review + d.articles.adsenseRisky.blocked > 0 ? ` · AdSense riski: ${d.articles.adsenseRisky.blocked} yayınlanamaz, ${d.articles.adsenseRisky.review} inceleme` : ''}</div></Row>
          <Row l="Güncellemeler">{d.updates.proposals.reduce((s, x) => s + x.n, 0)} taslak hazırlandı, {d.updates.applied} uygulandı, {d.updates.openNow} onay bekliyor; {d.updates.internalLinksApplied} iç bağlantı eklendi.</Row>
          <Row l="Görevler">{d.jobs.done} tamam · {d.jobs.skipped} atlandı · <span style={{ color: d.jobs.failed ? 'var(--bad)' : undefined }}>{d.jobs.failed} başarısız</span>{d.publishing.failedSends > 0 && <> · {d.publishing.failedSends} WordPress gönderimi başarısız</>}
            {d.jobs.failures.map((f, i) => <div key={i} className="faint">{f.bot}: {f.error}</div>)}</Row>
          <Row l="Araştırma">{num(d.research.newsItems)} haber ({num(d.research.newsRelevant)} nişe uygun) · {d.research.keywordsAdded} yeni anahtar kelime · {d.research.serpAnalyses} SERP analizi · {d.research.opportunitiesFound} yeni fırsat</Row>
          <Row l="Maliyet">{usd(c.costUsd)}{c.unknownCalls > 0 && <> <Badge title="Fiyatı olmayan çağrılar toplama katılmaz">+{c.unknownCalls} çağrının maliyeti bilinmiyor</Badge></>}
            {c.providers.filter((p) => p.requests).map((p) => <div key={p.provider} className="faint">{p.provider}: {usd(p.costUsd)} · {p.requests} istek{p.errors ? ` · ${p.errors} hata` : ''}</div>)}
            {u.requests > 0 && <div className="faint">Projeye bağlanamayan (bağlantı testleri gibi): {usd(u.costUsd)}{u.unknownCalls ? ` (+${u.unknownCalls} bilinmiyor)` : ''}</div>}{c.blockedByBudget + u.blockedByBudget > 0 && <div className="faint">Bütçe koruması {c.blockedByBudget + u.blockedByBudget} çağrıyı durdurdu.</div>}</Row>
          <Row l="SEO performansı">{d.seo.sites.length === 0 ? <span className="faint">Bu projede WordPress sitesi yok.</span> : d.seo.sites.map((s) => <div key={s.site}>{s.available ? <><strong>{s.site}</strong>: {num(s.clicks)} tıklama{pct(s.clicksChangePct)}, {num(s.impressions)} gösterim <span className="faint">({dayText(s.through)} gününe kadar son 7 gün)</span></> : <><strong>{s.site}</strong>: <span className="faint">veri yok — {s.note}</span></>}</div>)}</Row>
          <Row l="AdSense site denetimi">{d.adsense.sites.length === 0 ? <span className="faint">Henüz site denetimi yapılmadı.</span> : d.adsense.sites.map((s) => <div key={s.url}>{s.url.replace(/^https?:\/\//, '')}: {VERDICT[s.verdict] || '—'}{s.requiredMissing ? ` (${s.requiredMissing} zorunlu eksik)` : ''}</div>)}</Row>
          <Row l="Dikkat">{d.notable.length === 0 ? <span className="faint">Bu dönemde uyarı ya da kritik bildirim yok.</span> : d.notable.map((n, i) => <div key={i}><Badge kind={n.severity === 'critical' ? 'bad' : 'warn'}>{n.severity === 'critical' ? 'Kritik' : 'Uyarı'}</Badge> {n.title}</div>)}</Row>
        </tbody></table></div>
        <div className="row"><button className="btn sm ghost" onClick={() => setRaw(!raw)}>{raw ? 'Düz metni gizle' : 'Düz metin (Telegram’a giden)'}</button></div>
        {raw && <pre className="faint" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.body}</pre>}
      </div>); }}</Async>
  );
}

/** Raporlar: the daily and weekly reports (numbers measured when the report was made, then kept) */
export default function Reports() {
  const { projectId, can } = useApp();
  const [kind, setKind] = useState('daily'); const [sel, setSel] = useState(null); const [run, busy] = useAction();
  const st = useLoad(() => (projectId ? api.get(`/reports?projectId=${projectId}&kind=${kind}`) : Promise.resolve(null)), [projectId, kind]);
  useEffect(() => { if (st.data && st.data.reports.length && !st.data.reports.some((r) => r.id === sel)) setSel(st.data.reports[0].id); if (st.data && !st.data.reports.length) setSel(null); }, [st.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!projectId) return <NeedsProject />;
  const make = async () => { const r = await run(() => api.post('/reports', { projectId, kind }), `${kind === 'weekly' ? 'Haftalık' : 'Günlük'} rapor hazırlandı`); if (r && r.id) { setSel(r.id); st.reload(); } };
  return (
    <div className="page">
      <PageHead title="Raporlar" actions={can('research.write') && <button className="btn primary" disabled={busy} onClick={make}><FilePlus2 size={15} />{kind === 'weekly' ? 'Haftalık raporu şimdi hazırla' : 'Günlük raporu şimdi hazırla'}</button>}>
        Her sabah önceki günün, pazartesileri önceki haftanın raporu kendiliğinden hazırlanır (Bot Yönetimi → Reporting Bot) ve bildirim gelir; Telegram’a da gider. Her sayı hazırlandığı anda <strong>ölçülür ve saklanır</strong>: ölçülemeyen şey “veri yok” yazar, fiyatı bilinmeyen API çağrısı sayılır ama toplama katılmaz. “Şimdi hazırla” en son tamamlanmış günün (haftanın) raporunu yeniden ölçer.
      </PageHead>
      <Tabs tabs={[['daily', 'Günlük'], ['weekly', 'Haftalık']]} value={kind} onChange={(k) => { setKind(k); setSel(null); }} />
      <Async state={st}>{(d) => d && (d.reports.length === 0 ? <Card><Empty title={`Henüz ${kind === 'weekly' ? 'haftalık' : 'günlük'} rapor yok`}>Raporlar sabah 06:00–12:00 arasında kendiliğinden hazırlanır; beklemeden yukarıdaki düğmeyle ilkini üretebilirsiniz.</Empty></Card> : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(180px, 240px) minmax(0, 1fr)', alignItems: 'start' }}>
          <Card flat title="Raporlar"><div className="stack" style={{ gap: 4 }}>{d.reports.map((r) => <button key={r.id} className={`btn sm ${sel === r.id ? 'primary' : ''}`} style={{ justifyContent: 'flex-start' }} onClick={() => setSel(r.id)}>{r.kind === 'weekly' ? `${dayText(r.dayFrom).replace(/ \d{4}$/, '')} – ${dayText(r.dayTo).replace(/ \d{4}$/, '')}` : dayText(r.dayTo)}</button>)}</div></Card>
          <Card flat>{sel ? <View id={sel} /> : <Alert kind="info">Soldan bir rapor seçin.</Alert>}</Card>
        </div>
      ))}</Async>
    </div>
  );
}
