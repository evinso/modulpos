import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Tabs, useLoad } from '../ui.jsx';
import { num, usd } from '../format.js';

const VERDICT = { unreachable: ['Okunamadı', 'bad'], not_ready: ['Eksikler var', 'bad'], almost: ['Uyarılar var', 'warn'], checks_clean: ['Otomatik kontroller temiz', 'ok'] };
const pctText = (v) => (v === null || v === undefined ? '' : `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}%`);
const kindOf = (v) => (v === null || v === undefined || v === 0 ? '' : v > 0 ? 'ok' : 'bad');

/** Tüm siteler: every site of every project side by side (only what is measured; "not connected" is never 0 clicks) */
export default function Portfolio() {
  const [days, setDays] = useState('28');
  const st = useLoad(() => api.get(`/portfolio?days=${days}`), [days]);
  return (
    <div className="stack">
      <Tabs tabs={[['7', 'Son 7 gün'], ['28', 'Son 28 gün'], ['90', 'Son 90 gün']]} value={days} onChange={setDays} />
      <Async state={st}>{(d) => (d.projects.length === 0 ? <Card><Empty title="Etkin proje yok" /></Card> : (
        <div className="stack">
          <div className="grid g4">
            <div className="metric"><span className="l">Site</span><span className="v">{d.totals.sites}</span><span className="n">{d.totals.connected} tanesinde Search Console verisi var</span></div>
            <div className="metric"><span className="l">Tıklama (verisi olan siteler)</span><span className="v">{d.totals.connected ? num(d.totals.clicks) : 'Veri yok'}</span><span className="n">yalnızca ölçülenler toplanır</span></div>
            <div className="metric"><span className="l">Gösterim (verisi olan siteler)</span><span className="v">{d.totals.connected ? num(d.totals.impressions) : 'Veri yok'}</span></div>
            <div className="metric"><span className="l">Yayında yazı (tüm siteler)</span><span className="v">{num(d.totals.published)}</span></div>
          </div>
          {d.projects.map((p) => (
            <Card key={p.id} flat title={p.name} actions={<>{p.niche && <Badge>{p.niche}</Badge>}<Badge kind={p.mode === 'connected' ? 'ok' : ''}>{p.mode === 'connected' ? 'bağlı' : 'arşiv modu'}</Badge></>}>
              <div className="stack">
                <div className="row"><span>Son {d.days} günde <strong>{p.articles.created}</strong> yeni makale ({p.articles.aiDrafts} yapay zekâ), toplam <strong>{p.articles.published}</strong> yayında, <strong>{p.articles.needsUpdate}</strong> güncelleme bekliyor.</span></div>
                <div className="row"><span>API gideri: <strong>{usd(p.cost.usd)}</strong>{p.cost.unknownCalls > 0 && <> <Badge>+{p.cost.unknownCalls} çağrının maliyeti bilinmiyor</Badge></>} · makale başına: <strong>{p.cost.perAiArticleUsd === null ? 'Bilinmiyor' : usd(p.cost.perAiArticleUsd)}</strong></span><small className="faint">{p.cost.perArticleNote}</small></div>
                {p.sites.length === 0 ? <Alert kind="info">Bu projeye henüz WordPress sitesi bağlanmamış. <Link to="/sites">Web Sitelerim</Link></Alert> : (
                  <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Site</th><th className="num">Yayında</th><th className="num">Tıklama</th><th className="num">Gösterim</th><th className="num">Sıra</th><th>Önceki döneme göre</th><th>AdSense site denetimi</th><th>Sorun</th></tr></thead>
                    <tbody>{p.sites.map((s) => (
                      <tr key={s.id}><td><strong>{s.name}</strong>{s.status === 'paused' && <> <Badge kind="warn">duraklatıldı</Badge></>}<div className="faint">{s.url ? s.url.replace(/^https?:\/\//, '') : ''}</div></td>
                        <td className="num">{s.published}{s.scheduled ? <div className="faint">+{s.scheduled} zamanlı</div> : null}<div className="faint">son {d.days} günde {s.publishedInPeriod}</div></td>
                        {s.seo.clicks !== undefined ? <><td className="num">{num(s.seo.clicks)}{s.seo.topPage && <div className="faint" title={s.seo.topPage.page}>en çok: {s.seo.topPage.title || s.seo.topPage.page.replace(/^https?:\/\//, '')}</div>}</td><td className="num">{num(s.seo.impressions)}</td><td className="num">{s.seo.position === null ? '—' : String(s.seo.position).replace('.', ',')}</td>
                          <td><Badge kind={kindOf(s.seo.clicksChangePct)}>{s.seo.clicksChangePct === null ? 'önceki dönemde veri yok' : pctText(s.seo.clicksChangePct)}</Badge><div className="faint">{num(s.seo.previousClicks)} → {num(s.seo.clicks)}</div></td></>
                          : <td colSpan={4}><span className="faint">Veri yok — {s.seo.note}</span></td>}
                        <td>{s.adsense ? <><Badge kind={VERDICT[s.adsense.verdict][1]}>{VERDICT[s.adsense.verdict][0]}</Badge>{s.adsense.requiredMissing ? <div className="faint">{s.adsense.requiredMissing} zorunlu eksik</div> : null}</> : <span className="faint">denetlenmedi</span>}</td>
                        <td>{s.failedSends > 0 ? <Badge kind="warn">{s.failedSends} başarısız gönderim</Badge> : <span className="faint">—</span>}</td></tr>))}</tbody></table></div>)}
              </div>
            </Card>))}
          <div className="stack">{d.notes.map((n, i) => <small key={i} className="faint">{n}</small>)}</div>
        </div>
      ))}</Async>
    </div>
  );
}
