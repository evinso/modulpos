import { useEffect, useState } from 'react';
import { Eraser } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Check, Field, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, num } from '../format.js';

const RET = [
  ['ideaDays', 'Kullanılmayan fikirler (gün)', 8, 90, 'Haberi bu kadar günden eski olan, kimsenin kullanmadığı fikirler silinir. En az 8: bir olay 7 güne kadar yeni fikir üretebilir.'],
  ['writtenDays', 'Makalesi yazılmış fikirler (gün)', 0, 30, 'Makalesi yazılan fikir listede bu kadar gün görünür, sonra silinir (makale kalır).'],
  ['keywordDays', 'Kullanılmayan anahtar kelimeler (gün)', 3, 365, 'Hiçbir fikre bağlı olmayan, sistemin bulduğu anahtar kelimeler.'],
  ['researchedKeywordDays', 'Verisi çekilmiş olanlar (gün)', 7, 365, 'Gerçek verisi çekilmiş ama kullanılmayan kelimeler biraz daha uzun tutulur.'],
  ['nicheDays', 'Karara bağlanmayan niş önerileri (gün)', 7, 180, 'Haberler desteklemeye devam ederse öneri kendiliğinden yeniden gelir.'],
];

const Bar = ({ n, max }) => <div style={{ background: 'var(--panel-2)', borderRadius: 4, height: 8, flex: 1, minWidth: 40 }}><div style={{ width: `${max ? Math.max(n ? 4 : 0, Math.round((n / max) * 100)) : 0}%`, background: 'var(--accent)', height: 8, borderRadius: 4 }} /></div>;
const Tile = ({ label, value, note }) => <div className="card flat" style={{ padding: 12 }}><div className="faint" style={{ fontSize: 12 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>{note && <small className="faint">{note}</small>}</div>;

/** How what the system finds becomes articles, the waves of fresh news (open ideas by the age of their news), and the housekeeping that keeps nothing for ever. One simple card. */
export default function FlowPanel({ projectId }) {
  const { can, confirm, toast } = useApp(); const canEdit = can('bots.control');
  const st = useLoad(() => api.get(`/automation/flow${qs({ projectId })}`), [projectId]);
  const [run, busy] = useAction();
  const [fresh, setFresh] = useState(''); const [ret, setRet] = useState(null);
  useEffect(() => { const d = st.data; if (d) { setFresh(String(d.fresh.hours)); setRet({ ...d.cleanup.rules }); } }, [st.data]);
  const dirty = (d) => ret && (String(d.fresh.hours) !== String(fresh) || JSON.stringify(ret) !== JSON.stringify(d.cleanup.rules));
  const save = async () => { if (await run(() => api.put('/automation/flow', { projectId, freshHours: Number(fresh), retention: Object.fromEntries(Object.entries(ret).map(([k, v]) => [k, k === 'auto' ? !!v : Number(v)])) }), 'Kaydedildi')) st.reload(); };
  const clean = async (d) => {
    const w = d.cleanup.would;
    if (!(await confirm({ title: 'Şimdi temizlensin mi?', body: `${w.usedIdeas} kullanılmış fikir, ${w.staleIdeas} eski fikir, ${w.keywords} anahtar kelime ve ${w.nicheSuggestions} niş önerisi silinecek. Makaleler, kısa listedeki / yazılmakta olan fikirler ve elle yazdığınız hiçbir şey silinmez. Bu geri alınamaz.`, confirmText: 'Temizle', danger: true }))) return;
    const r = await run(() => api.post('/automation/cleanup', { projectId }), 'Temizlendi'); if (r) { toast(`Silindi: ${r.removed.usedIdeas + r.removed.staleIdeas} fikir, ${r.removed.keywords} anahtar kelime, ${r.removed.nicheSuggestions} niş önerisi`); st.reload(); }
  };
  return (
    <Card title="Bulgu akışı ve zaman dalgası">
      <Async state={st}>{(d) => {
        const maxW = Math.max(1, ...d.waves.map((w) => w.ideas)); const wait = d.ideas.open - d.ideas.eligible; const w = d.cleanup.would; const nothing = !w.usedIdeas && !w.staleIdeas && !w.keywords && !w.nicheSuggestions;
        return (
          <div className="stack">
            <p className="muted">Sistem haberleri ve anahtar kelimeleri bulur, fikirlere çevirir ve puanlar; <strong>yazılmaya hazır</strong> olanlardan günlük yerler kadarını yazar. Haberde zaman önemlidir: fikir yaşlandıkça sıralamadan düşer, süresi dolunca silinir; böylece eski bulgular birikmez.</p>
            <div className="grid g3">
              <Tile label="Bulunan haber (son 24 saat)" value={num(d.found.newsLast24h)} note={`${num(d.found.relevantLast24h)} tanesi nişe uygun`} />
              <Tile label="Nişe uygun olay (son 7 gün)" value={num(d.found.eventsLast7d)} note={`${num(d.ideas.open)} açık fikir`} />
              <Tile label="Yazılmaya hazır fikir" value={num(d.ideas.eligible)} note={`${num(d.ideas.shortlisted)} kısa listede · ${num(d.ideas.queued)} yazılıyor${d.ideas.fromFreshLane ? ` · ${num(d.ideas.fromFreshLane)} taze haber hattından` : ''}`} />
              <Tile label="Bugün yazılan makale" value={`${num(d.today.done)} / ${num(d.today.limit)}`} note={d.today.remaining ? `${num(d.today.remaining)} yer kaldı` : 'bugünün yeri doldu'} />
              <Tile label="Anahtar kelime" value={num(d.found.keywords)} note={`${num(d.found.keywordsWithData)} tanesinin gerçek verisi var`} />
              <Tile label="Makale botu" value={d.writer.enabled ? 'Açık' : 'Kapalı'} note={d.writer.enabled ? (d.writer.nextRunAt ? `sıradaki çalışma: ${dt(d.writer.nextRunAt)}` : `${d.writer.windowStart}–${d.writer.windowEnd} arası çalışır`) : 'Otomasyon seçeneklerinden “Makale yazımı”nı açın'} />
            </div>

            {d.today.held && (
              <Alert kind="warn" title={`Bugün ${num(d.today.held.places)} yer var ve ${num(d.today.held.ready)} fikir hazır, ama hiçbiri yazılamıyor`}>
                <span data-testid="flow-held">{d.today.held.note || 'Hazır fikirler bugün seçilemedi.'}</span>
                {d.today.held.byCategory.length > 0 && <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>{d.today.held.byCategory.map((h) => <li key={h.category}>{h.category}: {num(h.count)} hazır fikir, günlük sınır {h.limit}</li>)}</ul>}
                {d.today.held.byCategory.length > 0 && <small className="faint" style={{ display: 'block', marginTop: 4 }}>Bu bir hata değil, koyduğunuz kategori sınırının sonucudur. Sınırı artırmak ya da boş bırakmak için <Link to="/automation?tab=limitler">Günlük limitler</Link> sekmesindeki Kategori limitlerine bakın.</small>}
              </Alert>
            )}

            <div>
              <strong>Zaman dalgası</strong> <small className="faint">açık fikirler, haberinin yaşına göre</small>
              <div className="stack" style={{ marginTop: 6 }}>{d.waves.map((x) => (
                <div key={x.key} className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'center' }}>
                  <span style={{ width: 120, flex: 'none' }}>{x.label}</span><Bar n={x.ideas} max={maxW} /><span style={{ width: 150, flex: 'none', textAlign: 'right' }}>{num(x.ideas)} fikir · <strong>{num(x.eligible)} hazır</strong></span>
                </div>))}</div>
            </div>

            {wait > 0 && (
              <div>
                <strong>Neden {num(wait)} fikir bekliyor?</strong>
                {d.blockers.length === 0 ? <small className="faint"> Henüz puanlanmamış olabilirler (fırsat puanlama botu çalışınca görünür).</small> : (
                  <ul className="stack" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{d.blockers.map((b) => <li key={b.reason}><Badge>{num(b.count)}</Badge> {b.example}{b.count > 1 && /\d/.test(b.example) ? ' (ve benzerleri)' : ''}</li>)}</ul>)}
              </div>
            )}

            <div className="grid g3">
              <Field label="Taze haber penceresi (saat)" hint="Son görülmesinden bu kadar saat geçmemiş ve 2+ kaynakta (ya da çok güvenilir tek kaynakta) çıkan olay, aranma hacmi ve rekabet verisi beklenmeden yazılabilir; puanı en az 60 olmalı. 0 = kapalı."><input className="input num" type="number" min={0} max={168} value={fresh} onChange={(e) => setFresh(e.target.value)} disabled={!canEdit} aria-label="Taze haber penceresi" /></Field>
            </div>

            <div className="stack">
              <Check checked={!!(ret && ret.auto)} onChange={(v) => setRet((x) => ({ ...x, auto: v }))} disabled={!canEdit}>Kullanılmayan bulgular kendiliğinden silinsin (günde bir kez)</Check>
              <small className="faint">Kısa listedeki ve yazılmakta olan fikirler, elle yazdıklarınız, makaleler ve kabul ettiğiniz niş önerileri <strong>hiçbir zaman</strong> silinmez.</small>
              {ret && <details><summary className="faint">Süreleri değiştir</summary>
                <div className="grid g3" style={{ marginTop: 8 }}>{RET.map(([k, label, min, max, hint]) => <Field key={k} label={label} hint={hint}><input className="input num" type="number" min={min} max={max} value={ret[k]} onChange={(e) => setRet((x) => ({ ...x, [k]: e.target.value }))} disabled={!canEdit} aria-label={label} /></Field>)}</div></details>}
              <div className="row between">
                <small className="faint">{nothing ? 'Şu an silinecek bir şey yok.' : `Şu an silinecek: ${num(w.usedIdeas + w.staleIdeas)} fikir, ${num(w.keywords)} anahtar kelime, ${num(w.nicheSuggestions)} niş önerisi.`}{d.cleanup.last ? ` Son temizlik: ${dt(d.cleanup.last.ranAt)}.` : ' Henüz temizlik yapılmadı.'}</small>
                {canEdit && <div className="row"><button className="btn" disabled={busy || nothing} onClick={() => clean(d)}><Eraser size={15} />Şimdi temizle</button><button className="btn primary" disabled={busy || !dirty(d)} onClick={save}>Kaydet</button></div>}
              </div>
              {!d.cleanup.auto && <Alert kind="warn">Otomatik temizlik kapalı: bulgular birikir. Yukarıdaki kutuyu işaretleyip kaydedin.</Alert>}
            </div>
          </div>
        );
      }}</Async>
    </Card>
  );
}
