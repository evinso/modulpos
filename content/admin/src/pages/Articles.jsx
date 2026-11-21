import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Plus, Search } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, PageHead, Pager, useAction, useApp, useLoad } from '../ui.jsx';
import { RISK, STATUS, TYPE_LABELS, dt, num } from '../format.js';

const FORMATS = [['csv', 'CSV (Excel)'], ['json', 'JSON'], ['html', 'HTML'], ['markdown', 'Markdown']];

export default function Articles() {
  const { projectId, can, confirm } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', status: '', categoryId: '', type: '', adsenseRisk: '', from: '', to: '', sort: 'updated', dir: 'desc', page: 1 });
  const [sel, setSel] = useState(new Set());
  const [run, busy] = useAction();
  const cats = useLoad(() => (projectId ? api.get(`/projects/${projectId}/categories`) : Promise.resolve({ categories: [] })), [projectId]);
  const st = useLoad(() => api.get(`/articles${qs({ ...f, projectId, pageSize: 25 })}`), [projectId, f]);
  const set = (k, v) => { setSel(new Set()); setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 })); };
  const canWrite = can('articles.write');
  const ids = [...sel];
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const bulk = async (action, extra = {}) => {
    if (action === 'delete') { const yes = await confirm({ title: 'Seçili makaleler silinsin mi?', body: `${ids.length} makale kalıcı olarak silinir (yayımlanmış/zamanlanmış olanlar silinmez).`, confirmText: 'Sil', danger: true }); if (!yes) return; }
    const r = await run(() => api.post('/articles/bulk', { ids, action, ...extra }));
    if (!r) return;
    setSel(new Set()); st.reload();
    if (r.failed.length) await confirm({ title: `${r.done.length} işlem tamam, ${r.failed.length} yapılamadı`, body: <ul>{r.failed.map((x) => <li key={x.id}>{x.message}</li>)}</ul>, confirmText: 'Tamam' });
  };
  const exportNow = async (format) => {
    const out = await run(() => api.download(`/articles-export${qs({ ...f, projectId, format, ids: ids.join(',') || undefined, page: undefined, sort: undefined, dir: undefined })}`));
    if (out) { /* browser saves the file */ }
  };

  return (
    <div className="page">
      <PageHead title="Makale Arşivi" actions={<>
        <select className="input" style={{ width: 'auto' }} defaultValue="" onChange={(e) => { if (e.target.value) { exportNow(e.target.value); e.target.value = ''; } }} aria-label="Dışa aktar"><option value="">⬇ Dışa aktar{ids.length ? ` (${ids.length} seçili)` : ' (filtredeki tümü)'}</option>{FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {canWrite && <Link className="btn primary" to="/articles/new"><Plus size={15} />Yeni makale</Link>}</>}>
        Makaleler yalnızca bu panelin veritabanında saklanır. Her düzenleme yeni bir sürüm oluşturur; hiçbir şey sitede yayımlanmaz.
      </PageHead>
      <Card flat>
        <div className="grid g4">
          <div className="field"><label>Ara</label><div className="row" style={{ flexWrap: 'nowrap' }}><Search size={16} className="faint" /><input className="input" placeholder="Başlık, anahtar kelime, bağlantı…" value={f.q} onChange={(e) => set('q', e.target.value)} /></div></div>
          <div className="field"><label>Durum</label><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Hepsi</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label>Kategori</label><select className="input" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">Hepsi</option>{(cats.data ? cats.data.categories : []).map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></div>
          <div className="field"><label>Tür</label><select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">Hepsi</option>{Object.entries(TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label>AdSense riski</label><select className="input" value={f.adsenseRisk} onChange={(e) => set('adsenseRisk', e.target.value)}><option value="">Hepsi</option>{Object.entries(RISK).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label>Başlangıç</label><input className="input" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></div>
          <div className="field"><label>Bitiş</label><input className="input" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></div>
          <div className="field"><label>Sırala</label><div className="row" style={{ flexWrap: 'nowrap' }}>
            <select className="input" value={f.sort} onChange={(e) => set('sort', e.target.value)}><option value="updated">Son değişiklik</option><option value="created">Oluşturulma</option><option value="title">Başlık</option><option value="words">Kelime sayısı</option><option value="quality">Kalite puanı</option><option value="status">Durum</option></select>
            <select className="input" style={{ width: 90 }} value={f.dir} onChange={(e) => set('dir', e.target.value)}><option value="desc">Azalan</option><option value="asc">Artan</option></select></div></div>
        </div>
      </Card>
      {canWrite && ids.length > 0 && (
        <div className="alert info row between"><strong>{ids.length} makale seçili</strong>
          <div className="row"><button className="btn sm" disabled={busy} onClick={() => bulk('archive')}>Arşivle</button><button className="btn sm" disabled={busy} onClick={() => bulk('restore')}>Arşivden çıkar</button>
            <select className="input" style={{ width: 'auto' }} defaultValue="" onChange={(e) => { if (e.target.value) { bulk('set_category', { categoryId: e.target.value }); e.target.value = ''; } }} aria-label="Kategori ata"><option value="">Kategori ata…</option>{(cats.data ? cats.data.categories : []).filter((c) => c.status !== 'archived').map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select>
            <button className="btn sm danger" disabled={busy} onClick={() => bulk('delete')}>Sil</button><button className="btn sm ghost" onClick={() => setSel(new Set())}>Seçimi temizle</button></div></div>
      )}
      <Async state={st}>{(d) => (
        d.total === 0 ? <Card><Empty title={Object.values({ q: f.q, s: f.status, c: f.categoryId, t: f.type, r: f.adsenseRisk, a: f.from, b: f.to }).some(Boolean) ? 'Filtreye uyan makale yok' : 'Henüz makale yok'} action={canWrite && <Link className="btn primary" to="/articles/new">Yeni makale ekle</Link>}>Makale ekledikçe burada listelenir.</Empty></Card> : (
          <Card flat>
            <div className="tbl-wrap"><table className="tbl"><thead><tr>
              {canWrite && <th style={{ width: 34 }}><input type="checkbox" aria-label="Sayfadakilerin hepsi" checked={d.items.length > 0 && d.items.every((a) => sel.has(a.id))} onChange={(e) => setSel(e.target.checked ? new Set(d.items.map((a) => a.id)) : new Set())} /></th>}
              <th>Başlık</th><th>Kategori</th><th>Durum</th><th className="num">Kelime</th><th>AdSense</th><th className="num">Sürüm</th><th>Son değişiklik</th></tr></thead>
              <tbody>{d.items.map((a) => (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/articles/${a.id}`)}>
                  {canWrite && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} aria-label={`${a.h1} seç`} /></td>}
                  <td><strong className="clip" style={{ display: 'block' }}>{a.h1}</strong><span className="faint mono">/{a.slug}</span> {a.createdBy === 'ai' && <Badge kind="info">AI</Badge>} {a.manualEdited && a.createdBy === 'ai' && <Badge>elle düzenlendi</Badge>}</td>
                  <td>{a.categoryName || <span className="faint">—</span>}</td>
                  <td><Badge kind={STATUS[a.status][1]}>{STATUS[a.status][0]}</Badge></td><td className="num">{num(a.wordCount)}</td>
                  <td>{a.adsenseRisk ? <Badge kind={RISK[a.adsenseRisk][1]}>{RISK[a.adsenseRisk][0]}</Badge> : <span className="faint">kontrol edilmedi</span>}</td>
                  <td className="num">{a.currentVersion}</td><td className="faint">{dt(a.updatedAt)}</td></tr>))}</tbody></table></div>
            <div style={{ marginTop: 12 }}><Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => set('page', p)} /></div>
          </Card>
        )
      )}</Async>
      {!can('articles.write') && <Alert kind="info">Bu hesap yalnızca okuma yetkisine sahip.</Alert>}
    </div>
  );
}
