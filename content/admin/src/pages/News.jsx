import { Fragment, useState } from 'react';
import { Play, Plus, Trash2, FlaskConical, ExternalLink, Pencil, RotateCcw } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Check, Empty, Field, Modal, NeedsProject, PageHead, Pager, Tabs, useAction, useApp, useLoad, useRunWatcher } from '../ui.jsx';
import { dt, num } from '../format.js';

const ST = { relevant: ['Nişe uygun', 'ok'], irrelevant: ['İlgisiz', ''], excluded: ['Kapsam dışı', 'bad'] };
const SRC_TYPE = { official: 'Resmî', publisher: 'Yayıncı', aggregator: 'Toplayıcı', user: 'Kullanıcı' };
const LAST = { ok: ['Okundu', 'ok'], not_modified: ['Değişmedi', 'ok'], error: ['Hata', 'bad'], rate_limited: ['İstek sınırı', 'warn'] };

function RunSummary({ run }) {
  if (!run) return null;
  const s = run.stats || {};
  if (run.status === 'running') return <Alert kind="info" title="Tarama sürüyor…">Kaynaklar okunuyor; bu birkaç on saniye sürebilir. Sayfadan ayrılabilirsiniz, tarama arka planda devam eder.</Alert>;
  return (
    <Alert kind={run.status === 'ok' ? 'ok' : run.status === 'partial' ? 'warn' : 'bad'} title={run.status === 'ok' ? 'Tarama tamamlandı' : run.status === 'partial' ? 'Tarama kısmen tamamlandı' : 'Tarama başarısız'}>
      {num(s.sources)} kaynak, {num(s.ok)} okundu · {num(s.newItems)} yeni haber ({num(s.relevant)} nişe uygun, {num(s.irrelevant)} ilgisiz, {num(s.excluded)} kapsam dışı) · {num(s.newClusters)} yeni olay, {num(s.joined)} haber mevcut olaya eklendi
      {s.duplicates ? ` · ${num(s.duplicates)} zaten kayıtlı` : ''}{s.tooOld ? ` · ${num(s.tooOld)} çok eski` : ''}{s.limited ? ` · ${num(s.limited)} günlük limit nedeniyle işlenmedi` : ''}
      {(s.messages || []).length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{s.messages.slice(0, 6).map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {run.error && <div>{run.error}</div>}
    </Alert>
  );
}

function Clusters({ projectId, canWrite, categories }) {
  const [f, setF] = useState({ status: 'relevant', categoryId: '', multiSource: '', hours: '72', q: '', page: 1 });
  const [open, setOpen] = useState(null);
  const st = useLoad(() => api.get(`/news/clusters${qs({ ...f, projectId, pageSize: 25 })}`), [projectId, f]);
  const [run] = useAction();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }));
  const decide = async (c, status) => { if (await run(() => api.post(`/news/clusters/${c.id}/status`, { status }), status === 'relevant' ? 'Nişe uygun olarak işaretlendi' : 'İlgisiz olarak işaretlendi')) st.reload(); };
  return (
    <div className="stack">
      <Card flat><div className="grid g4">
        <Field label="Durum"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Hepsi</option><option value="relevant">Nişe uygun</option><option value="irrelevant">İlgisiz</option><option value="excluded">Kapsam dışı</option></select></Field>
        <Field label="Kategori"><select className="input" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">Hepsi</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></Field>
        <Field label="Son"><select className="input" value={f.hours} onChange={(e) => set('hours', e.target.value)}>{[['24', '24 saat'], ['72', '3 gün'], ['168', '7 gün'], ['720', '30 gün']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Ara"><input className="input" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Başlıkta ara…" /></Field>
      </div><div style={{ marginTop: 8 }}><Check checked={f.multiSource === '1'} onChange={(c) => set('multiSource', c ? '1' : '')}>Yalnızca birden fazla kaynağın haber yaptığı olaylar</Check></div></Card>
      <Async state={st}>{(d) => (d.total === 0 ? <Card><Empty title="Olay yok">Bu filtreyle olay bulunamadı. “Şimdi tara” ile kaynakları okuyun.</Empty></Card> : (
        <Card flat><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Olay (haber başlığı)</th><th>Kategori</th><th>Durum</th><th className="num">Kaynak</th><th className="num">Haber</th><th className="num">Uygunluk</th><th>Son</th><th /></tr></thead>
          <tbody>{d.items.map((c) => (
            <Fragment key={c.id}><tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === c.id ? null : c.id)}>
              <td style={{ maxWidth: 440 }}><strong>{c.title}</strong>{c.manualOverride && <> <Badge kind="info">elle</Badge></>}<div className="faint">{c.reason}</div></td>
              <td>{c.categoryName || <span className="faint">—</span>}</td><td><Badge kind={ST[c.status][1]}>{ST[c.status][0]}</Badge></td>
              <td className="num">{c.sourceCount}</td><td className="num">{c.itemCount}</td><td className="num">{c.relevance}</td><td className="faint">{dt(c.lastSeenAt)}</td>
              <td onClick={(e) => e.stopPropagation()}>{canWrite && (c.status === 'relevant' ? <button className="btn sm" onClick={() => decide(c, 'irrelevant')}>İlgisiz yap</button> : <button className="btn sm" onClick={() => decide(c, 'relevant')}>İlgili yap</button>)}</td></tr>
            {open === c.id && <tr><td colSpan={8}><ClusterItems id={c.id} /></td></tr>}</Fragment>))}</tbody></table></div>
        <div style={{ marginTop: 12 }}><Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => set('page', p)} /></div></Card>
      ))}</Async>
    </div>
  );
}

function ClusterItems({ id }) {
  const st = useLoad(() => api.get(`/news/clusters/${id}`), [id]);
  return <Async state={st}>{(c) => (
    <div className="stack">{c.items.map((i) => (
      <div key={i.id} className="row between"><span><strong>{i.sourceName}</strong> · {i.title}{i.summary && <div className="faint">{i.summary}</div>}</span>
        <span className="row"><small className="faint">{dt(i.publishedAt)}</small><a href={i.url} target="_blank" rel="noopener noreferrer nofollow" aria-label="Haberi aç"><ExternalLink size={14} /></a></span></div>))}
    <small className="faint">Yalnızca başlık, bağlantı ve kısa özet saklanır; haberin tam metni alınmaz.</small></div>
  )}</Async>;
}

function Items({ projectId, categories }) {
  const [f, setF] = useState({ status: '', categoryId: '', hours: '72', q: '', page: 1 });
  const st = useLoad(() => api.get(`/news/items${qs({ ...f, projectId, pageSize: 30 })}`), [projectId, f]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }));
  return (
    <div className="stack">
      <Card flat><div className="grid g4">
        <Field label="Durum"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Hepsi</option><option value="relevant">Nişe uygun</option><option value="irrelevant">İlgisiz</option><option value="excluded">Kapsam dışı</option></select></Field>
        <Field label="Kategori"><select className="input" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">Hepsi</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></Field>
        <Field label="Son"><select className="input" value={f.hours} onChange={(e) => set('hours', e.target.value)}>{[['24', '24 saat'], ['72', '3 gün'], ['168', '7 gün'], ['720', '30 gün']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Ara"><input className="input" value={f.q} onChange={(e) => set('q', e.target.value)} /></Field></div></Card>
      <Async state={st}>{(d) => (d.total === 0 ? <Card><Empty title="Haber yok" /></Card> : (
        <Card flat><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Başlık</th><th>Kaynak</th><th>Durum</th><th>Neden</th><th>Tarih</th></tr></thead>
          <tbody>{d.items.map((i) => <tr key={i.id}><td style={{ maxWidth: 420 }}><a href={i.url} target="_blank" rel="noopener noreferrer nofollow">{i.title}</a></td><td>{i.sourceName}</td><td><Badge kind={ST[i.status][1]}>{ST[i.status][0]}</Badge></td><td className="faint" style={{ maxWidth: 260 }}>{i.reason}</td><td className="faint">{dt(i.publishedAt)}</td></tr>)}</tbody></table></div>
        <div style={{ marginTop: 12 }}><Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => set('page', p)} /></div></Card>
      ))}</Async>
    </div>
  );
}

function SourceForm({ projectId, initial, onClose, onSaved }) {
  const [f, setF] = useState(initial || { name: '', kind: 'rss', url: '', query: '', sourceType: 'user', reliability: 60, country: 'US', language: 'en' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const body = { name: f.name, sourceType: f.sourceType, reliability: Number(f.reliability), country: f.country, language: f.language, ...(f.kind === 'rss' ? { url: f.url } : { query: f.query }) };
    const ok = await run(() => (initial ? api.put(`/news/sources/${initial.id}`, body) : api.post('/news/sources', { projectId, kind: f.kind, ...body })), 'Kaynak kaydedildi');
    if (ok) { onSaved(); onClose(); }
  };
  return (
    <Modal title={initial ? 'Kaynağı düzenle' : 'Haber kaynağı ekle'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Ad"><input className="input" value={f.name} onChange={set('name')} required /></Field>
        {!initial && <Field label="Tür"><select className="input" value={f.kind} onChange={set('kind')}><option value="rss">RSS / Atom adresi</option><option value="google_news">Google Haberler araması</option><option value="gdelt">GDELT araması (saniyede 1/5 istek sınırı)</option></select></Field>}
        {f.kind === 'rss' ? <Field label="Yayın adresi (https://…)" hint="Yalnızca herkese açık adresler okunur; iç ağ adresleri reddedilir."><input className="input" value={f.url} onChange={set('url')} required /></Field>
          : <Field label="Arama sorgusu" hint={f.kind === 'google_news' ? 'Örn: ("data breach" OR phishing) when:1d' : 'Örn: "artificial intelligence" OR chatgpt'}><input className="input" value={f.query} onChange={set('query')} required /></Field>}
        <div className="grid g3">
          <Field label="Sınıf"><select className="input" value={f.sourceType} onChange={set('sourceType')}>{Object.entries(SRC_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Güvenilirlik (0–100)" hint="Fırsat puanında kullanılır"><input className="input num" type="number" min={0} max={100} value={f.reliability} onChange={set('reliability')} /></Field>
          <Field label="Ülke / dil"><div className="row" style={{ flexWrap: 'nowrap' }}><input className="input" style={{ width: 70 }} maxLength={2} value={f.country} onChange={set('country')} /><input className="input" style={{ width: 70 }} value={f.language} onChange={set('language')} /></div></Field>
        </div>
        <Alert kind="info">Kaynağın kullanım şartlarına ve telif haklarına uymak sizin sorumluluğunuzdadır. Sistem yalnızca başlık, bağlantı ve 400 karakterlik özet saklar; tam metin kopyalamaz.</Alert>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy}>Kaydet</button></div>
      </form>
    </Modal>
  );
}

function Sources({ projectId, canWrite }) {
  const { confirm } = useApp();
  const st = useLoad(() => api.get(`/news/sources?projectId=${projectId}`), [projectId]);
  const [modal, setModal] = useState(null); const [tests, setTests] = useState({});
  const [run, busy] = useAction();
  const test = async (s) => { const r = await run(() => api.post(`/news/sources/${s.id}/test`)); if (r) setTests((t) => ({ ...t, [s.id]: r })); };
  const toggle = async (s) => { if (await run(() => api.put(`/news/sources/${s.id}`, { enabled: !s.enabled }))) st.reload(); };
  const del = async (s) => { if (await confirm({ title: 'Kaynak silinsin mi?', body: `“${s.name}” silinir; daha önce toplanan haberler kalır.`, confirmText: 'Sil', danger: true }) && await run(() => api.del(`/news/sources/${s.id}`), 'Kaynak silindi')) st.reload(); };
  const defaults = async () => { const r = await run(() => api.post('/news/sources/defaults', { projectId })); if (r) { st.reload(); } };
  return (
    <Async state={st}>{(d) => (
      <Card flat title={`Kaynaklar (${d.sources.length})`} actions={canWrite && <><button className="btn sm" disabled={busy} onClick={defaults}>Varsayılan kaynakları ekle</button><button className="btn sm primary" onClick={() => setModal('new')}><Plus size={14} />Kaynak ekle</button></>}>
        {d.sources.length === 0 ? <Empty title="Kaynak yok">“Varsayılan kaynakları ekle” ile resmî duyuru, güvenlik bülteni, güncelleme kaydı ve teknoloji yayıncılarından oluşan listeyi başlatabilirsiniz.</Empty> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Kaynak</th><th>Tür</th><th className="num">Güven.</th><th>Son okuma</th><th className="num">Haber</th><th>Aktif</th><th /></tr></thead>
            <tbody>{d.sources.map((s) => (
              <tr key={s.id} style={s.enabled ? undefined : { opacity: 0.55 }}>
                <td><strong>{s.name}</strong><div className="faint clip" style={{ maxWidth: 360 }} title={s.url}>{s.kind === 'rss' ? s.url : `${s.kind === 'gdelt' ? 'GDELT' : 'Google Haberler'}: ${s.query}`}</div>
                  {tests[s.id] && <div className={`hint ${tests[s.id].ok ? 'ok' : 'bad'}`}>{tests[s.id].ok ? `Test: ${tests[s.id].itemCount} haber okundu (${tests[s.id].ms} ms)` : `Test başarısız: ${tests[s.id].message}`}</div>}</td>
                <td><Badge>{SRC_TYPE[s.sourceType]}</Badge> <span className="faint">{s.kind}</span></td><td className="num">{s.reliability}</td>
                <td>{s.lastStatus ? <><Badge kind={LAST[s.lastStatus][1]}>{LAST[s.lastStatus][0]}</Badge> <span className="faint">{dt(s.lastFetchedAt)}</span>{s.lastError && <div className="hint bad" style={{ maxWidth: 260 }}>{s.lastError}</div>}{s.nextFetchAfter && new Date(s.nextFetchAfter) > new Date() && <div className="faint">bekletiliyor: {dt(s.nextFetchAfter)}</div>}</> : <span className="faint">henüz okunmadı</span>}</td>
                <td className="num">{num(s.itemCount)}</td><td><input type="checkbox" checked={s.enabled} disabled={!canWrite} onChange={() => toggle(s)} aria-label={`${s.name} aktif`} /></td>
                <td className="num">{canWrite && <div className="row end" style={{ flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => test(s)} disabled={busy} aria-label="Test et" title="Okumayı dene (kaydetmez)"><FlaskConical size={14} /></button>
                  <button className="btn sm ghost" onClick={() => setModal(s)} aria-label="Düzenle"><Pencil size={14} /></button><button className="btn sm ghost danger" onClick={() => del(s)} aria-label="Sil"><Trash2 size={14} /></button></div>}</td></tr>))}</tbody></table></div>)}
        {modal && <SourceForm projectId={projectId} initial={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={st.reload} />}
      </Card>
    )}</Async>
  );
}

function Runs({ projectId }) {
  const st = useLoad(() => api.get(`/runs${qs({ bot: 'news_discovery', projectId, limit: 20 })}`), [projectId]);
  return <Async state={st}>{(d) => (d.runs.length === 0 ? <Card><Empty title="Henüz tarama yapılmadı" /></Card> : (
    <Card flat><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Başlangıç</th><th>Durum</th><th>Süre</th><th className="num">Yeni haber</th><th className="num">Nişe uygun</th><th className="num">Hata</th><th>Not</th></tr></thead>
      <tbody>{d.runs.map((r) => <tr key={r.id}><td>{dt(r.startedAt)} <span className="faint">{r.trigger === 'manual' ? 'elle' : 'zamanlı'}</span></td><td><Badge kind={r.status === 'ok' ? 'ok' : r.status === 'partial' ? 'warn' : r.status === 'running' ? 'info' : 'bad'}>{r.status}</Badge></td>
        <td className="num">{r.seconds ?? '—'} sn</td><td className="num">{num(r.stats.newItems)}</td><td className="num">{num(r.stats.relevant)}</td><td className="num">{num((r.stats.errors || 0) + (r.stats.rateLimited || 0))}</td><td className="faint" style={{ maxWidth: 320 }}>{r.error || (r.stats.messages || [])[0] || ''}</td></tr>)}</tbody></table></div></Card>
  ))}</Async>;
}

export default function News() {
  const { projectId, can, toast } = useApp();
  const [tab, setTab] = useState('clusters');
  const [rev, setRev] = useState(0);
  const cats = useLoad(() => (projectId ? api.get(`/projects/${projectId}/categories`) : Promise.resolve({ categories: [] })), [projectId]);
  const [run, setRun] = useRunWatcher((r) => { setRev((x) => x + 1); toast(r.status === 'ok' ? 'Tarama tamamlandı' : r.status === 'partial' ? 'Tarama kısmen tamamlandı' : 'Tarama başarısız', r.status === 'error' ? 'bad' : 'ok'); });
  const [act, busy] = useAction();
  const [recl, setRecl] = useState(null);
  if (!projectId) return <NeedsProject />;
  const reclassify = async () => { const r = await act(() => api.post('/news/reclassify', { projectId, days: 14 })); if (r) { setRecl(r); setRev((x) => x + 1); } };
  const start = async () => { const r = await act(() => api.post('/news/run', { projectId })); if (r && r.run) setRun(r.run); };
  const categories = cats.data ? cats.data.categories.filter((c) => c.status !== 'archived') : [];
  return (
    <div className="page">
      <PageHead title="Dünya Gündemi" actions={can('research.write') && <><button className="btn" disabled={busy} onClick={reclassify} title="Kategori anahtar kelimelerini ya da kapsam dışı konuları değiştirdikten sonra son 14 günün haberlerini yeni kurallarla yeniden değerlendirir"><RotateCcw size={15} />Yeniden değerlendir</button><button className="btn primary" disabled={busy || (run && run.status === 'running')} onClick={start}><Play size={15} />Şimdi tara</button></>}>
        Seçili projenin haber kaynakları taranır; her haber önce nişe ve kapsam dışı konulara göre süzülür. Nişe uymayan haberler makale üretimine alınmaz. Kuralları (kategori anahtar kelimeleri, kapsam dışı konular) Strateji sayfasından düzeltip buradan “Yeniden değerlendir”e basarak etkisini hemen görebilirsiniz. Aynı olayı anlatan haberler tek olayda toplanır. Otomatik zamanlı tarama Aşama 4’te gelecek; şimdilik buton ile çalışır.
      </PageHead>
      <RunSummary run={run} />
      {recl && <Alert kind="ok" title="Yeniden değerlendirildi">Son 14 günün {num(recl.checked)} haberi yeni kurallarla tekrar süzüldü: {num(recl.changed)} haberin durumu değişti ({num(recl.becameRelevant)} nişe uygun oldu, {num(recl.becameIrrelevant)} ilgisiz oldu, {num(recl.becameExcluded)} kapsam dışı oldu). Elle verdiğiniz kararlar korunur.</Alert>}
      <Tabs tabs={[['clusters', 'Olaylar'], ['items', 'Haberler'], ['sources', 'Kaynaklar'], ['runs', 'Taramalar']]} value={tab} onChange={setTab} />
      {tab === 'clusters' && <Clusters key={`c${rev}${projectId}`} projectId={projectId} canWrite={can('research.write')} categories={categories} />}
      {tab === 'items' && <Items key={`i${rev}${projectId}`} projectId={projectId} categories={categories} />}
      {tab === 'sources' && <Sources key={`s${rev}${projectId}`} projectId={projectId} canWrite={can('sources.write')} />}
      {tab === 'runs' && <Runs key={`r${rev}${projectId}`} projectId={projectId} />}
    </div>
  );
}
