import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileUp, Plus, Sparkles, Trash2, CloudDownload } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Field, Modal, NeedsProject, PageHead, Pager, ScoreBar, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, num, usd } from '../format.js';

const STATE = { none: ['Henüz sorgulanmadı', ''], found: ['Veri var', 'ok'], not_found: ['Veri bulunamadı', 'warn'] };
const SOURCE = { csv: 'dosyadan', apify: 'Apify (Google verisi)' };

/** a file the browser read as bytes -> text: UTF-16 (Keyword Planner's own export) by its byte-order mark, else UTF-8, else Windows-1254 (Turkish Excel) */
function decodeFile(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1254').decode(b); }
}
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

function ImportModal({ projectId, onClose, onDone }) {
  const [f, setF] = useState({ text: '', country: 'US', fileName: '' });
  const [run, busy] = useAction(); const [res, setRes] = useState(null); const [readErr, setReadErr] = useState('');
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    if (file.size > 1_800_000) { setReadErr('Dosya çok büyük (en fazla yaklaşık 1,8 MB); bölün.'); return; }
    try { const text = decodeFile(await file.arrayBuffer()); setReadErr(''); setF((x) => ({ ...x, text, fileName: file.name })); } catch { setReadErr('Dosya okunamadı.'); }
  };
  const go = async (e) => { e.preventDefault(); const r = await run(() => api.post('/keywords/import', { projectId, text: f.text, country: f.country, fileName: f.fileName })); if (r) { setRes(r); onDone(); } };
  const sk = res ? res.skipped : null; const ex = (k) => (res && res.examples[k] && res.examples[k].length ? ` (ör. ${res.examples[k].slice(0, 3).join(', ')})` : '');
  return (
    <Modal wide title="Dosyadan arama hacmi içe aktar (ücretsiz)" onClose={onClose}>
      <form className="stack" onSubmit={go}>
        <Alert kind="info" title="Nasıl hacim verisi alınır?">Google Ads hesabınızda <strong>Planlama → Anahtar Kelime Planlayıcı → “Arama hacmi ve tahminleri al”</strong>’a kelimelerinizi yapıştırın, sonuçları <strong>CSV</strong> olarak indirip buraya yükleyin (Keywords Everywhere, Ubersuggest ya da bir Excel tablosu da olur: başlık satırında “Keyword” ve “Avg. monthly searches”/“Volume” sütunları yeterli).
          Yalnızca <strong>kesin sayılar</strong> alınır. Reklam harcaması olmayan Google Ads hesaplarında hacim “1K – 10K” gibi aralık gelir; aralıklar ve “10K” gibi yuvarlak değerler <strong>atlanır</strong> (uydurulmaz).</Alert>
        <Field label="Dosya (CSV / TSV / TXT)" hint="UTF-8, UTF-16 ve Excel (Windows-1254) kodlamaları okunur. En fazla 2000 satır."><input className="input" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" aria-label="Dosya seç" onChange={pick} /></Field>
        {readErr && <Alert kind="bad">{readErr}</Alert>}
        <Field label="ya da buraya yapıştırın" hint="Örn: ilk satır “keyword,volume”, sonra her satıra bir kelime ve sayı."><textarea className="input" rows={6} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value, fileName: '' })} required /></Field>
        <div className="grid g2"><Field label="Ülke (hacmin ait olduğu pazar)"><select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field></div>
        {res && <Alert kind={res.imported ? 'ok' : 'warn'} title={res.imported ? 'İçe aktarıldı' : 'Aktarılacak satır yok'}>{res.message}
          {sk && (sk.range + sk.rounded + sk.empty + sk.bad + sk.noKeyword + sk.invalid) > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {sk.range > 0 && <li>{sk.range} satırda hacim aralık olarak geldi{ex('range')}: kesin sayı olmadığı için atlandı.</li>}{sk.rounded > 0 && <li>{sk.rounded} satırda yuvarlak değer var{ex('rounded')}: atlandı.</li>}
            {sk.empty > 0 && <li>{sk.empty} satırda hacim boş: atlandı.</li>}{sk.bad > 0 && <li>{sk.bad} satırda hacim okunamadı{ex('bad')}: atlandı.</li>}{(sk.noKeyword + sk.invalid) > 0 && <li>{sk.noKeyword + sk.invalid} satırda geçerli bir kelime yok: atlandı.</li>}</ul>}</Alert>}
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Kapat</button><button className="btn primary" disabled={busy || !f.text.trim()}>İçe aktar</button></div>
      </form>
    </Modal>
  );
}

function FetchModal({ projectId, ids, onClose, onDone }) {
  const plan = useLoad(() => api.post('/keywords/plan', { projectId, ids: ids.length ? ids : undefined }), []);
  const [run, busy] = useAction(); const [result, setResult] = useState(null);
  const go = async () => { const r = await run(() => api.post('/keywords/fetch', { projectId, ids: ids.length ? ids : undefined })); if (r) { setResult(r); onDone(); } };
  return (
    <Modal title="Apify’dan gerçek Google verisi çek" onClose={onClose}>
      <Async state={plan}>{(p) => (
        <div className="stack">
          {result ? <Alert kind={result.stopped ? 'warn' : 'ok'} title="Tamamlandı">{result.message} · Maliyet: Bilinmiyor (Apify hesabınızdaki kullanımı Apify → Billing’den görün)</Alert> : (
            <>
              {!p.configured && <Alert kind="bad" title="Apify ayarlı değil">API Kullanımı sayfasından Apify belirtecini girip bağlantıyı test edin (apify.com’da kartsız ücretsiz hesap). Hiç ödeme yapmak istemezseniz “Dosyadan hacim aktar” ücretsiz yoldur.</Alert>}
              <div className="grid g2">
                <div className="metric"><span className="l">Toplam seçili</span><span className="v">{p.total}</span></div><div className="metric"><span className="l">Zaten güncel (önbellek, {p.cacheDays} gün)</span><span className="v">{p.cached}</span></div>
                <div className="metric"><span className="l">Sorgulanacak</span><span className="v">{p.toAsk}</span><span className="n">bugün izin verilen: {p.allowedToday}</span></div><div className="metric"><span className="l">Maliyet</span><span className="v">Bilinmiyor</span><span className="n">{p.estimateNote}</span></div>
              </div>
              <small className="faint">Günlük anahtar kelime limiti: {p.limit.done}/{p.limit.limit} kullanıldı, {p.limit.remaining} kaldı. <strong>Aylık güvenlik sınırı: {p.monthly.used}/{p.monthly.cap} kelime kullanıldı</strong> (Apify kartından değişir). Önbellekteki kelimeler ne istek ne limit harcar.</small>
              {p.toAsk === 0 && <Alert kind="info">Sorgulanacak kelime yok: hepsinin güncel verisi var.</Alert>}
            </>)}
          <div className="row end"><button className="btn" onClick={onClose}>{result ? 'Kapat' : 'Vazgeç'}</button>{!result && <button className="btn primary" disabled={busy || !p.configured || p.allowedToday === 0} onClick={go}>Verileri çek (Apify kredisi harcar)</button>}</div>
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
    <Modal title="Anahtar kelime fikirleri (Google önerileri)" onClose={onClose}>
      <form className="stack" onSubmit={go}>
        <Field label="Başlangıç ifadesi" hint="Örn: chatgpt. Google’ın yazarken önerdiği ifadeler ya da gerçek sonuç sayfasındaki ilgili aramalar ve ‘insanlar şunu da sordu’ soruları gelir. Bunlar FİKİRDİR: aranma hacmi taşımaz; hacim için ‘Verisini çek’ ya da dosya kullanılır."><input className="input" value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} required /></Field>
        <div className="grid g3"><Field label="Tür"><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="suggestions">Otomatik tamamlama önerileri</option><option value="related">İlgili aramalar ve sorular</option></select></Field>
          <Field label="En fazla (1–100)"><input className="input num" type="number" min={1} max={100} value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} /></Field>
          <Field label="Ülke"><select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field></div>
        <Alert kind="info">Bir Serper kredisi harcar (ücretsiz hesapta 2.500 sorgu) ve günün SERP sorgu limitinden bir yer alır; anahtar kelime limitinden düşmez.</Alert>
        {res && <Alert kind={res.stopped ? 'warn' : 'ok'}>{res.stopped || `${res.added} yeni anahtar kelime fikri eklendi (${res.existing} zaten vardı). Hiçbirinin hacim verisi yok: ‘Verisini çek’ ya da dosya kullanın.`}</Alert>}
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Kapat</button><button className="btn primary" disabled={busy}>Fikirleri getir</button></div>
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
  const dataOk = status.data && status.data.apify.configured; const serpOk = status.data && status.data.serpReady;
  return (
    <div className="page">
      <PageHead title="Anahtar Kelime Araştırması" actions={<>
        {can('research.write') && <button className="btn" onClick={() => setModal('add')}><Plus size={15} />Kelime ekle</button>}
        {can('research.write') && <button className="btn primary" onClick={() => setModal('import')}><FileUp size={15} />Dosyadan hacim aktar</button>}
        {paid && <button className="btn" onClick={() => setModal('suggest')}><Sparkles size={15} />Fikir getir (Serper)</button>}
        {paid && <button className="btn" onClick={() => setModal('fetch')}><CloudDownload size={15} />{ids.length ? `${ids.length} kelimenin verisini çek` : 'Verisi olmayanların verisini çek'} (Apify)</button>}
        <button className="btn" onClick={dl} disabled={busy}><Download size={15} />CSV</button></>}>
        Aranma hacmi, CPC, ücretli rekabet, arama niyeti ve aylık geçmiş yalnızca gerçek veridir: bir veri servisinden (Apify) ya da sizin yüklediğiniz dosyadan (Google Ads Anahtar Kelime Planlayıcı gibi) gelir; veri yoksa “Veri bulunamadı” yazar, yapay zekâ ile uydurulmaz. Ücretli reklam rekabeti organik rekabet sayılmaz: organik rekabet SEO Rekabet Analizi’nde ayrıca tahmin edilir.
      </PageHead>
      {status.data && !dataOk && <Alert kind="info" title="Aranma hacmi: Apify bağlı değil">Hacim verisi için iki yol var. <strong>Ücretsiz başlangıç:</strong> <Link to="/api-usage">API Kullanımı ve Maliyetler</Link> sayfasından Apify’ı bağlayın (apify.com’da kartsız ücretsiz hesap; Apify’ın fiyat sayfasına göre aylık 5 $ kredi verir, aktör anahtar kelime başına birkaç $/1.000 alır). <strong>Hiç ödeme yok:</strong> “Dosyadan hacim aktar” (Google Ads Anahtar Kelime Planlayıcı çıktısı; yalnızca kesin sayılar alınır). Kelime eklemek ve listelemek anahtarsız çalışır.</Alert>}
      {status.data && !serpOk && <Alert kind="warn" title={`SERP kaynağı bağlı değil: ${status.data.serpProviderLabel}`}>Organik rekabeti ölçmek için <Link to="/api-usage">API Kullanımı ve Maliyetler</Link> sayfasından Serper.dev API anahtarını girin (serper.dev’de kartsız ücretsiz hesap, 2.500 sorgu) ve bağlantıyı test edin.</Alert>}
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
      <Async state={st}>{(d) => d && (d.total === 0 ? <Card><Empty title="Anahtar kelime yok">“Kelime ekle” ile elle ekleyin, “Dosyadan hacim aktar” ile hacimli bir liste yükleyin ya da İçerik Fırsatları sayfasında “Yenile ve puanla” ile haber olaylarından aday kelimeler üretin.</Empty></Card> : (
        <Card flat><div className="tbl-wrap"><table className="tbl"><thead><tr>
          <th style={{ width: 30 }}><input type="checkbox" aria-label="Sayfadakilerin hepsi" checked={d.items.every((k) => sel.has(k.id))} onChange={(e) => setSel(e.target.checked ? new Set(d.items.map((k) => k.id)) : new Set())} /></th>
          <th>Anahtar kelime</th><th>Veri</th><th className="num">Aylık arama</th><th className="num">CPC</th><th className="num" title="Google Ads ücretli rekabet (0–1); organik rekabet DEĞİLDİR">Ücretli rek.</th><th className="num" title="Veri kaynağının kendi zorluk sayısı (Google’ın değil)">KD</th><th>Niyet</th><th className="num">Trend</th><th>Organik rekabet</th><th>Son kontrol</th></tr></thead>
          <tbody>{d.items.map((k) => { const m = k.metrics; return (
            <tr key={k.id}><td><input type="checkbox" checked={sel.has(k.id)} onChange={() => toggle(k.id)} aria-label={`${k.keyword} seç`} /></td>
              <td><strong>{k.keyword}</strong> <span className="faint">{k.country}</span> {k.origin !== 'manual' && <Badge>{k.origin}</Badge>}{k.categoryName && <div className="faint">{k.categoryName}</div>}</td>
              <td><Badge kind={STATE[k.dataState][1]}>{STATE[k.dataState][0]}</Badge>{m && m.found && m.provider && SOURCE[m.provider] && <div className="faint">{SOURCE[m.provider]}</div>}{k.stale && <> <Badge kind="warn" title="Önbellek süresi doldu">eski</Badge></>}</td>
              <td className="num">{m && m.found ? num(m.searchVolume) : '—'}</td><td className="num">{m && m.found && m.cpc !== null ? `$${m.cpc.toFixed(2)}` : '—'}</td>
              <td className="num">{m && m.found && m.paidCompetition !== null ? m.paidCompetition.toFixed(2) : '—'}</td><td className="num">{m && m.found && m.keywordDifficulty !== null ? m.keywordDifficulty : '—'}</td>
              <td>{m && m.found ? m.intent || '—' : '—'}</td><td className="num">{m && m.trendPct !== null ? <Badge kind={m.trendPct >= 0 ? 'ok' : 'bad'}>{m.trendPct > 0 ? '+' : ''}{m.trendPct}%</Badge> : '—'}</td>
              <td>{k.serp ? <ScoreBar value={k.serp.competition} kind={k.serp.competition >= 55 ? 'bad' : k.serp.competition >= 30 ? 'warn' : 'ok'} /> : paid ? <button className="btn sm" disabled={busy || !serpOk} onClick={() => serp(k)}>SERP analizi</button> : <span className="faint">yapılmadı</span>}</td>
              <td className="faint">{m ? dt(m.fetchedAt) : '—'}</td></tr>); })}</tbody></table></div>
          <div style={{ marginTop: 12 }}><Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => set('page', p)} /></div></Card>
      ))}</Async>
      {modal === 'add' && <AddModal projectId={projectId} categories={categories} onClose={() => setModal(null)} onDone={() => st.reload()} />}
      {modal === 'import' && <ImportModal projectId={projectId} onClose={() => setModal(null)} onDone={() => st.reload()} />}
      {modal === 'fetch' && <FetchModal projectId={projectId} ids={ids} onClose={() => setModal(null)} onDone={() => st.reload()} />}
      {modal === 'suggest' && <SuggestModal projectId={projectId} onClose={() => setModal(null)} onDone={() => st.reload()} />}
    </div>
  );
}
