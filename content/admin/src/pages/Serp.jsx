import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Modal, NeedsProject, PageHead, ScoreBar, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, usd } from '../format.js';

const KIND = { official: ['Resmî', 'info'], big: ['Büyük yayıncı', 'warn'], forum: ['Forum', 'ok'], independent: ['Bağımsız site', 'ok'] };
const kindOfScore = (v) => (v >= 55 ? 'bad' : v >= 30 ? 'warn' : 'ok');

function Detail({ a, onClose, canPaid, onRerun, busy }) {
  return (
    <Modal wide title={`“${a.keyword}” — organik rekabet analizi`} onClose={onClose}>
      <div className="stack">
        <Alert kind="info">{a.disclaimer}</Alert>
        <div className="row"><span>Rekabet tahmini:</span>{a.competition === null ? <Badge>Organik sonuç bulunamadı</Badge> : <><ScoreBar value={a.competition} kind={kindOfScore(a.competition)} /><Badge kind={kindOfScore(a.competition)}>{a.label}</Badge></>}
          <span className="faint">· {dt(a.fetchedAt)} · maliyet {a.costUsd === null ? 'Bilinmiyor' : usd(a.costUsd, 4)}</span>{canPaid && <button className="btn sm" disabled={busy} onClick={onRerun}><RefreshCw size={14} />Yeniden analiz et (ücretli)</button>}</div>
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <Card flat title="Puanı oluşturan etkenler">{a.factors.length === 0 ? <p className="muted">Etken yok.</p> : <div className="stack">{a.factors.map((f) => <div key={f.key}><div className="row between"><span>{f.label} <span className="faint">(ağırlık {f.weight})</span></span><strong>{f.value}</strong></div><div className={`bar ${kindOfScore(f.value)}`}><i style={{ width: `${f.value}%` }} /></div><small className="faint">{f.note}</small></div>)}
            {a.reducers.map((r) => <div key={r.key} className="row between"><span>{r.label}<div className="faint">{r.note}</div></span><Badge kind="ok">{r.delta}</Badge></div>)}</div>}</Card>
          <Card flat title="Aranan kullanıcı soruları">{a.questions.length === 0 ? <p className="muted">Soru verisi yok.</p> : <ul style={{ margin: 0, paddingLeft: 18 }}>{a.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
            {a.related.length > 0 && <><h3 style={{ margin: '12px 0 6px' }}>İlgili aramalar</h3><div className="row">{a.related.map((q, i) => <Badge key={i}>{q}</Badge>)}</div></>}
            {a.features.length > 0 && <><h3 style={{ margin: '12px 0 6px' }}>Sonuç sayfası özellikleri</h3><div className="row">{a.features.map((q) => <Badge key={q} kind="info">{q}</Badge>)}</div></>}</Card>
        </div>
        <Card flat title="İlk sonuçlar"><div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><thead><tr><th className="num">#</th><th>Alan adı</th><th>Tür</th><th>Başlık</th></tr></thead>
          <tbody>{a.results.map((r) => <tr key={r.rank}><td className="num">{r.rank}</td><td>{r.domain}</td><td><Badge kind={KIND[r.kind][1]}>{KIND[r.kind][0]}</Badge></td><td><a href={r.url} target="_blank" rel="noopener noreferrer nofollow">{r.title}</a></td></tr>)}</tbody></table></div></Card>
      </div>
    </Modal>
  );
}

export default function Serp() {
  const { projectId, can, toast } = useApp();
  const st = useLoad(() => (projectId ? api.get(`/serp?projectId=${projectId}`) : Promise.resolve(null)), [projectId]);
  const kws = useLoad(() => (projectId ? api.get(`/keywords${qs({ projectId, state: 'found', pageSize: 100, sort: 'volume' })}`) : Promise.resolve(null)), [projectId]);
  const [open, setOpen] = useState(null); const [pick, setPick] = useState('');
  const [run, busy] = useAction();
  if (!projectId) return <NeedsProject />;
  const paid = can('research.paid');
  const analyze = async (keywordId, force) => { const r = await run(() => api.post(`/keywords/${keywordId}/serp`, { force })); if (r) { if (r.stopped) toast(r.stopped, 'bad'); else if (r.analysis) setOpen({ ...r.analysis, keyword: (kws.data && kws.data.items.find((k) => k.id === keywordId) || {}).keyword || (st.data && st.data.analyses.find((x) => x.keywordId === keywordId) || {}).keyword || '' }); st.reload(); kws.reload(); } };
  const analyzed = new Set(st.data ? st.data.analyses.map((x) => x.keywordId) : []);
  const options = kws.data ? kws.data.items.filter((k) => !analyzed.has(k.id)) : [];
  return (
    <div className="page">
      <PageHead title="SEO Rekabet Analizi">Gerçek Google ilk-10 sonuçları DataForSEO’dan alınır; büyük yayıncı, resmî kaynak, forum ve bağımsız site oranlarından yeni bir site için rekabet tahmini çıkarılır. <strong>Bu puan Google’ın resmî zorluk metriği değildir</strong>; her etken ve ağırlığı görünür. Her analiz ücretlidir (yaklaşık 0,003 $, gerçek tutar kayda geçer) ve günlük SERP limitinden düşer; aynı kelime önbellek süresi içinde tekrar sorgulanmaz.</PageHead>
      {paid && <Card flat title="Yeni analiz"><div className="row"><select className="input" style={{ maxWidth: 420 }} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Anahtar kelime"><option value="">Verisi olan anahtar kelimelerden seçin…</option>{options.map((k) => <option key={k.id} value={k.id}>{k.keyword} ({k.metrics.searchVolume ?? '—'} arama)</option>)}</select>
        <button className="btn primary" disabled={!pick || busy} onClick={() => analyze(pick, false)}>Analiz et (ücretli)</button></div>{options.length === 0 && <small className="faint">Analiz edilecek, verisi olan kelime yok. Önce Anahtar Kelime Araştırması’nda veri çekin.</small>}</Card>}
      <Async state={st}>{(d) => d && (d.analyses.length === 0 ? <Card><Empty title="Henüz SERP analizi yok" /></Card> : (
        <Card flat><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Anahtar kelime</th><th>Organik rekabet (tahmin)</th><th>Sonuç sayfası özellikleri</th><th>Tarih</th><th className="num">Maliyet</th><th /></tr></thead>
          <tbody>{d.analyses.map((a) => <tr key={a.id}><td><strong>{a.keyword}</strong> <span className="faint">{a.country}</span></td>
            <td>{a.competition === null ? <Badge>Organik sonuç yok</Badge> : <div className="row" style={{ flexWrap: 'nowrap' }}><ScoreBar value={a.competition} kind={kindOfScore(a.competition)} /><Badge kind={kindOfScore(a.competition)}>{a.label}</Badge></div>}</td>
            <td className="faint">{a.features.join(', ') || '—'}</td><td className="faint">{dt(a.fetchedAt)}</td><td className="num">{a.costUsd === null ? 'Bilinmiyor' : usd(a.costUsd, 4)}</td><td className="num"><button className="btn sm" onClick={() => setOpen(a)}>Ayrıntı</button></td></tr>)}</tbody></table></div></Card>
      ))}</Async>
      {open && <Detail a={open} onClose={() => setOpen(null)} canPaid={paid} busy={busy} onRerun={() => analyze(open.keywordId, true)} />}
    </div>
  );
}
