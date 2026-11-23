import { Link } from 'react-router-dom';
import { ClipboardCheck, Wand2 } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, NeedsProject, PageHead, ScoreBar, useAction, useApp, useLoad } from '../ui.jsx';
import { RISK, dt } from '../format.js';

const ST = { published: ['Yayında', 'ok'], scheduled: ['Zamanlandı', 'info'], ready: ['Yayına hazır', 'ok'], needs_update: ['Güncelleme bekliyor', 'warn'] };
const KIND = { minor: 'Küçük', major: 'Kapsamlı', critical: 'KRİTİK' };
const SEO = { ok: ['Tamam', 'ok'], warn: ['Uyarı', 'warn'], fail: ['Sorun', 'bad'] };

/** İçerik Sağlığı: what is old or broken, in the order it should be looked at */
export default function Health() {
  const { projectId, can, toast } = useApp();
  const st = useLoad(() => (projectId ? api.get(`/health?projectId=${projectId}`) : Promise.resolve(null)), [projectId]);
  const [run, busy] = useAction();
  if (!projectId) return <NeedsProject />;
  const check = async (a) => { const r = await run(() => api.post(`/articles/${a.id}/health-check`)); if (r) { toast(r.assessment.needsUpdate ? `Kanıt bulundu: ${r.assessment.signals.map((s) => s.text).join(' · ')}` : 'Bir sorun bulunamadı', r.assessment.needsUpdate ? 'bad' : undefined); st.reload(); } };
  const propose = async (a) => { if (await run(() => api.post(`/articles/${a.id}/propose-update`), 'Güncelleme taslağı hazırlanıyor (birkaç dakika sürebilir); Güncelleme Merkezi’nde görünür')) st.reload(); };
  return (
    <div className="page">
      <PageHead title="İçerik Sağlığı">Yayında, zamanlanmış ya da yayına hazır makalelerin hâlâ doğru ve erişilebilir olup olmadığı. Bir makale <strong>yalnızca eskidiği için</strong> güncelleme bekleyene çevrilmez; kanıt gerekir: bozuk bir bağlantı ya da konuyla ilgili güvenilir yeni haberler. Kontrol sıklığı Ayarlar → Güncelleme aralıklarındadır, günlük kontrol sayısı Günlük limitler’dedir.</PageHead>
      <Async state={st}>{(d) => d && (
        <>
          <div className="grid g4">
            {[['Yayımlanmış', d.counts.published], ['Güncelleme bekleyen', d.counts.awaitingUpdate], ['Son 30 günde güncellenen', d.counts.updatedLast30], ['Bozuk bağlantılı', d.counts.withBrokenLinks],
              ['Kontrol süresi geçmiş', d.counts.outdated], ['AdSense riskli', d.counts.adsenseRisky], ['Bekleyen güncelleme taslağı', d.counts.openProposals], ['Kritik düzeltme bekleyen', d.counts.criticalPending],
              ['Tıklaması belirgin düşen', d.counts.performanceDrops === null ? 'Search Console yok' : d.counts.performanceDrops]].map(([l, v]) => <div key={l} className="metric"><span className="l">{l}</span><span className="v">{v}</span></div>)}
          </div>
          <Alert kind="info" title="SEO performansı">{d.performance.note} {d.performance.connected && <Link to="/performance">SEO Performansı sayfasına git</Link>}</Alert>
          <Card flat title={`Güncelleme önceliğine göre (${d.items.length} makale)`}>
            {d.items.length === 0 ? <p className="muted">Henüz yayında/hazır makale yok. Makaleler “Yayına hazır” olunca burada izlenir.</p> : (
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Makale</th><th>Durum</th><th>Neden</th><th>Son kontrol</th><th>Son güncelleme</th>{d.performance.connected && <th>Tıklama (28 gün)</th>}<th className="num">Kalite</th><th>SEO</th><th /></tr></thead>
                <tbody>{d.items.map((a) => (
                  <tr key={a.id}><td style={{ maxWidth: 280 }}><Link to={`/articles/${a.id}`}><strong>{a.title}</strong></Link><div className="faint">{a.classLabel} · her {d.intervals[a.class]} günde bir{a.wpUrl && <> · <a href={a.wpUrl} target="_blank" rel="noopener noreferrer nofollow">yazı</a></>}</div></td>
                    <td><Badge kind={ST[a.status][1]}>{ST[a.status][0]}</Badge>{a.proposal && <div><Link to="/updates"><Badge kind={a.proposal.kind === 'critical' ? 'bad' : 'info'}>{KIND[a.proposal.kind]} taslak var</Badge></Link></div>}</td>
                    <td style={{ maxWidth: 320 }}>{a.signals.length ? a.signals.map((s) => <div key={s.code}>{s.text}</div>) : a.overdueDays > 0 ? <span className="faint">Kontrol süresi {a.overdueDays} gün geçti (kanıt yok: değiştirilmez)</span> : <span className="faint">—</span>}{a.adsenseRisk && a.adsenseRisk !== 'low' && <div><Badge kind={RISK[a.adsenseRisk][1]}>AdSense: {RISK[a.adsenseRisk][0]}</Badge></div>}</td>
                    <td className="faint">{a.lastCheckedAt ? dt(a.lastCheckedAt) : 'hiç kontrol edilmedi'}</td><td className="faint">{a.lastUpdatedAt ? dt(a.lastUpdatedAt) : dt(a.createdAt)}</td>
                    {d.performance.connected && <td>{a.performance ? <><strong>{a.performance.clicks}</strong> <span className="faint">(önceki {a.performance.prevClicks})</span>{a.performance.drop && <div><Badge kind="warn" title="Tek başına güncelleme gerekçesi değildir">belirgin düşüş</Badge></div>}</> : <span className="faint">veri yok</span>}</td>}
                    <td className="num"><ScoreBar value={a.qualityScore} /></td><td>{a.seoStatus ? <Badge kind={SEO[a.seoStatus][1]}>{SEO[a.seoStatus][0]}</Badge> : '—'}</td>
                    <td className="num"><div className="row end" style={{ flexWrap: 'nowrap' }}>
                      {can('articles.write') && <button className="btn sm" disabled={busy} onClick={() => check(a)}><ClipboardCheck size={14} />Şimdi kontrol et</button>}
                      {can('research.paid') && a.status === 'needs_update' && !a.proposal && <button className="btn sm primary" disabled={busy} onClick={() => propose(a)}><Wand2 size={14} />Taslak hazırla</button>}</div></td></tr>))}</tbody></table></div>)}
          </Card>
        </>
      )}</Async>
    </div>
  );
}
