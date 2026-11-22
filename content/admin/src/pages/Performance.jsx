import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Field, NeedsProject, PageHead, Tabs, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, num, shortDay } from '../format.js';

const PERIOD = [['7', 'Son 7 gün'], ['28', 'Son 28 gün'], ['90', 'Son 90 gün']];
const KIND = { low_ctr: ['Düşük tıklama oranı', 'warn'], click_drop: ['Tıklama düşüşü', 'bad'], demand_drop: ['Genel düşüş', ''], new_keyword: ['Yeni anahtar kelime fırsatı', 'info'], changed_intent: ['Arama niyeti değişmiş', 'warn'], link_need: ['İç bağlantı ihtiyacı', 'info'] };
const COUNTRY = { usa: 'ABD', gbr: 'Birleşik Krallık', can: 'Kanada', aus: 'Avustralya', ind: 'Hindistan', deu: 'Almanya', fra: 'Fransa', tur: 'Türkiye', nld: 'Hollanda' };
const DEVICE = { MOBILE: 'Mobil', DESKTOP: 'Masaüstü', TABLET: 'Tablet' };
const pctText = (v) => (v === null || v === undefined ? 'önceki dönemde veri yok' : `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}%`);
const kindOf = (v) => (v === null || v === undefined || v === 0 ? '' : v > 0 ? 'ok' : 'bad');
const rate = (v) => (v === null || v === undefined ? '—' : `%${(v * 100).toFixed(1).replace('.', ',')}`);
const pos = (v) => (v === null || v === undefined ? '—' : String(v).replace('.', ','));

function Tile({ label, value, sub, delta }) {
  return <div className="metric"><span className="l">{label}</span><span className="v">{value}</span>{delta !== undefined && <span className="n"><Badge kind={kindOf(delta)}>{pctText(delta)}</Badge></span>}{sub && <span className="n">{sub}</span>}</div>;
}

function Opportunities({ siteId }) {
  const st = useLoad(() => api.get(`/performance/opportunities?siteId=${siteId}`), [siteId]);
  return (
    <Async state={st}>{(d) => d && (
      <Card flat title={`Fırsatlar ve işaretler${d.items ? ` (${d.items.length})` : ''}`}>
        <div className="stack">
          {d.note && <small className="faint">{d.note}</small>}
          {d.items.length === 0 ? <p className="muted">{d.connected ? 'Şu an dikkat çeken bir işaret yok.' : 'Search Console verisi olmadığı için işaret üretilemez.'}</p> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>İşaret</th><th>Neye dayanıyor</th><th /></tr></thead>
              <tbody>{d.items.map((it, i) => (
                <tr key={i}><td style={{ whiteSpace: 'nowrap' }}><Badge kind={(KIND[it.kind] || ['', ''])[1]}>{(KIND[it.kind] || [it.kind])[0]}</Badge></td>
                  <td style={{ maxWidth: 560 }}>{it.text}</td>
                  <td className="num">{it.article && <Link className="btn sm" to={`/articles/${it.article.articleId}`}>Makaleyi aç</Link>}</td></tr>))}</tbody></table></div>)}
        </div>
      </Card>
    )}</Async>
  );
}

/** SEO Performansı: what Search Console reports for a site, never estimated; no data is said to be no data */
export default function Performance() {
  const { projectId, can } = useApp();
  const sites = useLoad(() => (projectId ? api.get(`/sites?projectId=${projectId}`) : Promise.resolve(null)), [projectId]);
  const [siteId, setSiteId] = useState(''); const [days, setDays] = useState('28'); const [run, busy] = useAction();
  const list = sites.data ? sites.data.sites : [];
  useEffect(() => { if (list.length && !list.some((s) => s.id === siteId)) setSiteId(list[0].id); }, [sites.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const perf = useLoad(() => (siteId ? api.get(`/performance?siteId=${siteId}&days=${days}`) : Promise.resolve(null)), [siteId, days]);
  if (!projectId) return <NeedsProject />;
  const sync = async () => { const r = await run(() => api.post(`/sites/${siteId}/gsc-sync`)); if (r) { perf.reload(); sites.reload(); } };
  const site = list.find((s) => s.id === siteId);
  return (
    <div className="page">
      <PageHead title="SEO Performansı">Search Console’un bildirdiği gerçek sayılar: tıklama, gösterim, tıklama oranı ve ortalama sıra; önceki aynı uzunluktaki dönemle karşılaştırılır. Veri yoksa “veri yok” yazılır, hiçbir sayı tahmin edilmez. Search Console verisi 2-3 gün geriden gelir; en son günler hiç istenmez.</PageHead>
      <Async state={sites}>{() => (list.length === 0 ? <Card><Empty title="Henüz WordPress sitesi bağlı değil">Performans, bir siteye bağlanır. Önce “Web Sitelerim”den sitenizi ekleyin, sonra Search Console sitesini orada yazın.</Empty></Card> : (
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Site"><select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site">{list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Tabs tabs={PERIOD} value={days} onChange={setDays} />
            {can('sites.write') && site && site.gscProperty && <button className="btn" disabled={busy} onClick={sync}><RefreshCw size={14} />Search Console verisini çek</button>}
          </div>
          <Async state={perf}>{(d) => d && (!d.connected ? (
            <Card title="Search Console bağlı değil">
              <div className="stack">
                <Alert kind="info">{d.note}</Alert>
                {d.site.error && <Alert kind="bad" title="Son çekme başarısız">{d.site.error}</Alert>}
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  <li>Google Cloud’da bir <strong>servis hesabı</strong> oluşturun, <strong>JSON anahtar</strong> indirin ve Search Console API’yi etkinleştirin.</li>
                  <li>Search Console → Ayarlar → <strong>Kullanıcılar ve izinler</strong>’de servis hesabının e-postasını siteye <strong>Kısıtlı</strong> kullanıcı olarak ekleyin.</li>
                  <li>“API Kullanımı ve Maliyetler”de <strong>Google Search Console</strong> kartına JSON dosyasının tüm içeriğini yapıştırıp kaydedin ve bağlantıyı test edin (ücretsizdir).</li>
                  <li>“Web Sitelerim → Ayarlar”da bu sitenin <strong>Search Console sitesi</strong> alanını yazın (örn. <code>sc-domain:siteniz.com</code>), sonra buradan “Search Console verisini çek”e basın.</li>
                </ol>
                {site && !site.gscProperty && <small className="faint">Bu sitenin Search Console sitesi henüz yazılmamış.</small>}
                {site && site.gscProperty && can('sites.write') && <div><button className="btn primary" disabled={busy} onClick={sync}><RefreshCw size={14} />Search Console verisini çek</button></div>}
              </div>
            </Card>
          ) : !d.current ? (
            <Alert kind="info" title="Henüz veri yok">{d.note}</Alert>
          ) : (
            <>
              <small className="faint">{d.site.property} · son çekme {dt(d.site.syncedAt)} · {d.window.from} → {d.window.to} (önceki dönem {d.window.previousFrom} → {d.window.previousTo})</small>
              {d.site.error && <Alert kind="bad" title="Son çekme başarısız (eski veri gösteriliyor)">{d.site.error}</Alert>}
              <div className="grid g4">
                <Tile label="Tıklama" value={num(d.current.clicks)} delta={d.change.clicksPct} sub={`önceki ${num(d.previous.clicks)}`} />
                <Tile label="Gösterim" value={num(d.current.impressions)} delta={d.change.impressionsPct} sub={`önceki ${num(d.previous.impressions)}`} />
                <Tile label="Ortalama tıklama oranı" value={rate(d.current.ctr)} sub={`önceki ${rate(d.previous.ctr)}`} />
                <Tile label="Ortalama sıra" value={pos(d.current.position)} sub={`önceki ${pos(d.previous.position)} · düşük sayı daha iyi`} />
              </div>
              <Card flat title="Günlük tıklama ve gösterim">
                <div className="chartbox"><ResponsiveContainer width="100%" height="100%"><LineChart data={d.series.map((x) => ({ ...x, label: shortDay(x.day) }))} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line-soft)" /><XAxis dataKey="label" stroke="var(--text-3)" fontSize={11} /><YAxis yAxisId="c" stroke="var(--text-3)" fontSize={11} allowDecimals={false} /><YAxis yAxisId="i" orientation="right" stroke="var(--text-3)" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }} />
                  <Line yAxisId="c" type="monotone" dataKey="clicks" name="Tıklama" stroke="var(--accent)" dot={false} strokeWidth={2} /><Line yAxisId="i" type="monotone" dataKey="impressions" name="Gösterim" stroke="var(--accent-2)" dot={false} strokeWidth={1.5} strokeDasharray="4 3" /></LineChart></ResponsiveContainer></div>
              </Card>
              <Card flat title={`Sayfalar (${d.pages.length})`}>
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Sayfa</th><th className="num">Tıklama</th><th className="num">Gösterim</th><th className="num">Tıklama oranı</th><th className="num">Sıra</th><th>Önceki döneme göre</th></tr></thead>
                  <tbody>{d.pages.map((p) => (
                    <tr key={p.page}><td style={{ maxWidth: 360, wordBreak: 'break-all' }}>{p.article ? <Link to={`/articles/${p.article.articleId}`}><strong>{p.article.title}</strong></Link> : <a href={p.page} target="_blank" rel="noopener noreferrer nofollow">{p.page}</a>}{p.article && <div className="faint">{p.page}</div>}</td>
                      <td className="num">{num(p.clicks)}</td><td className="num">{num(p.impressions)}</td><td className="num">{rate(p.ctr)}</td><td className="num">{pos(p.position)}</td>
                      <td><Badge kind={kindOf(p.clicksChangePct)}>{pctText(p.clicksChangePct)}</Badge><div className="faint">{num(p.prevClicks)} → {num(p.clicks)}</div></td></tr>))}</tbody></table></div>
              </Card>
              <div className="grid g3">
                <Card flat title="Aramalar (ilk 30)"><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Arama</th><th className="num">Tıklama</th><th className="num">Gösterim</th><th className="num">Sıra</th></tr></thead>
                  <tbody>{d.queries.length === 0 ? <tr><td colSpan={4} className="faint">Arama verisi yok</td></tr> : d.queries.map((q) => <tr key={q.query}><td>{q.query}</td><td className="num">{num(q.clicks)}</td><td className="num">{num(q.impressions)}</td><td className="num">{pos(q.position)}</td></tr>)}</tbody></table></div></Card>
                <Card flat title="Ülkeler"><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Ülke</th><th className="num">Tıklama</th><th className="num">Gösterim</th></tr></thead>
                  <tbody>{d.countries.length === 0 ? <tr><td colSpan={3} className="faint">Veri yok</td></tr> : d.countries.map((c) => <tr key={c.key}><td>{COUNTRY[c.key] || c.key.toUpperCase()}</td><td className="num">{num(c.clicks)}</td><td className="num">{num(c.impressions)}</td></tr>)}</tbody></table></div></Card>
                <Card flat title="Cihazlar"><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Cihaz</th><th className="num">Tıklama</th><th className="num">Gösterim</th></tr></thead>
                  <tbody>{d.devices.length === 0 ? <tr><td colSpan={3} className="faint">Veri yok</td></tr> : d.devices.map((c) => <tr key={c.key}><td>{DEVICE[c.key] || c.key}</td><td className="num">{num(c.clicks)}</td><td className="num">{num(c.impressions)}</td></tr>)}</tbody></table></div></Card>
              </div>
              <Opportunities siteId={siteId} />
              <div className="stack">{d.notes.map((n, i) => <small key={i} className="faint">{n}</small>)}</div>
            </>
          ))}</Async>
        </div>
      ))}</Async>
    </div>
  );
}
