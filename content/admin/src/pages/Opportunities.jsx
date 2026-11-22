import { Fragment, useEffect, useState } from 'react';
import { Calculator, ListChecks, PenLine, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Field, Modal, NeedsProject, PageHead, Pager, ScoreBar, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, num } from '../format.js';

const ST = { new: ['Yeni', ''], shortlisted: ['Kısa listede', 'info'], rejected: ['Reddedildi', 'bad'], queued: ['Yazım kuyruğunda', 'ok'], written: ['Yazıldı', 'ok'] };
const PARTS = [['trend', 'Trend'], ['competition', 'Rekabet fırsatı'], ['demand', 'Aranma talebi'], ['relevance', 'Nişe uygunluk'], ['source', 'Kaynak güveni']];

function Explain({ o }) {
  const c = o.explain.components || {};
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <div className="stack">
        {PARTS.map(([k, l]) => <div key={k}><div className="row between"><span>{l} <span className="faint">(ağırlık %{o.weights[k]})</span></span><ScoreBar value={o[k]} /></div><small className="faint">{c[k] ? c[k].note : ''}{k === 'demand' && c.demand && c.demand.volume !== null ? ` · ${num(c.demand.volume)} aranma/ay` : ''}{k === 'competition' && c.competition && c.competition.estimate !== null ? ` · organik rekabet tahmini ${c.competition.estimate}/100` : ''}{k === 'trend' && c.trend ? ` · haber ${c.trend.news}${c.trend.keyword !== null ? `, arama ${c.trend.keyword}` : ''}` : ''}</small></div>)}
      </div>
      <div className="stack">
        <div><strong>Toplam puan:</strong> {o.total === null ? <Badge>Verilmedi</Badge> : <Badge kind={o.eligible ? 'ok' : 'warn'}>{o.total}</Badge>} {o.provisional !== null && o.total === null && (o.partial ? <><Badge kind={o.eligible ? 'ok' : 'warn'}>kısmi {o.provisional}</Badge> <span className="faint">(aranma hacmi verisi olmadan, dört bileşenin ortalaması)</span></> : <span className="faint">(geçici: {o.provisional})</span>)}</div>
        <div><strong>Anahtar kelime:</strong> {o.keyword || <span className="faint">gerçek verisi olan kelime yok</span>}</div>
        <div><strong>Minimum puan:</strong> {o.explain.minScore}</div>
        {o.explain.note && <small className="faint">{o.explain.note}</small>}
        {!o.eligible && <Alert kind="warn" title="Neden yazıma alınmadı">{o.ineligibleReason}</Alert>}
      </div>
    </div>
  );
}

const STEP = { sources: 'Kaynak sayfaları okunuyor…', writing: 'Makale yazılıyor…', checking: 'Doğruluk ve AdSense kontrolleri yapılıyor…' };

/** asks which vendor writes, says what will happen and what it costs, then starts the background run */
function WriteModal({ o, projectId, onClose, onStarted }) {
  const st = useLoad(() => api.get(`/writer/status?projectId=${projectId}`), [projectId]);
  const [pick, setPick] = useState(''); const [run, busy] = useAction();
  const go = async (d) => { const r = await run(() => api.post(`/opportunities/${o.id}/write`, { provider: pick || d.picks.writer })); if (r) { onStarted(r); onClose(); } };
  return (
    <Modal wide title="Bu fikir için makale yaz" onClose={onClose}>
      <Async state={st}>{(d) => (
        <div className="stack">
          <div><strong>{o.title}</strong><div className="faint">Odak anahtar kelime: {o.keyword} · {o.sourceCount || 1} kaynak</div></div>
          {!d.ready && <Alert kind="bad" title="Hazır bir yapay zekâ sağlayıcısı yok">API Kullanımı sayfasında Claude, OpenAI ya da Gemini için API anahtarını girin (OpenAI ve Gemini’de model adını da yazın) ve bağlantıyı test edin.</Alert>}
          {d.ready && <>
            <Field label="Makaleyi yazacak model" hint="Hazır olmayan sağlayıcılar listelenmez."><select className="input" value={pick || d.picks.writer} onChange={(e) => setPick(e.target.value)}>{d.vendors.filter((v) => v.ready).map((v) => <option key={v.key} value={v.key}>{v.label} — {v.model}</option>)}</select></Field>
            <Alert kind="info" title="Ne olacak?">Habere ait kaynak sayfalar okunur → seçili model özgün bir makale taslağı yazar → doğruluk kontrolü ({(pick || d.picks.writer) === d.picks.writer ? (d.picks.independent ? 'yazandan farklı bir modelle' : 'aynı modelle') : 'ayarlara göre'}), AdSense/editoryal inceleme ve kalite puanı çıkarılır. Makale <strong>asla kendiliğinden yayımlanmaz</strong>: “Onay bekliyor” olarak arşive düşer, siz okuyup onaylarsınız.
              Bugünün günlük makale limitinden 1 yer ayrılır; toplam 3 model isteği gider, maliyeti seçili servisin kredisinden/bakiyesinden harcanır (fiyatları girdiyseniz API Kullanımı sayfasında gerçek tutar, girmediyseniz “Bilinmiyor” görünür). Birkaç dakika sürebilir.</Alert>
          </>}
          <div className="row end"><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !d.ready} onClick={() => go(d)}><PenLine size={15} />Makaleyi yaz</button></div>
        </div>
      )}</Async>
    </Modal>
  );
}

function SelectModal({ projectId, onClose }) {
  const st = useLoad(() => api.get(`/opportunities-select?projectId=${projectId}`), [projectId]);
  return (
    <Modal wide title="Bugün hangi fikirler yazılırdı? (kuru deneme)" onClose={onClose}>
      <Async state={st}>{(d) => (
        <div className="stack">
          <Alert kind="info">Bu bir <strong>kuru denemedir</strong>: hiçbir limit ayrılmaz, hiçbir makale yazılmaz. Makale üretimi Aşama 3’te bu seçimi kullanacak. Bugün için boş yer: <strong>{d.room}</strong>. Yalnızca uygun fikirler seçilir: gerçek veriye dayalı ve en az minimum puanlı olanlar; ya da hacim verisi olmayıp sizin “Kısa liste” onayınızla kısmi puanı eşiği geçenler. Kota doldurmak için zayıf konu eklenmez.</Alert>
          {d.picks.length === 0 ? <Alert kind="warn" title="Bugün yazılacak yeterince nitelikli fikir yok">{d.note || 'Uygun fikir bulunmuyor.'}</Alert> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fikir</th><th>Kategori</th><th className="num">Puan</th><th>Neden</th></tr></thead><tbody>{d.picks.map((p) => <tr key={p.id}><td>{p.title}</td><td>{p.categoryName}</td><td className="num">{p.total !== null ? p.total : <>kısmi {p.provisional}</>}</td><td className="faint">{p.why}</td></tr>)}</tbody></table></div>}
          {d.note && d.picks.length > 0 && <small className="faint">{d.note}</small>}
          {d.skipped.length > 0 && <details><summary>Seçilmeyen {d.skipped.length} uygun fikir</summary><ul>{d.skipped.map((s) => <li key={s.id}>{s.title} — <span className="faint">{s.why}</span></li>)}</ul></details>}
        </div>
      )}</Async>
    </Modal>
  );
}

export default function Opportunities() {
  const { projectId, can } = useApp();
  const [f, setF] = useState({ eligible: '', status: '', categoryId: '', minScore: '', q: '', page: 1 });
  const [open, setOpen] = useState(null); const [modal, setModal] = useState(false); const [writing, setWriting] = useState(null); const [prog, setProg] = useState(null);
  const cats = useLoad(() => (projectId ? api.get(`/projects/${projectId}/categories`) : Promise.resolve({ categories: [] })), [projectId]);
  const st = useLoad(() => (projectId ? api.get(`/opportunities${qs({ ...f, projectId, pageSize: 30 })}`) : Promise.resolve(null)), [projectId, f]);
  const settingsState = useLoad(() => (projectId ? api.get(`/settings?projectId=${projectId}`) : Promise.resolve(null)), [projectId]);
  const [run, busy] = useAction(); const { toast } = useApp();
  useEffect(() => {                                                               // follows the background writer run until it ends
    if (!writing) return undefined;
    let stop = false;
    const tick = async () => { try { const r = await api.get(`/runs/${writing.runId}`); if (stop) return; setProg(r); if (r.status !== 'running') { setWriting(null); st.reload(); toast(r.status === 'ok' ? 'Makale yazıldı: Onay bekliyor' : r.status === 'partial' ? 'Makale yazıldı ama bazı kontroller çalışmadı' : `Makale yazılamadı: ${r.error || 'bilinmeyen hata'}`, r.status === 'error' ? 'bad' : undefined); } } catch { /* next tick */ } };
    const t = setInterval(tick, 2000); tick();
    return () => { stop = true; clearInterval(t); };
  }, [writing]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!projectId) return <NeedsProject />;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }));
  const categories = cats.data ? cats.data.categories.filter((c) => c.status !== 'archived') : [];
  const refresh = async () => { const r = await run(() => api.post('/opportunities/refresh', { projectId })); if (r) { st.reload(); } };
  const setStatus = async (o, status) => { if (await run(() => api.post(`/opportunities/${o.id}/status`, { status }))) st.reload(); };
  const serp = async (o) => { if (await run(() => api.post(`/opportunities/${o.id}/serp`, {}), 'SERP analizi yapıldı ve fikir yeniden puanlandı')) st.reload(); };
  const w = settingsState.data ? settingsState.data.scoring.value : null;
  return (
    <div className="page">
      <PageHead title="İçerik Fırsatları" actions={<>{can('research.write') && <button className="btn primary" disabled={busy} onClick={refresh}><RefreshCw size={15} />Yenile ve puanla</button>}<button className="btn" onClick={() => setModal(true)}><ListChecks size={15} />Bugün ne yazılırdı?</button></>}>
        Her fikir 0–100 arası puanlanır. Toplam puan <strong>yalnızca beş bileşenin hepsi gerçek veriye dayanıyorsa</strong> verilir (haber trendi, SERP’ten organik rekabet fırsatı, aranma talebi, nişe uygunluk, kaynak güveni); eksik veri varsa fikir “uygun değil” kalır ve neyin eksik olduğu yazılır.
        <strong> Kısmi puan:</strong> yalnızca <em>aranma hacmi</em> eksikse (hacim verisi için dosya aktarmadıysanız) ve fikrin SERP analizi yapıldıysa, kalan dört bileşenin ortalaması “kısmi” diye gösterilir; fikir ancak siz “Kısa liste”ye aldığınızda ve kısmi puan eşiği geçtiğinde uygun olur. Niş dışı konular puanı yüksek olsa da asla üretime alınmaz.
      </PageHead>
      {writing && <Alert kind="info" title={`Makale yazılıyor: ${writing.title}`}><div className="row">{STEP[prog && prog.stats && prog.stats.step] || 'Başlatılıyor…'}<small className="faint">Sayfadan ayrılabilirsiniz; iş sunucuda sürer ve sonucu Makale Arşivi’nde görürsünüz.</small></div></Alert>}
      {w && <Card flat><div className="row"><Calculator size={16} /><span>Ağırlıklar: Trend %{w.trend} · Rekabet fırsatı %{w.competition} · Aranma talebi %{w.demand} · Nişe uygunluk %{w.relevance} · Kaynak güveni %{w.source}</span><Link className="btn sm" to="/settings">Ağırlıkları değiştir</Link><span className="faint">Minimum puan: Strateji sayfasında (kategori için ayrıca verilebilir)</span></div></Card>}
      <Card flat><div className="grid g4">
        <Field label="Uygunluk"><select className="input" value={f.eligible} onChange={(e) => set('eligible', e.target.value)}><option value="">Hepsi</option><option value="1">Yalnızca uygun</option><option value="0">Uygun olmayanlar</option></select></Field>
        <Field label="Durum"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Hepsi</option>{Object.entries(ST).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Kategori"><select className="input" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">Hepsi</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></Field>
        <Field label="Min. puan"><input className="input num" type="number" min={0} max={100} value={f.minScore} onChange={(e) => set('minScore', e.target.value)} /></Field></div></Card>
      <Async state={st}>{(d) => d && (d.total === 0 ? <Card><Empty title="Henüz fikir yok">Önce Dünya Gündemi’nde “Şimdi tara” ile haberleri alın, sonra buradan “Yenile ve puanla”ya basın. Nişe uygun her olay bir fikir olur ve aday anahtar kelimeleri çıkarılır.</Empty></Card> : (
        <Card flat><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fikir</th><th>Kategori</th><th>Puan</th><th>Trend</th><th>Rekabet f.</th><th>Talep</th><th>Uygunluk</th><th>Kaynak</th><th>Durum</th><th /></tr></thead>
          <tbody>{d.items.map((o) => (
            <Fragment key={o.id}><tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === o.id ? null : o.id)}>
              <td style={{ maxWidth: 340 }}><strong>{o.title}</strong><div className="faint">{o.keyword ? `Anahtar kelime: ${o.keyword}` : 'gerçek verili anahtar kelime yok'}{o.sourceCount ? ` · ${o.sourceCount} kaynak` : ''}</div></td><td>{o.categoryName || '—'}</td>
              <td>{o.total !== null ? <div className="row" style={{ flexWrap: 'nowrap' }}><ScoreBar value={o.total} />{o.eligible ? <Badge kind="ok">uygun</Badge> : <Badge kind="warn">eşik altı</Badge>}</div>
                : o.partial ? <div><div className="row" style={{ flexWrap: 'nowrap' }}><ScoreBar value={o.provisional} /><Badge kind={o.eligible ? 'ok' : 'warn'}>{o.eligible ? 'uygun (onaylı)' : 'kısmi'}</Badge></div><div className="faint">kısmi puan · hacim yok</div></div>
                  : <div><Badge>Puan verilmedi</Badge>{o.provisional !== null && <div className="faint">geçici {o.provisional}</div>}</div>}</td>
              {PARTS.map(([k]) => <td key={k}><ScoreBar value={o[k]} /></td>)}
              <td><Badge kind={ST[o.status][1]}>{ST[o.status][0]}</Badge></td>
              <td onClick={(e) => e.stopPropagation()}><div className="row end" style={{ flexWrap: 'nowrap' }}>
                {o.articleId && <Link className="btn sm" to={`/articles/${o.articleId}`}>Makaleyi aç</Link>}
                {can('research.paid') && o.eligible && ['new', 'shortlisted'].includes(o.status) && !writing && <button className="btn sm primary" onClick={() => setModal({ write: o })}><PenLine size={14} />Makale yaz</button>}
                {can('research.paid') && o.keywordId && o.total === null && o.explain.missing && o.explain.missing.includes('competition') && <button className="btn sm" disabled={busy} onClick={() => serp(o)} title="Bu fikrin anahtar kelimesi için SERP analizi (seçili kaynağın kredisinden/bakiyesinden harcar)">SERP</button>}
                {can('research.write') && o.status !== 'queued' && o.status !== 'written' && (o.status === 'rejected' ? <button className="btn sm" onClick={() => setStatus(o, 'new')}>Aç</button> : <><button className="btn sm" onClick={() => setStatus(o, o.status === 'shortlisted' ? 'new' : 'shortlisted')}>{o.status === 'shortlisted' ? 'Listeden çıkar' : (o.partial ? 'Onayla (kısa liste)' : 'Kısa liste')}</button><button className="btn sm danger" onClick={() => setStatus(o, 'rejected')}>Reddet</button></>)}</div></td></tr>
            {open === o.id && <tr><td colSpan={10}><Explain o={o} /><small className="faint">Hesaplandı: {dt(o.computedAt)}</small></td></tr>}</Fragment>))}</tbody></table></div>
        <div style={{ marginTop: 12 }}><Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => set('page', p)} /></div></Card>
      ))}</Async>
      {modal === true && <SelectModal projectId={projectId} onClose={() => setModal(false)} />}
      {modal && modal.write && <WriteModal o={modal.write} projectId={projectId} onClose={() => setModal(false)} onStarted={(r) => { setProg(null); setWriting({ runId: r.run.id, title: modal.write.title }); st.reload(); }} />}
    </div>
  );
}
