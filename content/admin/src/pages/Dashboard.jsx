import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, PageHead, useApp, useLoad } from '../ui.jsx';
import { num, shortDay, usd, dt } from '../format.js';

const money = (m) => (m.key.startsWith('cost') ? usd(m.value) : num(m.value));

function Metric({ m }) {
  return (
    <div className="metric"><span className="l">{m.label}</span><span className="v">{money(m)}</span>
      {m.note && <span className="n">{m.note}</span>}
      {m.unknownCalls > 0 && <span className="n">+ {m.unknownCalls} çağrının maliyeti bilinmiyor</span>}
    </div>
  );
}

function Series({ data, kind = 'bar', label, fmt = num }) {
  const rows = data.map((d) => ({ ...d, label: shortDay(d.day) }));
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total === 0) return <p className="muted" style={{ padding: '30px 0', textAlign: 'center' }}>Bu aralıkta kayıt yok.</p>;
  const common = { data: rows, margin: { top: 6, right: 8, left: -14, bottom: 0 } };
  const axes = [<CartesianGrid key="g" strokeDasharray="3 3" stroke="var(--line-soft)" />, <XAxis key="x" dataKey="label" stroke="var(--text-3)" fontSize={11} interval="preserveStartEnd" />, <YAxis key="y" stroke="var(--text-3)" fontSize={11} allowDecimals={false} />,
    <Tooltip key="t" contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }} formatter={(v) => [fmt(v), label]} />];
  return (
    <div className="chartbox" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'area' ? <AreaChart {...common}>{axes}<Area type="monotone" dataKey="value" stroke="var(--accent-2)" fill="var(--accent)" fillOpacity={0.25} /></AreaChart>
          : <BarChart {...common}>{axes}<Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} /></BarChart>}
      </ResponsiveContainer>
    </div>
  );
}

function Buckets({ c, empty, foot }) {
  const max = Math.max(1, ...c.buckets.map((b) => b.n)); const total = c.buckets.reduce((a, b) => a + b.n, 0);
  if (!total) return <p className="muted">{empty}</p>;
  return <div className="stack">{c.buckets.map((b) => <div key={b.label} className="row between" style={{ flexWrap: 'nowrap' }}><span style={{ width: 90 }}>{b.label}</span><div className="bar" style={{ flex: 1 }}><i style={{ width: `${(b.n / max) * 100}%` }} /></div><strong style={{ width: 32, textAlign: 'right' }}>{b.n}</strong></div>)}<small className="faint">{foot}</small></div>;
}

/** Organic traffic from the stored Search Console numbers: a chart of clicks, or the reason there is nothing to show (never a 0 that looks measured) */
function Organic({ o }) {
  if (!o.available) return <div className="stack"><p className="muted">{o.note}</p><Link className="btn sm" to={o.sites ? '/performance' : '/sites'}>{o.sites ? 'SEO Performansı' : 'Web Sitelerim'}</Link></div>;
  return (
    <div className="stack">
      <Series data={o.series.map((r) => ({ day: r.day, value: r.clicks }))} label="Tıklama" />
      <small className="faint">{num(o.clicks)} tıklama · {num(o.impressions)} gösterim · {o.connectedSites} site · {o.from} – {o.through}. {o.note}</small>
    </div>
  );
}

function CategoryShare({ cats }) {
  const total = cats.reduce((a, c) => a + c.articles, 0);
  return (
    <div className="stack">
      {cats.map((c) => {
        const actual = total ? Math.round((c.articles / total) * 100) : 0;
        return (
          <div key={c.id} className="stack" style={{ gap: 4 }}>
            <div className="row between"><span>{c.name}</span><span className="muted">{c.articles} makale · gerçekleşen %{actual} / hedef %{c.targetSharePct}</span></div>
            <div className="bar" title={`Gerçekleşen %${actual}`}><i style={{ width: `${actual}%` }} /></div>
            <div className="bar ok" style={{ height: 4 }} title={`Hedef %${c.targetSharePct}`}><i style={{ width: `${c.targetSharePct}%` }} /></div>
          </div>
        );
      })}
      <small className="faint">Üstteki çubuk gerçekleşen dağılımı, alttaki ince çubuk hedef payı gösterir. Hedef, 30 günlük bir ortalamadır; günlük zorunluluk değildir.</small>
    </div>
  );
}

export default function Dashboard() {
  const { projectId, project } = useApp();
  const [days, setDays] = useState(30);
  const st = useLoad(() => api.get(`/dashboard${qs({ projectId, days })}`), [projectId, days]);
  return (
    <div className="page">
      <PageHead title="Dashboard" actions={<select className="input" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Tarih aralığı">{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Son {d} gün</option>)}</select>}>
        Yalnızca gerçek veriler gösterilir. Bir taramada hiçbir şey bulunmadıysa “0” gerçek bir sonuçtur; bilinemeyen bir değer (örneğin Search Console’a bağlı olmayan sitenin trafiği) “0” yerine nedeniyle birlikte yazılır.
      </PageHead>
      <Async state={st}>{(d) => (
        <>
          {(!project || project.mode === 'archive') && <Alert kind="info" title="Araştırma ve Arşiv Modu">Alan adı bağlı değil. Makaleler yalnızca bu panelin veritabanında saklanır; hiçbir sitede yayımlanmaz. Bir WordPress sitesi bağlamak için <Link to="/sites">Web Sitelerim</Link> sayfasını kullanın.</Alert>}
          {d.botsPaused && <Alert kind="warn" title="Botlar duraklatıldı">Otomatik işler çalışmaz. <Link to="/limits">Günlük Çalışma Ayarları</Link> sayfasından devam ettirebilirsiniz.</Alert>}
          <div className="grid cols-metrics">{d.metrics.map((m) => <Metric key={m.key} m={m} />)}</div>
          {d.empty ? (
            <Card><Empty title="Henüz makale yok" action={<Link className="btn primary" to="/articles/new">İlk makaleyi ekle</Link>}>Makaleleri Makale Arşivi’nden elle ekleyebilirsiniz. Yapay zekâ ile üretim için <Link to="/opportunities">İçerik Fırsatları</Link> sayfasından bir fikir seçip “Makale yaz”a basabilirsiniz; haber ve SEO araştırması Dünya Gündemi ve Anahtar Kelime Araştırması sayfalarındadır.</Empty></Card>
          ) : (
            <div className="grid g2">
              <Card title="Günlük üretim"><Series data={d.charts.dailyProduction} label="Makale" /></Card>
              <Card title="Kategori dağılımı"><CategoryShare cats={d.charts.categoryShare} /></Card>
              <Card title="Makale güncellemeleri"><Series data={d.charts.articleUpdates} label="Yeni sürüm" /></Card>
              <Card title="API giderleri (USD)"><Series data={d.charts.apiCosts} kind="area" label="USD" fmt={(v) => usd(v)} /></Card>
            </div>
          )}
          <div className="grid g3">
            <Card flat title="SEO fırsatları (puan dağılımı)"><Buckets c={d.charts.seoOpportunities} empty="Henüz puanlanmış fikir yok. İçerik Fırsatları sayfasından “Yenile ve puanla”." foot={`${d.charts.seoOpportunities.eligible} uygun / ${d.charts.seoOpportunities.total} fikir`} /></Card>
            <Card flat title="Aranma hacmi dağılımı"><Buckets c={d.charts.searchVolume} empty="Gerçek aranma verisi henüz çekilmedi." foot={`${d.charts.searchVolume.withData} anahtar kelimenin verisi var`} /></Card>
            <Card flat title="Organik trafik"><Organic o={d.charts.organicTraffic} /></Card>
          </div>
          <div className="grid g2">
            <Card title="Bugünün çalışma limitleri" actions={<Link className="btn sm" to="/limits">Düzenle</Link>}>
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>İş türü</th><th className="num">Limit</th><th className="num">Yapılan</th><th className="num">Kalan</th></tr></thead>
                <tbody>{d.limitsToday.map((l) => <tr key={l.workType}><td>{l.label}</td><td className="num">{l.limit === 0 ? <Badge kind="bad">Durduruldu</Badge> : num(l.limit)}</td><td className="num">{num(l.done)}</td><td className="num">{num(l.remaining)}</td></tr>)}</tbody></table></div>
              <small className="faint">Gün: {d.day} ({d.timezone})</small>
            </Card>
            <Card title="Okunmamış bildirimler" actions={<Link className="btn sm" to="/notifications">Tümü</Link>}>
              {d.notifications.latest.length === 0 ? <p className="muted">Okunmamış bildirim yok.</p> : (
                <div className="stack">{d.notifications.latest.map((n) => <div key={n.id} className="row between"><span><Badge kind={n.severity === 'critical' ? 'bad' : n.severity === 'warning' ? 'warn' : 'info'}>{n.severity}</Badge> {n.title}</span><small className="faint">{dt(n.createdAt)}</small></div>)}</div>
              )}
            </Card>
          </div>
        </>
      )}</Async>
    </div>
  );
}
