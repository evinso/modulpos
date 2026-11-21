import { useEffect, useMemo, useState } from 'react';
import { Plus, Archive, Trash2, Pencil, Wand2 } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Check, Empty, Field, Modal, PageHead, Tabs, useAction, useApp, useLoad } from '../ui.jsx';
import { TYPE_LABELS, csvList, lines } from '../format.js';

const TIMEZONES = ['Europe/Istanbul', 'UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'];

// ── niche profile ─────────────────────────────────────────────────────────────────────────────────────────
function NicheTab({ projectId, canEdit }) {
  const { confirm, reloadProjects } = useApp();
  const st = useLoad(() => api.get(`/projects/${projectId}`), [projectId]);
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    const p = st.data; if (!p) return;
    const n = p.niche;
    setF({ name: p.name, siteName: p.siteName, domain: p.domain || '', timezone: p.timezone, mainNiche: n.mainNiche, description: n.description, targetAudience: n.targetAudience, targetCountries: n.targetCountries.join(', '),
      language: n.language, tone: n.tone, contentTypes: n.contentTypes, preferredTopics: n.preferredTopics.join('\n'), minOpportunityScore: n.minOpportunityScore, dailyArticleLimit: n.dailyArticleLimit });
  }, [st.data]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  if (!f) return <Async state={st}>{() => null}</Async>;
  const save = async () => {
    const proj = { name: f.name, siteName: f.siteName, domain: f.domain, timezone: f.timezone };
    const niche = { mainNiche: f.mainNiche, description: f.description, targetAudience: f.targetAudience, targetCountries: csvList(f.targetCountries), language: f.language, tone: f.tone, contentTypes: f.contentTypes,
      preferredTopics: lines(f.preferredTopics), minOpportunityScore: Number(f.minOpportunityScore), dailyArticleLimit: Number(f.dailyArticleLimit) };
    const ok = await run(async () => {
      await api.put(`/projects/${projectId}`, proj);
      try { await api.put(`/projects/${projectId}/niche`, niche); }
      catch (e) {
        if (e.status === 409 && e.data.requiresConfirmation) {
          const yes = await confirm({ title: 'Ana nişi değiştirmek istiyor musunuz?', body: e.message, confirmText: 'Evet, değiştir', danger: true });
          if (!yes) throw new Error('Ana niş değişikliği onaylanmadı; hiçbir şey kaydedilmedi');
          await api.put(`/projects/${projectId}/niche`, { ...niche, confirmNicheChange: true });
        } else throw e;
      }
    }, 'Strateji kaydedildi');
    if (ok) { st.reload(); reloadProjects(); }
  };
  const toggleType = (t, on) => setF((x) => ({ ...x, contentTypes: on ? [...x.contentTypes, t] : x.contentTypes.filter((y) => y !== t) }));
  const dis = !canEdit;
  return (
    <div className="stack">
      {!canEdit && <Alert kind="info">Bu bölümü yalnızca yönetici (admin) düzenleyebilir.</Alert>}
      <Card title="Site">
        <div className="grid g2">
          <Field label="İçerik projesi adı"><input className="input" value={f.name} onChange={set('name')} disabled={dis} /></Field>
          <Field label="Site adı"><input className="input" value={f.siteName} onChange={set('siteName')} disabled={dis} /></Field>
          <Field label="Alan adı" hint={f.domain ? 'Alan adı girildi; WordPress bağlantısı Aşama 5’te eklenecek.' : 'Boş = “Not Connected”: Araştırma ve Arşiv Modu (hiçbir şey yayımlanmaz).'}><input className="input" placeholder="örnek: example.com" value={f.domain} onChange={set('domain')} disabled={dis} /></Field>
          <Field label="Saat dilimi" hint="Günlük limitler bu saat diliminin gününe göre sayılır."><select className="input" value={f.timezone} onChange={set('timezone')} disabled={dis}>{[...new Set([f.timezone, ...TIMEZONES])].map((z) => <option key={z}>{z}</option>)}</select></Field>
        </div>
      </Card>
      <Card title="Niş ve hedef kitle">
        <div className="grid g2">
          <Field label="Ana niş" hint="Değiştirirseniz onay istenir; mevcut makaleler silinmez ya da taşınmaz."><input className="input" value={f.mainNiche} onChange={set('mainNiche')} disabled={dis} /></Field>
          <Field label="Hedef kitle"><input className="input" value={f.targetAudience} onChange={set('targetAudience')} disabled={dis} /></Field>
          <Field label="Hedef ülkeler (virgülle, 2 harfli kod)"><input className="input" value={f.targetCountries} onChange={set('targetCountries')} disabled={dis} placeholder="US, GB, CA, AU" /></Field>
          <Field label="İçerik dili"><input className="input" value={f.language} onChange={set('language')} disabled={dis} /></Field>
          <Field className="" label="Niş açıklaması"><textarea className="input" rows={4} value={f.description} onChange={set('description')} disabled={dis} /></Field>
          <Field label="Yazım üslubu"><textarea className="input" rows={4} value={f.tone} onChange={set('tone')} disabled={dis} /></Field>
        </div>
        <Field label="Önerilen içerik türleri"><div className="row">{Object.entries(TYPE_LABELS).map(([t, l]) => <Check key={t} checked={f.contentTypes.includes(t)} onChange={(on) => toggleType(t, on)} disabled={dis}>{l}</Check>)}</div></Field>
        <div className="grid g3" style={{ marginTop: 12 }}>
          <Field label="Öncelikli konular (her satıra bir tane)"><textarea className="input" rows={5} value={f.preferredTopics} onChange={set('preferredTopics')} disabled={dis} /></Field>
          <Field label="Minimum SEO fırsat puanı (0–100)"><input className="input num" type="number" min={0} max={100} value={f.minOpportunityScore} onChange={set('minOpportunityScore')} disabled={dis} /></Field>
          <Field label="Günlük yeni makale limiti" hint="Burada değişirse Günlük Çalışma Ayarları’ndaki proje limiti de aynı değerdir."><input className="input num" type="number" min={0} max={50} value={f.dailyArticleLimit} onChange={set('dailyArticleLimit')} disabled={dis} /></Field>
        </div>
      </Card>
      {canEdit && <div className="row end sticky-save"><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Kaydediliyor…' : 'Stratejiyi kaydet'}</button></div>}
    </div>
  );
}

// ── categories ────────────────────────────────────────────────────────────────────────────────────────────
function CategoryForm({ initial, onSave, onClose }) {
  const [f, setF] = useState(initial || { name: '', nameEn: '', description: '', scope: '', relatedKeywords: '', excludedTopics: '', dailyMax: '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const body = { name: f.name, nameEn: f.nameEn, description: f.description, scope: f.scope, relatedKeywords: csvList(f.relatedKeywords), excludedTopics: csvList(f.excludedTopics), dailyMax: f.dailyMax === '' ? null : Number(f.dailyMax) };
    const ok = await run(() => onSave(body));
    if (ok) onClose();
  };
  return (
    <Modal title={initial ? 'Kategoriyi düzenle' : 'Yeni kategori'} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="grid g2">
          <Field label="Kategori adı (Türkçe)"><input className="input" value={f.name} onChange={set('name')} required /></Field>
          <Field label="İngilizce ad (sitede görünen)"><input className="input" value={f.nameEn} onChange={set('nameEn')} required /></Field>
        </div>
        <Field label="Açıklama"><textarea className="input" rows={2} value={f.description} onChange={set('description')} /></Field>
        <Field label="İçerik kapsamı (neler bu kategoriye girer)"><textarea className="input" rows={3} value={f.scope} onChange={set('scope')} /></Field>
        <div className="grid g2">
          <Field label="İlgili anahtar kelimeler (virgülle)"><input className="input" value={f.relatedKeywords} onChange={set('relatedKeywords')} /></Field>
          <Field label="Bu kategoride hariç tutulan konular (virgülle)"><input className="input" value={f.excludedTopics} onChange={set('excludedTopics')} /></Field>
        </div>
        <Field label="Günlük maksimum yeni makale" hint="Boş = kategoriye özel sınır yok (üstteki proje ve genel sınırlar yine geçerlidir)."><input className="input num" type="number" min={0} max={50} value={f.dailyMax} onChange={set('dailyMax')} /></Field>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy}>Kaydet</button></div>
      </form>
    </Modal>
  );
}

function CategoriesTab({ projectId, canEdit }) {
  const { confirm } = useApp();
  const st = useLoad(() => api.get(`/projects/${projectId}/categories`), [projectId]);
  const [shares, setShares] = useState({});
  const [modal, setModal] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (st.data) setShares(Object.fromEntries(st.data.categories.map((c) => [c.id, c.targetSharePct]))); }, [st.data]);
  const active = useMemo(() => (st.data ? st.data.categories.filter((c) => c.status !== 'archived') : []), [st.data]);
  const total = active.reduce((a, c) => a + (Number(shares[c.id]) || 0), 0);
  const dirty = active.some((c) => (Number(shares[c.id]) || 0) !== c.targetSharePct);
  const spread = () => { const n = active.length; const base = Math.floor(100 / n); const rest = 100 - base * n; setShares(Object.fromEntries(active.map((c, i) => [c.id, base + (i < rest ? 1 : 0)]))); };
  const saveShares = async () => { const r = await run(() => api.put(`/projects/${projectId}/category-shares`, { shares: active.map((c) => ({ id: c.id, share: Number(shares[c.id]) || 0 })) }), 'Kategori payları kaydedildi'); if (r) st.reload(); };
  const archive = async (c) => {
    const yes = await confirm({ title: 'Kategori arşivlensin mi?', body: `“${c.name}” arşivlenir; makaleleri durur, %${c.targetSharePct} payı diğer kategorilere oranlı dağıtılır.`, confirmText: 'Arşivle' });
    if (yes && await run(() => api.post(`/categories/${c.id}/archive`), 'Kategori arşivlendi')) st.reload();
  };
  const remove = async (c) => {
    const yes = await confirm({ title: 'Kategori silinsin mi?', body: `“${c.name}” kalıcı olarak silinir. Bu işlem geri alınamaz.`, confirmText: 'Sil', danger: true });
    if (yes && await run(() => api.del(`/categories/${c.id}`), 'Kategori silindi')) st.reload();
  };
  return (
    <Async state={st}>{(d) => (
      <div className="stack">
        <Card title="Kategoriler ve yayın payları" actions={canEdit && <><button className="btn sm" onClick={spread}><Wand2 size={14} />Eşit dağıt</button><button className="btn sm primary" onClick={() => setModal('new')}><Plus size={14} />Yeni kategori</button></>}>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Kategori</th><th>İngilizce ad</th><th className="num">Hedef pay %</th><th className="num">Günlük maks.</th><th className="num">Makale</th><th>Durum</th><th /></tr></thead>
            <tbody>{d.categories.map((c) => (
              <tr key={c.id} style={c.status === 'archived' ? { opacity: 0.55 } : undefined}>
                <td><strong>{c.name}</strong><div className="faint clip" title={c.description}>{c.description}</div></td><td>{c.nameEn}</td>
                <td className="num">{c.status === 'archived' ? '—' : <input className="input num" type="number" min={0} max={100} value={shares[c.id] ?? 0} disabled={!canEdit} onChange={(e) => setShares((s) => ({ ...s, [c.id]: e.target.value }))} aria-label={`${c.name} payı`} />}</td>
                <td className="num">{c.dailyMax === null ? '—' : c.dailyMax}</td><td className="num">{c.articleCount}</td>
                <td>{c.status === 'archived' ? <Badge>Arşivde</Badge> : c.status === 'paused' ? <Badge kind="warn">Duraklatıldı</Badge> : <Badge kind="ok">Aktif</Badge>}</td>
                <td className="num">{canEdit && c.status !== 'archived' && <div className="row end" style={{ flexWrap: 'nowrap' }}>
                  <button className="btn sm ghost" onClick={() => setModal(c)} aria-label="Düzenle"><Pencil size={14} /></button>
                  <button className="btn sm ghost" onClick={() => archive(c)} aria-label="Arşivle"><Archive size={14} /></button>
                  {c.articleCount === 0 && <button className="btn sm ghost danger" onClick={() => remove(c)} aria-label="Sil"><Trash2 size={14} /></button>}</div>}</td>
              </tr>))}</tbody></table></div>
          <div className="row between" style={{ marginTop: 12 }}>
            <span>Toplam: <strong className={total === 100 ? 'hint ok' : 'hint bad'} style={{ fontSize: 15 }}>%{total}</strong> {total !== 100 && <span className="hint bad"> — toplam %100 olmalı</span>}</span>
            {canEdit && <button className="btn primary" disabled={busy || total !== 100 || !dirty} onClick={saveShares}>Payları kaydet</button>}
          </div>
          <small className="faint">Paylar, yayınların kategoriler arasındaki hedef dağılımıdır (30 günlük ortalama). Yeni bir kategori %0 ile başlar; payı elle verin.</small>
        </Card>
        {modal && <CategoryForm initial={modal === 'new' ? null : { name: modal.name, nameEn: modal.nameEn, description: modal.description, scope: modal.scope, relatedKeywords: modal.relatedKeywords.join(', '), excludedTopics: modal.excludedTopics.join(', '), dailyMax: modal.dailyMax ?? '' }}
          onClose={() => setModal(null)} onSave={async (body) => { if (modal === 'new') await api.post(`/projects/${projectId}/categories`, body); else await api.put(`/categories/${modal.id}`, body); st.reload(); }} />}
      </div>
    )}</Async>
  );
}

// ── excluded topics ───────────────────────────────────────────────────────────────────────────────────────
function ExcludedTab({ projectId, canEdit }) {
  const st = useLoad(() => api.get(`/projects/${projectId}/excluded-topics`), [projectId]);
  const [f, setF] = useState({ topic: '', reason: '' });
  const [q, setQ] = useState('');
  const [test, setTest] = useState({ text: '', result: null });
  const [run, busy] = useAction();
  const add = async (e) => { e.preventDefault(); if (await run(() => api.post(`/projects/${projectId}/excluded-topics`, f), 'Konu eklendi')) { setF({ topic: '', reason: '' }); st.reload(); } };
  const toggle = async (t) => { if (await run(() => api.put(`/excluded-topics/${t.id}`, { isActive: !t.isActive }))) st.reload(); };
  const remove = async (t) => { if (await run(() => api.del(`/excluded-topics/${t.id}`), 'Konu silindi')) st.reload(); };
  const check = async () => { const r = await run(() => api.post(`/projects/${projectId}/check-topic`, { text: test.text })); if (r) setTest((x) => ({ ...x, result: r })); };
  return (
    <Async state={st}>{(d) => {
      const rows = d.topics.filter((t) => !q || t.topic.toLowerCase().includes(q.toLowerCase()));
      return (
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <Card title={`Hariç tutulan konular (${d.topics.length})`}>
            <input className="input" placeholder="Ara…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
            <div className="tbl-wrap" style={{ maxHeight: 460, overflow: 'auto' }}><table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>Konu</th><th>Neden</th><th>Aktif</th><th /></tr></thead>
              <tbody>{rows.map((t) => <tr key={t.id}><td>{t.topic} {t.isDefault && <Badge>varsayılan</Badge>}</td><td className="faint">{t.reason}</td>
                <td><input type="checkbox" checked={t.isActive} disabled={!canEdit} onChange={() => toggle(t)} aria-label={`${t.topic} aktif`} /></td>
                <td>{canEdit && <button className="btn sm ghost danger" onClick={() => remove(t)} aria-label="Sil"><Trash2 size={14} /></button>}</td></tr>)}</tbody></table></div>
          </Card>
          <div className="stack">
            {canEdit && <Card title="Konu ekle"><form className="stack" onSubmit={add}>
              <Field label="Konu (kelime ya da ifade)"><input className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} required /></Field>
              <Field label="Neden hariç?"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
              <button className="btn primary" disabled={busy}>Ekle</button></form></Card>}
            <Card title="Metin kontrolü">
              <p className="muted" style={{ marginBottom: 8 }}>Bir başlık ya da haber cümlesi yazın; botların kullanacağı aynı filtre ile kapsam dışı olup olmadığını görün. Eşleşme tam ifade ile yapılır.</p>
              <textarea className="input" rows={3} value={test.text} onChange={(e) => setTest({ text: e.target.value, result: null })} placeholder="Örn. Premier League football match tonight" />
              <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={busy || !test.text.trim()} onClick={check}>Kontrol et</button>
                {test.result && (test.result.allowed ? <Badge kind="ok">Kapsam içinde</Badge> : <Badge kind="bad">Kapsam dışı: {test.result.matched.map((m) => m.topic).join(', ')}</Badge>)}</div>
            </Card>
          </div>
        </div>
      );
    }}</Async>
  );
}

export default function Strategy() {
  const { projectId, project, can, reloadProjects, setProjectId } = useApp();
  const [tab, setTab] = useState('niche');
  const [newProj, setNewProj] = useState(null);
  const [run, busy] = useAction();
  const canEdit = can('projects.write');
  const create = async (e) => {
    e.preventDefault();
    const p = await run(() => api.post('/projects', { name: newProj.name, niche: { mainNiche: newProj.mainNiche } }), 'Proje oluşturuldu');
    if (p) { await reloadProjects(); setProjectId(p.id); setNewProj(null); }
  };
  return (
    <div className="page">
      <PageHead title="Site Nişi ve İçerik Stratejisi" actions={canEdit && <button className="btn" onClick={() => setNewProj({ name: '', mainNiche: '' })}><Plus size={15} />Yeni proje</button>}>
        Her sitenin kendi nişi, hedef kitlesi, kategorileri ve kapsam dışı konuları vardır. Haber, anahtar kelime ve makale kararları bu stratejiye göre verilir.
      </PageHead>
      {!projectId ? <Card><Empty title="Bir proje seçin">Üstteki menüden bir proje seçin.</Empty></Card> : (
        <>
          {project && <div className="row"><Badge kind="info">{project.name}</Badge>{project.mode === 'archive' ? <Badge>Not Connected · Araştırma ve Arşiv Modu</Badge> : <Badge kind="ok">{project.domain}</Badge>}</div>}
          <Tabs tabs={[['niche', 'Niş profili'], ['categories', 'Kategoriler'], ['excluded', 'Hariç tutulan konular']]} value={tab} onChange={setTab} />
          {tab === 'niche' && <NicheTab key={projectId} projectId={projectId} canEdit={canEdit} />}
          {tab === 'categories' && <CategoriesTab key={projectId} projectId={projectId} canEdit={can('categories.write')} />}
          {tab === 'excluded' && <ExcludedTab key={projectId} projectId={projectId} canEdit={can('categories.write')} />}
        </>
      )}
      {newProj && (
        <Modal title="Yeni içerik projesi" onClose={() => setNewProj(null)}>
          <form className="stack" onSubmit={create}>
            <Field label="Proje adı"><input className="input" value={newProj.name} onChange={(e) => setNewProj({ ...newProj, name: e.target.value })} required /></Field>
            <Field label="Ana niş" hint="Her proje kendi nişine sahiptir; kategorileri sonra eklersiniz."><input className="input" value={newProj.mainNiche} onChange={(e) => setNewProj({ ...newProj, mainNiche: e.target.value })} required /></Field>
            <div className="row end"><button type="button" className="btn" onClick={() => setNewProj(null)}>Vazgeç</button><button className="btn primary" disabled={busy}>Oluştur</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
