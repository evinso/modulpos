import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { ArrowLeft, Plus, Trash2, RotateCcw, Eye } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Check, Field, Modal, PageHead, Spinner, useAction, useApp, useLoad } from '../ui.jsx';
import { NEXT, RISK, STATUS, TYPE_LABELS, csvList, dt, num } from '../format.js';
import ArticleChecks from './ArticleChecks.jsx';

const EMPTY = { categoryId: '', articleType: 'evergreen_guide', h1: '', seoTitle: '', slug: '', metaDescription: '', focusKeyword: '', secondaryKeywords: '', excerpt: '', contentHtml: '', tags: '', featuredImageUrl: '', adsenseRisk: '', targetCountry: 'US', language: 'en-US', faq: [] };

const toForm = (a) => ({ categoryId: a.categoryId || '', articleType: a.articleType, h1: a.h1, seoTitle: a.seoTitle, slug: a.slug, metaDescription: a.metaDescription, focusKeyword: a.focusKeyword,
  secondaryKeywords: a.secondaryKeywords.join(', '), excerpt: a.excerpt, contentHtml: a.contentHtml, tags: a.tags.join(', '), featuredImageUrl: a.featuredImageUrl, adsenseRisk: a.adsenseRisk || '', targetCountry: a.targetCountry, language: a.language, faq: a.faq });
const toBody = (f) => ({ categoryId: f.categoryId || null, articleType: f.articleType, h1: f.h1, seoTitle: f.seoTitle, slug: f.slug, metaDescription: f.metaDescription, focusKeyword: f.focusKeyword, secondaryKeywords: csvList(f.secondaryKeywords),
  excerpt: f.excerpt, contentHtml: f.contentHtml, tags: csvList(f.tags), featuredImageUrl: f.featuredImageUrl, adsenseRisk: f.adsenseRisk || null, targetCountry: f.targetCountry, language: f.language, faq: f.faq });

const Counter = ({ value, ideal, max }) => { const n = value.length; return <span className={`hint ${n > max ? 'bad' : n >= ideal[0] && n <= ideal[1] ? 'ok' : ''}`}>{n} karakter (ideal {ideal[0]}–{ideal[1]})</span>; };

function Preview({ html, title }) {
  const clean = useMemo(() => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }), [html]);
  return <div className="card flat"><h1 style={{ marginBottom: 12 }}>{title}</h1><div className="prose" dangerouslySetInnerHTML={{ __html: clean }} /></div>;
}

function Sources({ articleId, initial, canEdit, onSaved }) {
  const [list, setList] = useState(initial);
  const [run, busy] = useAction();
  useEffect(() => setList(initial), [initial]);
  const set = (i, k, v) => setList((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => { const r = await run(() => api.put(`/articles/${articleId}/sources`, { sources: list.map(({ url, title, publisher, note }) => ({ url, title, publisher, note })) }), 'Kaynaklar kaydedildi'); if (r) onSaved(); };
  return (
    <Card title={`Kaynaklar (${list.length})`} actions={canEdit && <button className="btn sm" onClick={() => setList((l) => [...l, { url: '', title: '', publisher: '', note: '' }])}><Plus size={14} />Kaynak</button>}>
      {list.length === 0 && <p className="muted">Kaynak yok. Haber/güncelleme türü makaleler için en az bir kaynak gerekir.</p>}
      <div className="stack">{list.map((s, i) => (
        <div key={i} className="grid g2" style={{ alignItems: 'end', borderBottom: '1px solid var(--line-soft)', paddingBottom: 10 }}>
          <Field label="Adres (https://…)"><input className="input" value={s.url} disabled={!canEdit} onChange={(e) => set(i, 'url', e.target.value)} /></Field>
          <div className="row" style={{ flexWrap: 'nowrap' }}><Field label="Başlık" className="grow"><input className="input" value={s.title} disabled={!canEdit} onChange={(e) => set(i, 'title', e.target.value)} /></Field>
            <Field label="Yayıncı"><input className="input" value={s.publisher} disabled={!canEdit} onChange={(e) => set(i, 'publisher', e.target.value)} /></Field>
            {canEdit && <button className="btn sm ghost danger" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label="Kaynağı sil"><Trash2 size={14} /></button>}</div>
        </div>))}</div>
      {canEdit && list.length + initial.length > 0 && <div className="row end" style={{ marginTop: 10 }}><button className="btn sm primary" disabled={busy} onClick={save}>Kaynakları kaydet</button></div>}
    </Card>
  );
}

function Versions({ articleId, current, canEdit, onRestored }) {
  const st = useLoad(() => api.get(`/articles/${articleId}/versions`), [articleId, current]);
  const { confirm, toast } = useApp();
  const [view, setView] = useState(null);
  const [run] = useAction();
  const open = async (v) => setView(await api.get(`/articles/${articleId}/versions/${v}`).catch((e) => { toast(e.message, 'bad'); return null; }));
  const restore = async (v) => { if (await confirm({ title: `${v}. sürüme dönülsün mü?`, body: 'Eski sürüm YENİ bir sürüm olarak geri konur; geçmiş silinmez. Bağlantı (slug) değişmez.', confirmText: 'Geri dön' }) && await run(() => api.post(`/articles/${articleId}/versions/${v}/restore`), 'Sürüm geri yüklendi')) onRestored(); };
  return (
    <Card title="Sürüm geçmişi">
      <Async state={st}>{(d) => (
        <div className="stack">{d.versions.map((v) => (
          <div key={v.version} className="row between"><span><Badge kind={v.version === current ? 'ok' : ''}>v{v.version}</Badge> {v.reason} <small className="faint">· {v.createdBy === 'ai' ? 'AI' : 'kişi'} · {dt(v.createdAt)} · {num(v.wordCount)} kelime</small></span>
            <span className="row"><button className="btn sm ghost" onClick={() => open(v.version)} aria-label="Görüntüle"><Eye size={14} /></button>{canEdit && v.version !== current && <button className="btn sm ghost" onClick={() => restore(v.version)} aria-label="Geri dön"><RotateCcw size={14} /></button>}</span></div>))}</div>
      )}</Async>
      {view && <Modal wide title={`Sürüm ${view.version} — ${view.snapshot.h1}`} onClose={() => setView(null)}><div className="grid g2"><Field label="SEO başlığı"><div>{view.snapshot.seoTitle}</div></Field><Field label="Meta açıklama"><div>{view.snapshot.metaDescription}</div></Field></div><Preview html={view.snapshot.contentHtml} title={view.snapshot.h1} /></Modal>}
    </Card>
  );
}

export default function ArticleEditor() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const { projectId, can, confirm } = useApp();
  const canEdit = can('articles.write');
  const st = useLoad(() => (isNew ? Promise.resolve(null) : api.get(`/articles/${id}`)), [id]);
  const art = st.data;
  const pid = isNew ? projectId : art && art.projectId;
  const cats = useLoad(() => (pid ? api.get(`/projects/${pid}/categories`) : Promise.resolve({ categories: [] })), [pid]);
  const ready = useLoad(() => (isNew ? Promise.resolve(null) : api.get(`/articles/${id}/readiness`)), [id, art && art.currentVersion, art && art.factCheckedAt, art && art.status]);
  const [f, setF] = useState(EMPTY);
  const [reason, setReason] = useState('');
  const [meaningful, setMeaningful] = useState(false);
  const [preview, setPreview] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (art) { setF(toForm(art)); setConflict(null); } }, [art && art.id, art && art.currentVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const dirty = useMemo(() => (isNew ? f.h1 !== '' : art ? JSON.stringify(toBody(f)) !== JSON.stringify(toBody(toForm(art))) : false), [f, art, isNew]);
  useEffect(() => { const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);

  const save = async () => {
    if (isNew) { const r = await run(() => api.post('/articles', { projectId, ...toBody(f) }), 'Makale oluşturuldu'); if (r && r.id) nav(`/articles/${r.id}`, { replace: true }); return; }
    try {
      const r = await run(async () => { try { return await api.put(`/articles/${id}`, { ...toBody(f), expectedVersion: art.currentVersion, reason: reason || undefined, meaningful }); } catch (e) { if (e.status === 409 && e.data.currentVersion) setConflict(e.message); throw e; } }, 'Kaydedildi');
      if (r) { setReason(''); setMeaningful(false); st.reload(); }
    } catch { /* shown by useAction */ }
  };
  const status = async (to) => {
    if (to === 'archived' && !(await confirm({ title: 'Makale arşivlensin mi?', body: 'Arşivlenen makale listelerde gizlenir; istediğiniz zaman geri alabilirsiniz.', confirmText: 'Arşivle' }))) return;
    if (await run(() => api.post(`/articles/${id}/status`, { status: to }), `Durum: ${STATUS[to][0]}`)) st.reload();
  };
  const factCheck = async (checked) => { if (await run(() => api.post(`/articles/${id}/fact-check`, { checked }), checked ? 'Doğruluk kontrolü işaretlendi' : 'İşaret kaldırıldı')) st.reload(); };
  const remove = async () => { if (await confirm({ title: 'Makale silinsin mi?', body: 'Makale ve tüm sürümleri kalıcı olarak silinir.', confirmText: 'Sil', danger: true }) && await run(() => api.del(`/articles/${id}`), 'Makale silindi')) nav('/articles'); };

  const body = (
    <div className="page">
      <PageHead title={isNew ? 'Yeni makale' : (art ? art.h1 || '(başlıksız)' : 'Makale')} actions={<Link className="btn" to="/articles"><ArrowLeft size={15} />Arşive dön</Link>}>
        {isNew ? 'Elle makale ekleyin. HTML güvenlik için otomatik temizlenir (script, stil, olay işleyicileri kaldırılır).' : art && <>{<Badge kind={STATUS[art.status][1]}>{STATUS[art.status][0]}</Badge>} {art.createdBy === 'ai' ? <Badge kind="info">AI üretimi</Badge> : <Badge>elle eklendi</Badge>} · sürüm {art.currentVersion} · {num(art.wordCount)} kelime · son değişiklik {dt(art.updatedAt)}{art.lastUpdatedAt && <> · Last Updated {dt(art.lastUpdatedAt)}</>}</>}
      </PageHead>
      {conflict && <Alert kind="warn" title="Çakışma">{conflict} <button className="btn sm" onClick={() => { setConflict(null); st.reload(); }}>Güncel sürümü yükle</button> (Yaptığınız değişiklikler bu ekranda kalır; kaydetmeden önce kopyalayabilirsiniz.)</Alert>}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        <div className="stack">
          <Card title="Başlık ve SEO">
            <div className="stack">
              <Field label="Ana başlık (H1)"><input className="input" value={f.h1} onChange={set('h1')} disabled={!canEdit} /></Field>
              <Field label="SEO başlığı"><input className="input" value={f.seoTitle} onChange={set('seoTitle')} disabled={!canEdit} /><Counter value={f.seoTitle} ideal={[30, 60]} max={65} /></Field>
              <Field label="Meta açıklama"><textarea className="input" rows={2} value={f.metaDescription} onChange={set('metaDescription')} disabled={!canEdit} /><Counter value={f.metaDescription} ideal={[70, 160]} max={160} /></Field>
              <div className="grid g2">
                <Field label="Bağlantı (slug)" hint="Boş bırakırsanız başlıktan üretilir."><input className="input mono" value={f.slug} onChange={set('slug')} disabled={!canEdit} placeholder="new-ai-tool-explained" /></Field>
                <Field label="Odak anahtar kelime"><input className="input" value={f.focusKeyword} onChange={set('focusKeyword')} disabled={!canEdit} /></Field>
              </div>
              <Field label="İkincil anahtar kelimeler (virgülle)"><input className="input" value={f.secondaryKeywords} onChange={set('secondaryKeywords')} disabled={!canEdit} /></Field>
            </div>
          </Card>
          <Card title="İçerik" actions={<button className="btn sm" onClick={() => setPreview((p) => !p)}><Eye size={14} />{preview ? 'HTML’i düzenle' : 'Önizleme'}</button>}>
            {preview ? <Preview html={f.contentHtml} title={f.h1} /> : <textarea className="input mono" rows={22} value={f.contentHtml} onChange={set('contentHtml')} disabled={!canEdit} placeholder="<h2>…</h2><p>…</p>" spellCheck="false" />}
            <small className="faint">İzin verilen: h2–h4, p, listeler, bağlantı, https görsel, tablo, alıntı, kod. Kelime sayısı kayıtta hesaplanır.</small>
          </Card>
          <Card title="SSS" actions={canEdit && <button className="btn sm" onClick={() => setF((x) => ({ ...x, faq: [...x.faq, { q: '', a: '' }] }))}><Plus size={14} />Soru</button>}>
            {f.faq.length === 0 && <p className="muted">SSS yok.</p>}
            <div className="stack">{f.faq.map((x, i) => (
              <div key={i} className="stack" style={{ borderBottom: '1px solid var(--line-soft)', paddingBottom: 10 }}>
                <div className="row" style={{ flexWrap: 'nowrap' }}><input className="input" placeholder="Soru" value={x.q} disabled={!canEdit} onChange={(e) => setF((s) => ({ ...s, faq: s.faq.map((y, j) => (j === i ? { ...y, q: e.target.value } : y)) }))} />{canEdit && <button className="btn sm ghost danger" onClick={() => setF((s) => ({ ...s, faq: s.faq.filter((_, j) => j !== i) }))} aria-label="Soruyu sil"><Trash2 size={14} /></button>}</div>
                <textarea className="input" rows={2} placeholder="Cevap" value={x.a} disabled={!canEdit} onChange={(e) => setF((s) => ({ ...s, faq: s.faq.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)) }))} /></div>))}</div>
          </Card>
          {!isNew && art && <ArticleChecks art={art} onChanged={st.reload} />}
          {!isNew && art && <Sources articleId={id} initial={art.sources} canEdit={canEdit} onSaved={st.reload} />}
          {!isNew && art && <Versions articleId={id} current={art.currentVersion} canEdit={canEdit} onRestored={st.reload} />}
        </div>
        <div className="stack" style={{ position: 'sticky', top: 70 }}>
          <Card title="Yayın bilgileri">
            <div className="stack">
              <Field label="Kategori"><select className="input" value={f.categoryId} onChange={set('categoryId')} disabled={!canEdit}><option value="">Seçilmedi</option>{(cats.data ? cats.data.categories : []).filter((c) => c.status !== 'archived').map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></Field>
              <Field label="Makale türü"><select className="input" value={f.articleType} onChange={set('articleType')} disabled={!canEdit}>{Object.entries(TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <div className="grid g2"><Field label="Ülke"><input className="input" maxLength={2} value={f.targetCountry} onChange={set('targetCountry')} disabled={!canEdit} /></Field><Field label="Dil"><input className="input" value={f.language} onChange={set('language')} disabled={!canEdit} /></Field></div>
              <Field label="Etiketler (virgülle)"><input className="input" value={f.tags} onChange={set('tags')} disabled={!canEdit} /></Field>
              <Field label="Öne çıkan görsel (https)"><input className="input" value={f.featuredImageUrl} onChange={set('featuredImageUrl')} disabled={!canEdit} /></Field>
              <Field label="Özet"><textarea className="input" rows={3} value={f.excerpt} onChange={set('excerpt')} disabled={!canEdit} /></Field>
            </div>
          </Card>
          <Card title="Zorunlu kontroller">
            <div className="stack">
              <Field label="AdSense risk sonucu" hint="Yapay zekâ incelemesi bunu kendisi yazar; elle değiştirirseniz sizin işaretinizdir."><select className="input" value={f.adsenseRisk} onChange={set('adsenseRisk')} disabled={!canEdit}><option value="">Kontrol edilmedi</option>{Object.entries(RISK).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              {!isNew && art && <div className="row between"><span>Doğruluk kontrolü</span>{art.factCheckedAt ? <span className="row"><Badge kind="ok">{dt(art.factCheckedAt)}</Badge>{canEdit && <button className="btn sm ghost" onClick={() => factCheck(false)}>Kaldır</button>}</span> : canEdit ? <button className="btn sm" disabled={busy} onClick={() => factCheck(true)}>Doğrulandı olarak işaretle</button> : <Badge kind="warn">yapılmadı</Badge>}</div>}
              {!isNew && <small className="faint">İçerik ya da başlık değişince doğruluk kontrolü sıfırlanır.</small>}
            </div>
          </Card>
          {!isNew && art && (
            <Card title="Yayına hazır mı?">
              {ready.loading && !ready.data ? <Spinner /> : ready.data && (
                <div className="stack">
                  {ready.data.ready ? <Alert kind="ok">Tüm zorunlu kontroller tamam.</Alert> : <Alert kind="warn">Eksikler var.</Alert>}
                  {ready.data.problems.map((p) => <div key={p.code} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Badge kind={p.blocking ? 'bad' : 'warn'}>{p.blocking ? 'Engel' : 'Uyarı'}</Badge><span>{p.message}</span></div>)}
                </div>
              )}
              {canEdit && (NEXT[art.status] || []).length > 0 && <div className="row" style={{ marginTop: 12 }}>{NEXT[art.status].map((to) => <button key={to} className={`btn sm ${to === 'ready' ? 'primary' : ''}`} disabled={busy || dirty} onClick={() => status(to)}>{STATUS[to][0]}{to === 'ready' ? ' yap' : ' durumuna al'}</button>)}</div>}
              {dirty && <small className="faint">Durumu değiştirmeden önce kaydedin.</small>}
            </Card>
          )}
          {!isNew && canEdit && <Card flat><button className="btn danger sm" onClick={remove}><Trash2 size={14} />Makaleyi sil</button></Card>}
        </div>
      </div>
      {canEdit && (
        <div className="sticky-save row between">
          <div className="row">{!isNew && <><input className="input" style={{ width: 280 }} placeholder="Değişiklik notu (isteğe bağlı)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Check checked={meaningful} onChange={setMeaningful}>Anlamlı güncelleme (“Last Updated” tarihini yenile)</Check></>}</div>
          <div className="row">{dirty && <Badge kind="warn">Kaydedilmemiş değişiklik</Badge>}<button className="btn primary" disabled={busy || (!isNew && !dirty && !meaningful) || (isNew && !f.h1.trim())} onClick={save}>{busy ? 'Kaydediliyor…' : isNew ? 'Makaleyi oluştur' : 'Kaydet'}</button></div>
        </div>
      )}
    </div>
  );
  return isNew ? (projectId ? body : <div className="page"><Alert kind="warn">Önce üstteki menüden bir proje seçin.</Alert></div>) : <Async state={st}>{() => body}</Async>;
}
