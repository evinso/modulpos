import { useState } from 'react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, ScoreBar, useLoad } from '../ui.jsx';
import { num, shortDay, usd } from '../format.js';

const SEV = { warn: ['Dikkat', 'warn'], info: ['Bilgi', 'info'] };
const OP = { article_write: 'makale yazımı', fact_check: 'doğruluk kontrolü', adsense_review: 'AdSense incelemesi', serp_organic: 'SERP analizi', keyword_overview: 'anahtar kelime verisi', complete: 'diğer model çağrısı' };

/** Maliyet analizi: where the money goes and what could be done about it, each suggestion with its numbers and with what it cannot know */
export default function CostAnalysis() {
  const [days, setDays] = useState(30);
  const st = useLoad(() => api.get(`/costs/analysis?days=${days}`), [days]);
  return (
    <Card flat title="Maliyet analizi ve öneriler" actions={<select className="input" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Analiz aralığı">{[7, 30, 90].map((x) => <option key={x} value={x}>Son {x} gün</option>)}</select>}>
      <Async state={st}>{(a) => (
        <div className="stack">
          <div className="grid g4">
            <div className="metric"><span className="l">Bilinen toplam (son {a.days} gün)</span><span className="v">{usd(a.totals.knownUsd)}</span><span className="n">{num(a.totals.requests)} istek{a.totals.unknownCalls > 0 ? ` · +${a.totals.unknownCalls} çağrının maliyeti bilinmiyor` : ''}</span></div>
            <div className="metric"><span className="l">Bu ay (bilinen)</span><span className="v">{usd(a.totals.monthKnownUsd)}</span><span className="n">{a.biggest ? `en büyük pay: ${a.biggest.provider}${a.biggest.sharePct !== null ? ` %${a.biggest.sharePct}` : ''}` : 'harcama yok'}</span></div>
            <div className="metric"><span className="l">Makale başına (yazım + kontroller)</span><span className="v">{a.perArticle.avgUsd === null ? 'Bilinmiyor' : usd(a.perArticle.avgUsd)}</span><span className="n">{a.perArticle.pricedRuns} fiyatı bilinen yazım{a.perArticle.unknownRuns ? ` · ${a.perArticle.unknownRuns} tanesinde bilinmeyen çağrı var` : ''}{a.perArticle.avgUsd !== null ? ` · ${usd(a.perArticle.minUsd)}–${usd(a.perArticle.maxUsd)}` : ''}</span></div>
            <div className="metric"><span className="l">Ay sonu tahmini</span><span className="v">{a.forecast ? usd(a.forecast.monthEndUsd) : 'Veri yetersiz'}</span><span className="n">{a.forecast ? 'tahmindir (son 7 günün ortalaması)' : 'en az 3 harcama günü gerekir'}</span></div>
          </div>
          {a.budgets.length > 0 && <div><strong>Bütçeler</strong><div className="stack" style={{ marginTop: 6 }}>{a.budgets.map((b) => <div key={b.label} className="row">{b.label}: {usd(b.usedUsd)} / {usd(b.limitUsd)}<ScoreBar value={b.pct === null ? null : Math.min(100, b.pct)} kind={b.pct >= 100 ? 'bad' : b.pct >= 80 ? 'warn' : 'ok'} label={`%${b.pct}`} /><small className="faint">%{b.pct}{b.unknownCalls ? ` · +${b.unknownCalls} bilinmeyen` : ''}</small></div>)}</div></div>}
          <div><strong>Öneriler</strong>
            {a.recommendations.length === 0 ? <p className="muted">Şu an önerilecek bir şey yok (ya da öneri üretmeye yetecek veri yok).</p> : (
              <div className="stack" style={{ marginTop: 6 }}>{a.recommendations.map((r) => (
                <Alert key={r.code} kind={r.severity === 'warn' ? 'warn' : 'info'} title={r.title}>
                  <div>{r.text}</div>{r.action && <div><strong>Ne yapılabilir:</strong> {r.action}</div>}<div className="faint"><strong>Bilemediğimiz:</strong> {r.cannotKnow}</div></Alert>))}</div>)}</div>
          {a.byOperation.length > 0 && <div><strong>İşleme göre</strong>
            <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>Sağlayıcı</th><th>İşlem</th><th className="num">Maliyet</th><th className="num">İstek</th><th className="num">Hata</th></tr></thead>
              <tbody>{a.byOperation.slice(0, 12).map((o) => <tr key={`${o.provider}${o.operation}`}><td>{o.provider}</td><td>{OP[o.operation] || o.operation || '—'}</td><td className="num">{usd(o.costUsd)}{o.unknownCalls > 0 && <div className="faint">+{o.unknownCalls} <Badge>Bilinmiyor</Badge></div>}</td><td className="num">{num(o.requests)}</td><td className="num">{o.errors || ''}</td></tr>)}</tbody></table></div></div>}
          {a.forecast && <small className="faint">{a.forecast.basis}</small>}
          {a.caveats.map((c, i) => <small key={i} className="faint">{c}</small>)}
        </div>
      )}</Async>
    </Card>
  );
}
