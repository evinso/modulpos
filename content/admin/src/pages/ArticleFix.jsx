import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Badge, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, usd } from '../format.js';

const RESULT = { approved: ['Düzeltildi ve onaylandı', 'ok'], fixed: ['Düzeltildi, onay sizde', 'ok'], unresolved: ['Çözülemedi', 'warn'], needs_person: ['Karar sizde', 'warn'], error: ['Yarıda kaldı', 'bad'] };

/**
 * The article-fixer bot on the "Yayına hazır mı?" card: a button to hand THIS article's blocking problems to the bot (a queued job; it spends the day's "otomatik düzeltme" places and model money)
 * and what the bot did so far. The bot never relaxes a check and leaves what only a person can decide (duplicate, excluded topic, no source, AdSense "blocked") to the person.
 */
export default function ArticleFix({ art, ready, dirty, onChanged }) {
  const { can } = useApp();
  const hist = useLoad(() => api.get(`/articles/${art.id}/fixes`), [art.id, art.currentVersion, art.status]);
  const [run, busy] = useAction();
  const [waiting, setWaiting] = useState(null);                       // the number of attempts when the job was queued: polls until a new one shows
  useEffect(() => {
    if (waiting === null) return undefined;
    const t0 = Date.now();
    const iv = setInterval(async () => {
      if (Date.now() - t0 > 240000) { setWaiting(null); return; }
      try { const h = await api.get(`/articles/${art.id}/fixes`); if (h.items.length > waiting) { setWaiting(null); hist.reload(); onChanged(); } } catch { /* the next tick asks again */ }
    }, 5000);
    return () => clearInterval(iv);
  }, [waiting, art.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = hist.data;
  const aiDraft = art.createdBy === 'ai' && art.status === 'needs_review';
  const blocked = ready && !ready.ready && ready.problems.some((p) => p.blocking);
  if (!d || (!aiDraft && d.items.length === 0)) return null;
  const ask = async () => { if (await run(() => api.post(`/articles/${art.id}/fix`), 'Düzeltme kuyruğa alındı; bitince sonuç burada görünür (bildirim de gelir)')) setWaiting(d.items.length); };
  return (
    <div className="stack" style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <div className="row between">
        <strong><Wrench size={15} style={{ verticalAlign: '-2px' }} /> Düzeltme botu</strong>
        {can('research.paid') && aiDraft && blocked && <button className="btn sm" disabled={busy || dirty || waiting !== null} onClick={ask} title="Eksikleri bota düzelttirir; model ücreti harcar">{waiting !== null ? 'Düzeltiliyor…' : 'Eksikleri bota düzelttir'}</button>}
      </div>
      {aiDraft && blocked && <small className="faint">Bot, çalışmamış kontrolleri yeniden çalıştırır, eksik görsel/kategoriyi ekler, kaynakların desteklemediği iddia ya da düşük kalite gibi metin sorunlarını modelle düzeltir ve aynı kontrollerle yeniden yargılar. Hiçbir kuralı gevşetmez; tekrar eden makale, kapsam dışı konu, kaynaksız makale ya da “yayınlanamaz” AdSense sınıfı gibi sizin kararınız gerekenlere dokunmaz. Bu sürümde en çok {d.max} deneme yapar ({d.attempts} yapıldı); her düzeltme yeni bir sürüm olarak kaydedilir, eskisine dönebilirsiniz.{dirty ? ' Önce kaydedilmemiş değişikliği kaydedin.' : ''}</small>}
      {d.parked && <Alert kind="warn">Bot bu makalede bir kişinin kararını bekliyor; makaleyi düzenlediğinizde yeniden dener.</Alert>}
      {d.items.slice(0, 3).map((x) => (
        <div key={x.id} className="stack" style={{ gap: 2 }}>
          <div className="row" style={{ gap: 8 }}><Badge kind={(RESULT[x.result] || ['', ''])[1]}>{(RESULT[x.result] || [x.result])[0]}</Badge><small className="faint">{dt(x.createdAt)} · {x.trigger === 'manual' ? 'elle istendi' : 'zamanlayıcı'} · v{x.versionBefore}{x.versionAfter && x.versionAfter !== x.versionBefore ? ` → v${x.versionAfter}` : ''} · {x.costUsd === null ? 'maliyet bilinmiyor' : usd(x.costUsd, 4)}</small></div>
          {x.steps.map((s, i) => <small key={i} className="faint" style={{ marginLeft: 8 }}>{s.ok ? '✓' : '✗'} {s.note}</small>)}
          {x.remaining.length > 0 && <small style={{ marginLeft: 8, color: 'var(--warn)' }}>Kalan: {x.remaining.map((p) => p.message).join('; ')}</small>}
        </div>))}
    </div>
  );
}
