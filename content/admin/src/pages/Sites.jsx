import { useState } from 'react';
import { Link2, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Field, Modal, NeedsProject, PageHead, useAction, useApp, useLoad } from '../ui.jsx';
import { dt } from '../format.js';

const PLUGINS = [['none', 'Yok / bilmiyorum (meta açıklama yazının özeti olarak gider)'], ['rankmath', 'Rank Math (resmî updateMeta yolu ile yazılır)'], ['yoast', 'Yoast SEO (yalnızca site alanları REST’e açtıysa yazılır)']];
const EMPTY = { name: '', apiUrl: '', username: '', password: '', domain: '', defaultAuthorId: '', defaultCategoryId: '', timezone: 'Europe/Istanbul', language: 'en-US', dailyLimit: 5, seoPlugin: 'none' };

function SiteModal({ projectId, site, onClose, onSaved }) {
  const [f, setF] = useState(site ? { ...EMPTY, name: site.name, apiUrl: site.apiUrl, username: site.username, domain: site.domain, defaultAuthorId: site.defaultAuthorId || '', defaultCategoryId: site.defaultCategoryId || '', timezone: site.timezone, language: site.language, dailyLimit: site.dailyLimit, seoPlugin: site.seoPlugin } : EMPTY);
  const [run, busy] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, dailyLimit: Number(f.dailyLimit), defaultAuthorId: f.defaultAuthorId === '' ? null : Number(f.defaultAuthorId), defaultCategoryId: f.defaultCategoryId === '' ? null : Number(f.defaultCategoryId) };
    if (!body.password) delete body.password;
    const r = await run(() => (site ? api.put(`/sites/${site.id}`, body) : api.post('/sites', { projectId, ...body })), site ? 'Site kaydedildi' : 'Site eklendi');
    if (r) { onSaved(r); onClose(); }
  };
  return (
    <Modal wide title={site ? `${site.name}: bağlantı ayarları` : 'WordPress sitesi ekle'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {!site && <Alert kind="info" title="Önce WordPress’te bir uygulama şifresi oluşturun">WordPress yönetimi → Kullanıcılar → Profil → <strong>Uygulama Şifreleri</strong> bölümünde bir ad yazıp şifre üretin (WordPress 5.6+). Normal giriş şifrenizi değil, bu şifreyi kullanın; istediğiniz an oradan iptal edebilirsiniz. Kullanıcı en az <strong>Yazar</strong> (yayımlamak için) rolünde olmalı. Şifre sunucuda şifreli saklanır ve bir daha gösterilmez.</Alert>}
        <div className="grid g2">
          <Field label="Site adı"><input className="input" value={f.name} onChange={set('name')} required /></Field>
          <Field label="WordPress adresi" hint="https://siteniz.com (https zorunlu)"><input className="input" value={f.apiUrl} onChange={set('apiUrl')} required placeholder="https://siteniz.com" /></Field>
          <Field label="Kullanıcı adı"><input className="input" value={f.username} onChange={set('username')} required autoComplete="off" /></Field>
          <Field label="Uygulama şifresi" hint={site ? `Boş bırakırsanız kayıtlı şifre (…${site.passwordLast4}) kalır.` : 'xxxx xxxx xxxx xxxx biçiminde'}><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required={!site} /></Field>
        </div>
        <div className="grid g3">
          <Field label="Varsayılan yazar (kullanıcı no)" hint="Boş = bağlanan kullanıcı"><input className="input num" type="number" min={1} value={f.defaultAuthorId} onChange={set('defaultAuthorId')} /></Field>
          <Field label="Varsayılan kategori (WP kategori no)" hint="Eşleşmeyen makaleler buraya düşer"><input className="input num" type="number" min={1} value={f.defaultCategoryId} onChange={set('defaultCategoryId')} /></Field>
          <Field label="Günlük yayın limiti" hint="Bu sitede günde en çok bu kadar herkese açık yazı"><input className="input num" type="number" min={0} max={200} value={f.dailyLimit} onChange={set('dailyLimit')} /></Field>
          <Field label="Saat dilimi"><input className="input" value={f.timezone} onChange={set('timezone')} /></Field>
          <Field label="Yayın dili"><input className="input" value={f.language} onChange={set('language')} /></Field>
          <Field label="SEO eklentisi"><select className="input" value={f.seoPlugin} onChange={set('seoPlugin')}>{PLUGINS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy}>Kaydet</button></div>
      </form>
    </Modal>
  );
}

function CategoryModal({ site, onClose }) {
  const st = useLoad(() => api.get(`/sites/${site.id}/categories`), [site.id]);
  const [pick, setPick] = useState({}); const [run, busy] = useAction();
  const save = async (entries) => { if (await run(() => api.put(`/sites/${site.id}/categories`, { entries }), 'Eşleştirme kaydedildi')) st.reload(); };
  return (
    <Modal wide title={`${site.name}: kategori eşleştirme`} onClose={onClose}>
      <Async state={st}>{(d) => (
        <div className="stack">
          {d.remoteError && <Alert kind="bad" title="Sitenin kategorileri okunamadı">{d.remoteError}. Mevcut eşleştirmeler yine görünür.</Alert>}
          <small className="faint">Makalenin kategorisi sitede hangi kategoriye gitsin? Eşleşmeyenler sitenin varsayılan kategorisine düşer. Ad benzerliği yalnızca <em>öneri</em>dir; siz onaylamadan eşleşmez.</small>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Bizim kategori</th><th>Sitedeki kategori</th><th /></tr></thead>
            <tbody>{d.categories.map((c) => { const cur = pick[c.categoryId] !== undefined ? pick[c.categoryId] : (c.wpCategoryId || ''); return (
              <tr key={c.categoryId}><td><strong>{c.name}</strong></td>
                <td><select className="input" value={cur} onChange={(e) => setPick({ ...pick, [c.categoryId]: e.target.value })} aria-label={`${c.name} eşleşmesi`}><option value="">— eşleşmedi —</option>{d.wpCategories.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
                  {c.suggestion && !c.wpCategoryId && <div className="faint">öneri: “{c.suggestion.name}”</div>}</td>
                <td className="num"><div className="row end" style={{ flexWrap: 'nowrap' }}>
                  <button className="btn sm" disabled={busy || cur === '' || String(cur) === String(c.wpCategoryId || '')} onClick={() => save([{ categoryId: c.categoryId, wpCategoryId: Number(cur), wpName: (d.wpCategories.find((w) => String(w.id) === String(cur)) || {}).name || '' }])}>Eşleştir</button>
                  {!c.wpCategoryId && <button className="btn sm" disabled={busy || !!d.remoteError} onClick={() => save([{ categoryId: c.categoryId, create: true }])} title="Sitede bu adla yeni kategori açar">Sitede oluştur</button>}
                  {c.wpCategoryId && <button className="btn sm ghost" disabled={busy} onClick={() => save([{ categoryId: c.categoryId, wpCategoryId: null }])}>Kaldır</button>}</div></td></tr>); })}</tbody></table></div>
          <div className="row end"><button className="btn" onClick={onClose}>Kapat</button></div>
        </div>
      )}</Async>
    </Modal>
  );
}

export default function Sites() {
  const { projectId, can, toast } = useApp();
  const st = useLoad(() => (projectId ? api.get(`/sites?projectId=${projectId}`) : Promise.resolve(null)), [projectId]);
  const [modal, setModal] = useState(null); const [run, busy] = useAction();
  if (!projectId) return <NeedsProject />;
  const admin = can('sites.write');
  const test = async (s) => { const r = await run(() => api.post(`/sites/${s.id}/test`)); if (r) { toast(r.message, r.ok ? undefined : 'bad'); st.reload(); } };
  const toggle = async (s) => { if (await run(() => api.put(`/sites/${s.id}`, { status: s.status === 'active' ? 'paused' : 'active' }), s.status === 'active' ? 'Site duraklatıldı' : 'Site etkinleştirildi')) st.reload(); };
  return (
    <div className="page">
      <PageHead title="Web Sitelerim" actions={admin && <button className="btn primary" onClick={() => setModal({ add: true })}><Plus size={15} />Site ekle</button>}>
        Makaleler, siz bir WordPress sitesi bağlayana kadar arşivde (Araştırma ve Arşiv Modu) bekler. Her site kendi uygulama şifresi, günlük yayın limiti ve kategori eşleştirmesiyle bağlanır; aynı makale aynı siteye iki kez gönderilmez. <strong>Bağlantıyı yalnızca yönetici kurar ve herkese açık yayın yalnızca yöneticiden çıkar.</strong>
      </PageHead>
      <Async state={st}>{(d) => d && (d.sites.length === 0 ? <Card><Empty title="Henüz WordPress sitesi bağlı değil">Yeni bir alan adı alıp WordPress kurduktan sonra “Site ekle” ile bağlayın; arşivdeki makaleleri sonra “Toplu Yayınlama”dan gönderirsiniz.</Empty></Card> : (
        <div className="stack">{d.sites.map((s) => (
          <Card key={s.id} title={s.name} actions={<>{s.status === 'paused' ? <Badge kind="warn">Duraklatıldı</Badge> : <Badge kind="ok">Etkin</Badge>}{s.lastTestOk === true && <Badge kind="ok">bağlantı çalışıyor</Badge>}{s.lastTestOk === false && <Badge kind="bad">bağlantı sorunlu</Badge>}{s.lastTestOk === null && <Badge>test edilmedi</Badge>}</>}>
            <div className="stack">
              <div className="row"><Link2 size={14} /><a href={s.apiUrl} target="_blank" rel="noopener noreferrer nofollow">{s.apiUrl}</a><span className="faint">· kullanıcı {s.username} · şifre …{s.passwordLast4}</span></div>
              {s.lastTestMessage && <Alert kind={s.lastTestOk ? 'ok' : 'bad'}>{s.lastTestMessage}{s.lastTestedAt && <small className="faint"> · {dt(s.lastTestedAt)}</small>}</Alert>}
              <div className="row"><Badge>günlük limit {s.dailyLimit}</Badge><Badge>SEO: {s.seoPlugin === 'none' ? 'eklenti yok' : s.seoPlugin}</Badge><Badge kind="info">{s.counts.published} yayında</Badge><Badge kind="info">{s.counts.scheduled} zamanlı</Badge><Badge>{s.counts.total} gönderim</Badge></div>
              <div className="row">{admin && <>
                <button className="btn sm" disabled={busy} onClick={() => test(s)}><RefreshCw size={14} />Bağlantıyı test et</button>
                <button className="btn sm" onClick={() => setModal({ cat: s })}>Kategori eşleştirme</button>
                <button className="btn sm" onClick={() => setModal({ edit: s })}>Ayarlar</button>
                <button className="btn sm" disabled={busy} onClick={() => toggle(s)}>{s.status === 'active' ? 'Duraklat' : 'Etkinleştir'}</button></>}</div>
            </div>
          </Card>))}</div>
      ))}</Async>
      {modal && modal.add && <SiteModal projectId={projectId} onClose={() => setModal(null)} onSaved={(s) => { st.reload(); if (s && s.id) api.post(`/sites/${s.id}/test`).then(() => st.reload()).catch(() => {}); }} />}
      {modal && modal.edit && <SiteModal projectId={projectId} site={modal.edit} onClose={() => setModal(null)} onSaved={() => st.reload()} />}
      {modal && modal.cat && <CategoryModal site={modal.cat} onClose={() => setModal(null)} />}
    </div>
  );
}
