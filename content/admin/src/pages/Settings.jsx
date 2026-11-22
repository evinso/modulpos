import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Check, Field, Modal, PageHead, Tabs, useAction, useApp, useLoad } from '../ui.jsx';
import { csvList, dt, lines } from '../format.js';

const F = {
  news: { title: 'Haber tarama', about: 'Dünya gündemini ne sıklıkla ve hangi ülkeler için taranacağı.', fields: [
    { k: 'enabled', t: 'bool', l: 'Haber botu aktif', hint: 'Taramanın sıklığı ve çalışma saatleri Bot Yönetimi sayfasındadır; bu anahtar yalnızca bu projede haber taramasını tümden kapatır.' }, { k: 'countries', t: 'csv', l: 'Hedef ülkeler (virgülle, 2 harfli)' },
    { k: 'maxAgeHours', t: 'int', l: 'En eski haber (saat)', min: 1, max: 720, hint: 'Bundan eski haberler alınmaz.' }, { k: 'minRelevance', t: 'int', l: 'Minimum nişe uygunluk puanı', min: 0, max: 100, hint: 'Varsayılan 35: tek bir güçlü terim yeter, genel kelimeler tek başına yetmez.' },
    { k: 'maxItemsPerSource', t: 'int', l: 'Kaynak başına en çok haber (tarama başına)', min: 5, max: 100 }] },
  seo: { title: 'SEO araştırması', about: 'Anahtar kelime filtreleri, SERP veri kaynağı ve API önbellek süresi.', fields: [
    { k: 'enabled', t: 'bool', l: 'SEO botu aktif', hint: 'Fırsat puanlama, niş keşfi, anahtar kelime ve SERP botlarını bu projede tümden kapatır; zamanlama Bot Yönetimi’ndedir.' }, { k: 'minVolume', t: 'int', l: 'Minimum aylık aranma hacmi', min: 0, max: 1000000 }, { k: 'countries', t: 'csv', l: 'Hedef ülkeler (ilki birincil ülke)' }, { k: 'serpDevice', t: 'select', l: 'SERP cihazı (yalnızca DataForSEO)', opts: [['desktop', 'Masaüstü'], ['mobile', 'Mobil']] },
      { k: 'serpProvider', t: 'select', l: 'SERP veri kaynağı', opts: [['serper', 'Serper.dev (2.500 ücretsiz sorgu ile başlar)'], ['dataforseo', 'DataForSEO (ücretli, bakiye gerekir)']], hint: 'Organik rekabet tahmini hangi servisin Google ilk-10 sonuçlarından hesaplansın. Anahtarı API Kullanımı sayfasında girilir.' },
      { k: 'partialWithApproval', t: 'bool', l: 'Aranma hacmi yokken onayla kısmi puanla üretime izin ver', hint: 'Açıkken: hacim verisi olmayan ama SERP analizi yapılmış fikirler, yalnızca “Kısa liste”ye aldığınızda (sizin onayınızla) ve kısmi puanı eşiği geçtiğinde üretime girer. Kapalıyken hacim verisi olmayan fikir hiç uygun sayılmaz.' }, { k: 'cacheDays', t: 'int', l: 'API önbellek süresi (gün)', min: 1, max: 180, hint: 'Aynı sorgu bu süre içinde tekrar ücretlendirilmez.' }] },
  quality: { title: 'Kalite ve zorunlu kontroller', about: 'Üç zorunlu kontrol kapatılamaz.', fields: [
    { k: 'minScore', t: 'int', l: 'Minimum kalite puanı', min: 50, max: 100 }, { k: 'lengthPref', t: 'select', l: 'Makale uzunluğu', opts: [['short', 'Kısa'], ['standard', 'Standart'], ['long', 'Uzun']] },
    { k: 'tone', t: 'text', l: 'Yazım tonu' }, { k: 'language', t: 'text', l: 'Varsayılan dil' }, { k: 'manualApprovalNewArticles', t: 'bool', l: 'Yeni makaleler için manuel yayın onayı' },
      { k: 'writerProvider', t: 'select', l: 'Makaleyi yazan model', opts: [['auto', 'Otomatik (hazır olan ilk sağlayıcı)'], ['anthropic', 'Claude (Anthropic)'], ['openai', 'OpenAI'], ['gemini', 'Gemini (Google)']], hint: 'Anahtarı ve (OpenAI/Gemini için) model adı API Kullanımı sayfasında girilir.' },
      { k: 'checkerProvider', t: 'select', l: 'Kontrolleri yapan model', opts: [['auto', 'Otomatik (mümkünse yazandan farklı bir model)'], ['anthropic', 'Claude (Anthropic)'], ['openai', 'OpenAI'], ['gemini', 'Gemini (Google)']], hint: 'Bir model kendi yazdığı metni değerlendirmekte yanlı olabilir; iki sağlayıcı bağlıysa “Otomatik” farklı olanı seçer.' },
    { k: 'factCheck', t: 'locked', l: 'Doğruluk kontrolü (zorunlu)' }, { k: 'adsenseCheck', t: 'locked', l: 'AdSense risk kontrolü (zorunlu)' }, { k: 'duplicateCheck', t: 'locked', l: 'Tekrar/kanibalizasyon kontrolü (zorunlu)' }] },
  publishing: { title: 'Yayın', about: 'WordPress yayını Aşama 5’te eklenir; ayarlar şimdiden saklanır.', fields: [
    { k: 'autoPublish', t: 'bool', l: 'Otomatik yayın' }, { k: 'mode', t: 'select', l: 'Yayın şekli', opts: [['draft', 'Taslak olarak gönder'], ['publish', 'Doğrudan yayımla']] }, { k: 'windowStart', t: 'time', l: 'Yayın saat aralığı — başlangıç' }, { k: 'windowEnd', t: 'time', l: 'Yayın saat aralığı — bitiş' },
    { k: 'timezone', t: 'text', l: 'Saat dilimi (ör. Europe/Istanbul)' }, { k: 'weekends', t: 'bool', l: 'Hafta sonu da yayınla' }] },
  update: { title: 'Güncelleme politikası', about: 'Eski makalelerin ne sıklıkla kontrol edileceği (Aşama 6).', fields: [
    { k: 'policy', t: 'select', l: 'Onay politikası', opts: [['manual', 'Her güncelleme elle onaylanır'], ['minor_auto', 'Küçük güncellemeler otomatik'], ['low_risk_auto', 'Düşük riskli güncellemeler otomatik']] },
    { k: 'intervalDays.breaking', t: 'int', l: 'Son dakika haberleri (gün)', min: 1, max: 7 }, { k: 'intervalDays.currentTech', t: 'int', l: 'Güncel teknoloji haberleri (gün)', min: 1, max: 60 }, { k: 'intervalDays.aiTools', t: 'int', l: 'AI araçları (gün)', min: 1, max: 90 },
    { k: 'intervalDays.guides', t: 'int', l: 'Yazılım rehberleri (gün)', min: 1, max: 180 }, { k: 'intervalDays.comparisons', t: 'int', l: 'Karşılaştırmalar (gün)', min: 1, max: 180 }, { k: 'intervalDays.evergreen', t: 'int', l: 'Evergreen içerikler (gün)', min: 7, max: 365 }] },
  scoring: { title: 'Fırsat puanlama ağırlıkları', about: 'Toplam 100 olmalı.', fields: [
    { k: 'trend', t: 'int', l: 'Trend yükselişi', min: 0, max: 100 }, { k: 'competition', t: 'int', l: 'Organik rekabet fırsatı', min: 0, max: 100 }, { k: 'demand', t: 'int', l: 'Aranma talebi', min: 0, max: 100 }, { k: 'relevance', t: 'int', l: 'Nişe uygunluk', min: 0, max: 100 }, { k: 'source', t: 'int', l: 'Kaynak güvenilirliği', min: 0, max: 100 }] },
  budget: { title: 'Platform bütçesi', about: 'Tüm ücretli servislerin toplamı için üst sınır (USD). Her servisin kendi bütçesi API sayfasındadır.', fields: [
    { k: 'dailyTotalUsd', t: 'usd', l: 'Günlük toplam bütçe (USD)', hint: 'Boş = sınırsız' }, { k: 'monthlyTotalUsd', t: 'usd', l: 'Aylık toplam bütçe (USD)', hint: 'Boş = sınırsız' }] },
};
const ORDER = ['news', 'seo', 'quality', 'publishing', 'update', 'scoring', 'budget'];

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const put = (o, path, v) => { const c = JSON.parse(JSON.stringify(o)); const ks = path.split('.'); let t = c; ks.slice(0, -1).forEach((k) => { t = t[k]; }); t[ks[ks.length - 1]] = v; return c; };

function GroupForm({ group, data, projectId, canEdit, onChanged }) {
  const spec = F[group];
  const [v, setV] = useState(data.value);
  const [run, busy] = useAction();
  const { confirm } = useApp();
  useEffect(() => setV(data.value), [data]);
  const dirty = JSON.stringify(v) !== JSON.stringify(data.value);
  const sum = group === 'scoring' ? Object.values(v).reduce((a, b) => a + (Number(b) || 0), 0) : null;
  const val = (f) => { const x = get(v, f.k); return f.t === 'csv' ? (x || []).join(', ') : f.t === 'lines' ? (x || []).join('\n') : x ?? ''; };
  const upd = (f, raw) => setV((s) => put(s, f.k, f.t === 'csv' ? csvList(raw) : f.t === 'lines' ? lines(raw) : f.t === 'int' ? (raw === '' ? '' : Number(raw)) : f.t === 'usd' ? (raw === '' ? null : Number(raw)) : f.t === 'select' ? (/^\d+$/.test(raw) ? Number(raw) : raw) : raw));
  const save = async () => { if (await run(() => api.put(`/settings/${group}`, { value: v, projectId: projectId || undefined }), `${spec.title} kaydedildi`)) onChanged(); };
  const reset = async () => { if (await confirm({ title: 'Varsayılana dönülsün mü?', body: `${spec.title} ayarları fabrika değerlerine döner.`, confirmText: 'Varsayılana dön' }) && await run(() => api.del(`/settings/${group}${qs({ projectId })}`), 'Varsayılana dönüldü')) onChanged(); };
  return (
    <Card title={spec.title} actions={<>{projectId ? (data.overriddenForProject ? <Badge kind="info">Bu proje için özel</Badge> : <Badge>Genel ayarı kullanıyor</Badge>) : data.isDefault ? <Badge>Varsayılan</Badge> : <Badge kind="info">Özelleştirilmiş</Badge>}</>}>
      <p className="muted" style={{ marginBottom: 10 }}>{spec.about}</p>
      <div className="grid g2">{spec.fields.map((f) => (
        <Field key={f.k} label={f.t === 'bool' || f.t === 'locked' ? undefined : f.l} hint={f.hint} className={f.t === 'lines' ? 'span2' : ''}>
          {f.t === 'bool' && <Check checked={get(v, f.k)} onChange={(c) => upd(f, c)} disabled={!canEdit}>{f.l}</Check>}
          {f.t === 'locked' && <Check checked disabled onChange={() => {}}>{f.l} <Badge>kilitli</Badge></Check>}
          {f.t === 'select' && <select className="input" disabled={!canEdit} value={val(f)} onChange={(e) => upd(f, e.target.value)}>{f.opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
          {f.t === 'lines' && <textarea className="input" rows={4} disabled={!canEdit} value={val(f)} onChange={(e) => upd(f, e.target.value)} />}
          {['csv', 'text', 'time'].includes(f.t) && <input className="input" disabled={!canEdit} value={val(f)} placeholder={f.t === 'time' ? '09:00' : ''} onChange={(e) => upd(f, e.target.value)} />}
          {['int', 'usd'].includes(f.t) && <input className="input num" type="number" min={f.min ?? 0} max={f.max} step={f.t === 'usd' ? '0.01' : '1'} disabled={!canEdit} value={val(f)} onChange={(e) => upd(f, e.target.value)} />}
        </Field>))}</div>
      {sum !== null && <p className={`hint ${sum === 100 ? 'ok' : 'bad'}`} style={{ marginTop: 8 }}>Toplam: {sum} {sum !== 100 && '— 100 olmalı'}</p>}
      {canEdit && <div className="row end" style={{ marginTop: 12 }}><button className="btn" disabled={busy} onClick={reset}>Varsayılana dön</button><button className="btn primary" disabled={busy || !dirty || (sum !== null && sum !== 100)} onClick={save}>Kaydet</button></div>}
    </Card>
  );
}

function Automation() {
  const { projectId, project, can } = useApp();
  const [scope, setScope] = useState('global');
  const pid = scope === 'project' ? projectId : null;
  const st = useLoad(() => api.get(`/settings${qs({ projectId: pid })}`), [pid]);
  return (
    <div className="stack">
      <div className="row"><select className="input" style={{ width: 'auto' }} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Kapsam"><option value="global">Genel ayarlar (tüm projeler)</option><option value="project" disabled={!projectId}>{project ? `Yalnızca “${project.name}” için` : 'Proje seçin'}</option></select>
        {scope === 'project' && <span className="muted">Proje ayarı genel ayarın üstüne yazılır. Bütçe ve bot ayarları yalnızca genel olarak yönetilir.</span>}</div>
      <Async state={st}>{(d) => <div className="grid g2" style={{ alignItems: 'start' }}>{ORDER.filter((g) => scope === 'global' || d[g].projectOverride).map((g) => <GroupForm key={`${g}-${pid}`} group={g} data={d[g]} projectId={pid} canEdit={can('settings.write')} onChanged={st.reload} />)}</div>}</Async>
    </div>
  );
}

function Users() {
  const { me } = useApp();
  const st = useLoad(() => api.get('/users'), []);
  const [modal, setModal] = useState(false); const [f, setF] = useState({ email: '', name: '', password: '', role: 'editor' });
  const [run, busy] = useAction();
  const create = async (e) => { e.preventDefault(); if (await run(() => api.post('/users', f), 'Kullanıcı eklendi')) { setModal(false); setF({ email: '', name: '', password: '', role: 'editor' }); st.reload(); } };
  const patch = async (u, body) => { if (await run(() => api.put(`/users/${u.id}`, body), 'Güncellendi')) st.reload(); };
  return (
    <Async state={st}>{(d) => (
      <Card title="Kullanıcılar" actions={<button className="btn sm primary" onClick={() => setModal(true)}><Plus size={14} />Kullanıcı ekle</button>}>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Ad</th><th>E-posta</th><th>Rol</th><th>Durum</th><th>Son giriş</th></tr></thead>
          <tbody>{d.users.map((u) => <tr key={u.id}><td>{u.name} {u.id === me.id && <Badge kind="info">siz</Badge>}</td><td>{u.email}</td>
            <td><select className="input" style={{ width: 'auto' }} value={u.role} onChange={(e) => patch(u, { role: e.target.value })} aria-label={`${u.name} rolü`}><option value="admin">admin</option><option value="editor">editor</option><option value="viewer">viewer</option></select></td>
            <td><Check checked={u.isActive} onChange={(c) => patch(u, { isActive: c })}>{u.isActive ? 'Aktif' : 'Kapalı'}</Check></td><td className="faint">{dt(u.lastLoginAt)}</td></tr>)}</tbody></table></div>
        <small className="faint">admin: her şey · editor: makale ve kategori yazar, log okur · viewer: yalnızca okur. Son aktif yönetici düşürülemez ya da kapatılamaz.</small>
        {modal && <Modal title="Kullanıcı ekle" onClose={() => setModal(false)}><form className="stack" onSubmit={create}>
          <Field label="Ad"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="E-posta"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
          <Field label="Geçici şifre" hint="En az 12 karakter; büyük/küçük harf, rakam, simgeden en az üçü. Kullanıcı girişten sonra değiştirebilir."><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
          <Field label="Rol"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="admin">admin</option><option value="editor">editor</option><option value="viewer">viewer</option></select></Field>
          <div className="row end"><button type="button" className="btn" onClick={() => setModal(false)}>Vazgeç</button><button className="btn primary" disabled={busy}>Ekle</button></div></form></Modal>}
      </Card>
    )}</Async>
  );
}

function System() {
  const st = useLoad(() => api.get('/system'), []);
  return (
    <Async state={st}>{(d) => (
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Card title="Sunucu"><div className="stack">
          <div className="row between"><span>Node</span><span className="mono">{d.node}</span></div><div className="row between"><span>Çalışma süresi</span><span>{Math.round(d.uptimeSeconds / 60)} dk</span></div>
          <div className="row between"><span>Saat dilimi</span><span>{d.timezone}</span></div><div className="row between"><span>Ortam</span><span>{d.production ? 'production' : 'geliştirme'}</span></div>
          <div className="row between"><span>Veritabanı bağlantı havuzu</span><span>{d.config.poolMax}{d.config.databaseSsl ? ' · SSL' : ''}</span></div></div></Card>
        <Card title="Güvenlik yapılandırması"><div className="stack">
          <div className="row between"><span>Şifreleme anahtarı (CONTENT_ENCRYPTION_KEY)</span>{d.config.encryptionKeyConfigured ? <Badge kind="ok">tanımlı</Badge> : <Badge kind="bad">eksik</Badge>}</div>
          <div className="row between"><span>Kurulum anahtarı (CONTENT_SETUP_TOKEN)</span>{d.config.setupTokenConfigured ? <Badge kind="ok">tanımlı</Badge> : <Badge>yok</Badge>}</div>
          <div><span className="lbl">İzinli panel adresleri</span><div className="mono">{d.config.adminOrigins.join(', ')}</div></div>
          {!d.config.encryptionKeyConfigured && <Alert kind="bad">Şifreleme anahtarı yok: API anahtarları kaydedilemez.</Alert>}</div></Card>
        <Card title={`Veritabanı göçleri (${d.migrations.length}/${d.migrationFilesTotal})`}><div className="stack">{d.migrations.map((m) => <div key={m.id} className="row between"><span className="mono">{m.id}</span><span className="faint">{dt(m.appliedAt)}</span></div>)}</div></Card>
      </div>
    )}</Async>
  );
}

export default function Settings() {
  const { can } = useApp();
  const [tab, setTab] = useState('auto');
  const tabs = [['auto', 'Otomasyon ayarları'], ...(can('users.manage') ? [['users', 'Kullanıcılar'], ['system', 'Sistem']] : [])];
  return (
    <div className="page">
      <PageHead title="Sistem Ayarları">Haber, SEO, kalite, yayın, güncelleme ve bütçe ayarları ile kullanıcılar. Günlük iş limitleri ayrı bir sayfadadır: Günlük Çalışma Ayarları.</PageHead>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'auto' && <Automation />}{tab === 'users' && <Users />}{tab === 'system' && <System />}
    </div>
  );
}
