import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Plus, Sparkles, Trash2, CloudDownload } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Field, Modal, NeedsProject, PageHead, Pager, ScoreBar, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, num, usd } from '../format.js';

const STATE = { none: ['Henüz sorgulanmadı', ''], found: ['Veri var', 'ok'], not_found: ['Veri bulunamadı', 'warn'] };
const COUNTRIES = [['US', 'ABD'], ['GB', 'Birleşik Krallık'], ['CA', 'Kanada'], ['AU', 'Avustralya']];

function AddModal({ projectId, categories, onClose, onDone }) {
  const [f, setF] = useState({ text: '', country: 'US', categoryId: '' });
  const [run, busy] = useAction();
  const go = async (e) => { e.preventDefault(); const r = await run(() => api.post('/keywords', { projectId, keywords: f.text.split(/[\n,]/), country: f.country, categoryId: f.categoryId || undefined })); if (r) { onDone(r); onClose(); } };
  return (
    <Modal title="Anahtar kelime ekle" onClose={onClose}>
      <form className="stack" onSubmit={go}>
        <Field label="Anahtar kelimeler (her satıra ya da virgülle bir tane)" hint="En fazla 10 kelime / 80 karakter. Ekleme ücretsizdir; veri çekmek ayrıdır."><textarea className="input" rows={6} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} required /></Field>
        <div className="grid g2"><Field label="Ülke"><select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Kategori (isteğe bağlı)"><select className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></Field></div>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy}>Ekle</button></div>
      </form>
    </Modal>
  );
}

function FetchModal({ projectId, ids, onClose, onDone }) {
  const plan = useLoad(() => api.post('/keywords/plan', { projectId, ids: ids.length ? ids : undefined }), []);
  const [run, busy] = useAction(); const [result, setResult] = useState(null);
  const go = async () => { const r = await run(() => api.post('/keywords/fetch', { projectId, ids: ids.length ? ids : undefined })); if (r) { setResult(r); onDone(); } };
  return (
    <Modal title="DataForSEO’dan gerçek veri çek" onClose={onClose}>
      <Async state={plan}>{(p) => (
        <div className="stack">
          {result ? <Alert kind={result.stopped ? 'warn' : 'ok'} title="Tamamlandı">{result.message}{result.costUsd ? ` · Gerçek maliyet: ${usd(result.costUsd, 4)}` : ''}</Alert> : (
            <>
              {!p.configured && <Alert kind="bad" title="DataForSEO ayarlı değil">API Kullanımı sayfasından login ve API şifresini girip bağlantıyı test edin.</Alert>}
              <div className="grid g2">
                <div className="metric"><span className="l">Toplam seçili</span><span className="v">{p.total}</span></div><div className="metric"><span className="l">Zaten güncel (önbellek, {p.cacheDays} gün)</span><span className="v">{p.cached}</span></div>
                <div className="metric"><span className="l">Sorgulanacak</span><span className="v">{p.toAsk}</span><span className="n">bugün izin verilen: {p.allowedToday}</span></div><div className="metric"><span className="l">Tahmini maliyet</span><span className="v">{usd(p.estimatedCostUsd, 4)}</span><span className="n">{p.requests} istek · {p.estimateNote}</span></div>
              </div>
              <small className="faint">Günlük anahtar kelime limiti: {p.limit.done}/{p.limit.limit} kullanıldı, {p.limit.remaining} kaldı. Önbellekteki kelimeler ne istek ne limit harcar.</small>
              {p.toAsk === 0 && <Alert kind="info">Sorgulanacak kelime yok: hepsinin güncel verisi var.</Alert>}
            </>)}
          <div className="row end"><button className="btn" onClick={onClose}>{result ? 'Kapat' : 'Vazgeç'}</button>{!result && <button className="btn primary" disabled={busy || !p.configured || p.allowedToday === 0} onClick={go}>Verileri çek (ücretli)</button>}</div>
        </div>
      )}</Async>
    </Modal>
  );
}

function SuggestModal({ projectId, onClose, onDone }) {
  const [f, setF] = useState({ seed: '', mode: 'suggestions', limit: 30, country: 'US' });
  const [run, busy] = useAction(); const [res, setRes] = useState(null);
  const go = async (e) => { e.preventDefault(); const r = await run(() => api.post('/keywords/suggest', { projectId, ...f, limit: Number(f.limit) })); if (r) { setRes(r); onDone(); } };
  return (
    <Modal title="Önerilen / ilgili anahtar kelimeler" onClose={onClose}>
      <form className="stack" onSubmit={go}>
        <Field label="Başlangıç ifadesi" hint="Örn: chatgpt. DataForSEO bu ifadeden uzun kuyruklu ve soru anahtar kelimeleri getirir; her birinin gerçek verisiyle birlikte."><input className="input" value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} required /></Field>
        <div className="grid g3"><Field label="Tür"><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="suggestions">Uzun kuyruk / soru önerileri</option><option value="related">İlgili anahtar kelimeler</option></select></Field>
          <Field label="En fazla (1–100)"><input className="input num" type="number" min={1} max={100} value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} /></Field>
          <Field label="Ülke"><select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field></div>
        <Alert kind="warn">Bu işlem DataForSEO’da ücretlidir (genelde bir istek başına yaklaşık 0,01 $; gerçek tutar yanıtta gelir) ve günlük anahtar kelime limitinizden düşer.</Alert>
        {res && <Alert kind={res.stopped ? 'warn' : 'ok'}>{res.stopped || `${res.added} yeni anahtar kelime eklendi (${res.existing} zaten vardı, ${res.withData} tanesinin verisi var). Maliyet: ${usd(res.costUsd, 4)}`}</Alert>}
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Kapat</button><button className="btn primary" disabled={busy}>Getir (ücretli)</button></div>
      </form>
    </Modal>
  );
}

export default function Keywords() {
  const { projectId, can, confirm, toast } = useApp();
  const [f, setF] = useState({ q: '', state: '', country: '', categoryId: '', origin: '', minVolume: '', maxVolume: '', maxCompetition: '', minTrend: '', minCpc: '', intent: '', sort: 'created', dir: 'desc', page: 1 });
  const [sel, setSel] = useState(new Set()); const [modal, setModal] = useState(null);
  const status = useLoad(() => api.get('/research/status'), []);
  const cats = useLoad(() => (projectId ? api.get(`/projects/${projectId}/categories`) : Promise.resolve({ categories: [] })), [projectId]);
  const st = useLoad(() => (projectId ? api.get(`/keywords${qs({ ...f, projectId, pageSize: 50 })}`) : Promise.resolve(null)), [projectId, f]);
  const [run, busy] = useAction();
  if (!projectId) return <NeedsProject />;
  const set = (k, v) => { setSel(new Set()); setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 })); };
  const categories = cats.data ? cats.data.categories.filter((c) => c.status !== 'archived') : [];
  const ids = [...sel]; const paid = can('research.paid');
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const del = async () => { if (await confirm({ title: 'Seçili anahtar kelimeler silinsin mi?', body: `${ids.length} anahtar kelime ve verileri silinir.`, confirmText: 'Sil', danger: true }) && await run(() => api.del(`/keywords${qs({ projectId, ids: ids.join(',') })}`), 'Silindi')) { setSel(new Set()); st.reload(); } };
  const serp = async (k) => { const r = await run(() => api.post(`/keywords/${k.id}/serp`, {})); if (r) { if (r.stopped) toast(r.stopped, 'bad'); st.reload(); } };
  const dl = () => run(() => api.download(`/keywords-export${qs({ ...f, projectId, page: undefined })}`));
  const dfsOk = status.data && status.data.dataforseo.configured;
  return (
    <div className="page">
      <PageHead title="Anahtar Kelime Araştırması" actions={<>
        {can('research.write') && <button className="btn" onClick={() => setModal('add')}><Plus size={15} />Kelime ekle</button>}
        {paid && <button className="btn" onClick={() => setModal('suggest')}><Sparkles size={15} />Öneri getir</button>}
        {paid && <button className="btn primary" onClick={() => setModal('fetch')}><CloudDownload size={15} />{ids.length ? `${ids.length} kelimenin verisini çek` : 'Verisi olmayanların verisini çek'}</button>}
        <button className="btn" onClick={dl} disabled={busy}><Download size={15} />CSV</button></>}>
        Aranma hacmi, CPC, ücretli rekabet, arama niyeti ve aylık geçmiş yalnızca DataForSEO’nun gerçek verisidir; veri yoksa “Veri bulunamadı” yazar, yapay zekâ ile uydurulmaz. Ücretli reklam rekabeti organik rekabet sayılmaz: organik rekabet SEO Rekabet Analizi’nde ayrıca tahmin edilir.
      </PageHead>
      {status.data && !dfsOk && <Alert kind="warn" title="DataForSEO bağlı değil">Gerçek veri çekmek için <Link to="/api-usage">API Kullanımı ve Maliyetler</Link> sayfasından DataForSEO login ve API şifresini girip bağlantıyı test edin. Kelime eklemek ve listelemek anahtarsız çalışır.</Alert>}
      <Card flat><div className="grid g4">
        <Field label="Ara"><input className="input" value={f.q} onChange={(e) => set('q', e.target.value)} /></Field>
        <Field label="Veri durumu"><select className="input" value={f.state} onChange={(e) => set('state', e.target.value)}><option value="">Hepsi</option>{Object.entries(STATE).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Ülke"><select className="input" value={f.country} onChange={(e) => set('country', e.target.value)}><option value="">Hepsi</option>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Kategori"><select className="input" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">Hepsi</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></Field>
        <Field label="Min. aranma hacmi"><input className="input num" type="number" min={0} value={f.minVolume} onChange={(e) => set('minVolume', e.target.value)} /></Field>
        <Field label="Maks. aranma hacmi"><input className="input num" type="number" min={0} value={f.maxVolume} onChange={(e) => set('maxVolume', e.target.value)} /></Field>
        <Field label="Maks. organik rekabet (0–100)"><input className="input num" type="number" min={0} max={100} value={f.maxCompetition} onChange={(e) => set('maxCompetition', e.target.value)} /></Field>
        <Field label="Min. trend yükselişi (%)"><input className="input num" type="number" value={f.minTrend} onChange={(e) => set('minTrend', e.target.value)} /></Field>
        <Field label="Min. CPC (USD)"><input className="input num" type="number" step="0.01" min={0} value={f.minCpc} onChange={(e) => set('minCpc', e.target.value)} /></Field>
        <Field label="Arama niyeti"><select className="input" value={f.intent} onChange={(e) => set('intent', e.target.value)}><option value="">Hepsi</option>{['informational', 'commercial', 'transactional', 'navigational'].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Sırala"><select className="input" value={f.sort} onChange={(e) => set('sort', e.target.value)}><option value="created">Eklenme</option><option value="keyword">Kelime</option><option value="volume">Aranma hacmi</option><option value="cpc">CPC</option><option value="trend">Trend</option><option value="competition">Organik rekabet</option></select></Field>
        <Field label="Yön"><select className="input" value={f.dir} onChange={(e) => set('dir', e.target.value)}><option value="desc">Azalan</option><option value="asc">Artan</option></select></Field>
      </div></Card>
      {ids.length > 0 && can('research.write') && <div className="alert info row between"><strong>{ids.length} kelime seçili</strong><button className="btn sm danger" onClick={del}><Trash2 size={14} />Sil</button></div>}
      <Async state={st}>{(d) => d && (d.total === 0 ? <Card><Empty title="Anahtar kelime yok">“Kelime ekle” ile elle ekleyin, “Öneri getir” ile DataForSEO’dan alın ya da İçerik Fırsatları sayfasında “Yenile ve puanla” ile haber olaylarından aday kelimeler üretin.</Empty></Card> : (
        <Card flat><div className="tbl-wrap"><table className="tbl"><thead><tr>
          <th style={{ width: 30 }}><input type="checkbox" aria-label="Sayfadakilerin hepsi" checked={d.items.every((k) => sel.has(k.id))} onChange={(e) => setSel(e.target.checked ? new Set(d.items.map((k) => k.id)) : new Set())} /></th>
          <th>Anahtar kelime</th><th>Veri</th><th className="num">Aylık arama</th><th className="num">CPC</th><th className="num" title="Google Ads ücretli rekabet (0–1); organik rekabet DEĞİLDİR">Ücretli rek.</th><th className="num" title="DataForSEO’nun kendi zorluk metriği">KD</th><th>Niyet</th><th className="num">Trend</th><th>Organik rekabet</th><th>Son kontrol</th></tr></thead>
          <tbody>{d.items.map((k) => { const m = k.metrics; return (
            <tr key={k.id}><td><input type="checkbox" checked={sel.has(k.id)} onChange={() => toggle(k.id)} aria-label={`${k.keyword} seç`} /></td>
              <td><strong>{k.keyword}</strong> <span className="faint">{k.country}</span> {k.origin !== 'manual' && <Badge>{k.origin}</Badge>}{k.categoryName && <div className="faint">{k.categoryName}</div>}</td>
              <td><Badge kind={STATE[k.dataState][1]}>{STATE[k.dataState][0]}</Badge>{k.stale && <> <Badge kind="warn" title="Önbellek süresi doldu">eski</Badge></>}</td>
              <td className="num">{m && m.found ? num(m.searchVolume) : '—'}</td><td className="num">{m && m.found && m.cpc !== null ? `$${m.cpc.toFixed(2)}` : '—'}</td>
              <td className="num">{m && m.found && m.paidCompetition !== null ? m.paidCompetition.toFixed(2) : '—'}</td><td className="num">{m && m.found && m.keywordDifficulty !== null ? m.keywordDifficulty : '—'}</td>
              <td>{m && m.found ? m.intent || '—' : '—'}</td><td className="num">{m && m.trendPct !== null ? <Badge kind={m.trendPct >= 0 ? 'ok' : 'bad'}>{m.trendPct > 0 ? '+' : ''}{m.trendPct}%</Badge> : '—'}</td>
              <td>{k.serp ? <ScoreBar value={k.serp.competition} kind={k.serp.competition >= 55 ? 'bad' : k.serp.competition >= 30 ? 'warn' : 'ok'} /> : paid ? <button className="btn sm" disabled={busy || !dfsOk} onClick={() => serp(k)}>SERP analizi</button> : <span className="faint">yapılmadı</span>}</td>
              <td className="faint">{m ? dt(m.fetchedAt) : '—'}</td></tr>); })}</tbody></table></div>
          <div style={{ marginTop: 12 }}><Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => set('page', p)} /></div></Card>
      ))}</Async>
      {modal === 'add' && <AddModal projectId={projectId} categories={categories} onClose={() => setModal(null)} onDone={() => st.reload()} />}
      {modal === 'fetch' && <FetchModal projectId={projectId} ids={ids} onClose={() => setModal(null)} onDone={() => st.reload()} />}
      {modal === 'suggest' && <SuggestModal projectId={projectId} onClose={() => setModal(null)} onDone={() => st.reload()} />}
    </div>
  );
}
