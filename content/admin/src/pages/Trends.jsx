import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, NeedsProject, PageHead, ScoreBar, useApp, useLoad } from '../ui.jsx';
import { dt, num, shortDay } from '../format.js';

export default function Trends() {
  const { projectId } = useApp();
  const [hours, setHours] = useState(48);
  const st = useLoad(() => (projectId ? api.get(`/trends${qs({ projectId, hours })}`) : Promise.resolve(null)), [projectId, hours]);
  if (!projectId) return <NeedsProject />;
  return (
    <div className="page">
      <PageHead title="Trend Analizi" actions={<select className="input" style={{ width: 'auto' }} value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Aralık">{[[24, 'Son 24 saat'], [48, 'Son 48 saat'], [72, 'Son 3 gün'], [168, 'Son 7 gün']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}>
        Trend, gerçek haber sayılarından hesaplanır: bir olayı kaç farklı kaynağın verdiği, son 12 saatteki haber sayısı ve tazelik. Arama trendi yalnızca DataForSEO’dan aylık arama geçmişi alınmış anahtar kelimeler için görünür; hiçbir değer uydurulmaz.
      </PageHead>
      <Async state={st}>{(d) => d && (
        <>
          <Card title="En hızlı yükselen olaylar">
            {d.clusters.length === 0 ? <Empty title="Bu aralıkta nişe uygun olay yok">Dünya Gündemi sayfasından “Şimdi tara” ile kaynakları okuyun.</Empty> : (
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Olay</th><th>Kategori</th><th>Trend</th><th className="num">Kaynak</th><th className="num">Son 12 s</th><th>Son haber</th><th>Nedenler</th></tr></thead>
                <tbody>{d.clusters.map((c) => (
                  <tr key={c.id}><td style={{ maxWidth: 380 }}><strong>{c.title}</strong></td><td>{c.categoryName || '—'}</td>
                    <td><div className="row" style={{ flexWrap: 'nowrap' }}><ScoreBar value={c.score} /><Badge kind={c.score >= 60 ? 'ok' : c.score >= 30 ? 'warn' : ''}>{c.label}</Badge></div></td>
                    <td className="num">{c.sourceCount}</td><td className="num">{c.recent12}</td><td className="faint">{dt(c.lastSeenAt)}</td>
                    <td className="faint">{c.factors.map((f) => `${f.label}: ${f.value}/${f.max} (${f.note})`).join(' · ')}</td></tr>))}</tbody></table></div>)}
          </Card>
          <div className="grid g2">
            <Card title="Günlük haber (son 14 gün)">
              <div className="chartbox"><ResponsiveContainer width="100%" height="100%"><BarChart data={d.daily.map((x) => ({ ...x, label: shortDay(x.day) }))} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--line-soft)" /><XAxis dataKey="label" stroke="var(--text-3)" fontSize={11} /><YAxis stroke="var(--text-3)" fontSize={11} allowDecimals={false} /><Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }} />
                <Bar dataKey="items" name="Tüm haber" fill="var(--line)" radius={[4, 4, 0, 0]} /><Bar dataKey="relevant" name="Nişe uygun" fill="var(--accent)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </Card>
            <Card title="Kategoriye göre nişe uygun olay">
              {d.byCategory.length === 0 ? <p className="muted">Veri yok.</p> : <div className="stack">{d.byCategory.map((c) => <div key={c.name} className="row between"><span>{c.name}</span><strong>{num(c.n)}</strong></div>)}</div>}
            </Card>
          </div>
          <Card title="Yükselen anahtar kelimeler (arama trendi)">
            {d.keywordTrends.length === 0 ? <Alert kind="info">Henüz arama geçmişi olan anahtar kelime yok. Anahtar Kelime Araştırması sayfasında DataForSEO verisi çekildiğinde, son 3 ayın önceki 3 aya göre değişimi burada listelenir.</Alert> : (
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Anahtar kelime</th><th className="num">Aylık arama</th><th className="num">Değişim (son 3 ay / önceki 3 ay)</th></tr></thead>
                <tbody>{d.keywordTrends.map((k) => <tr key={k.id}><td>{k.keyword} <span className="faint">{k.country}</span></td><td className="num">{num(k.searchVolume)}</td><td className="num"><Badge kind={k.trendPct >= 0 ? 'ok' : 'bad'}>{k.trendPct > 0 ? '+' : ''}{k.trendPct}%</Badge></td></tr>)}</tbody></table></div>)}
          </Card>
        </>
      )}</Async>
    </div>
  );
}
