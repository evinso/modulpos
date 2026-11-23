import { useEffect, useState } from 'react';
import { PauseCircle, PlayCircle, RotateCcw } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, PageHead, useAction, useApp, useLoad } from '../ui.jsx';
import { num } from '../format.js';

const toNum = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const same = (a, b) => String(a ?? '') === String(b ?? '');

function LimitInput({ value, onChange, max, disabled, label, placeholder }) {
  const n = toNum(value);
  const invalid = n !== null && (!Number.isInteger(n) || n < 0 || n > max);
  return <input className="input num" type="number" min={0} max={max} value={value ?? ''} placeholder={placeholder} disabled={disabled} aria-label={label} aria-invalid={invalid} style={invalid ? { borderColor: 'var(--bad)' } : undefined} onChange={(e) => onChange(e.target.value)} />;
}

export default function Limits() {
  const { projectId, project, can, confirm } = useApp();
  const canEdit = can('settings.write');
  const st = useLoad(() => api.get(`/limits${qs({ projectId })}`), [projectId]);
  const [g, setG] = useState({}); const [p, setP] = useState({}); const [c, setC] = useState({});
  const [run, busy] = useAction();
  useEffect(() => {
    const d = st.data; if (!d) return;
    setG(Object.fromEntries(d.global.map((i) => [i.workType, i.isDefault ? '' : i.limit])));
    setP(Object.fromEntries(d.global.map((i) => [i.workType, i.project ? i.project.limit : ''])));
    setC(Object.fromEntries(d.categories.map((x) => [x.id, { dailyMax: x.daily_max ?? '', publishMax: x.publish_max ?? '' }])));
  }, [st.data]);

  const pause = async (paused) => {
    if (paused && !(await confirm({ title: 'Botlar duraklatılsın mı?', body: 'Otomatik işler yeni iş başlatmaz. Sizin elle başlattığınız işler limitlere tabi olarak çalışmaya devam eder.', confirmText: 'Duraklat' }))) return;
    if (await run(() => api.post(paused ? '/bots/pause' : '/bots/resume'), paused ? 'Botlar duraklatıldı' : 'Botlar devam ediyor')) st.reload();
  };
  const saveGlobal = async () => {
    const d = st.data; const out = {};
    for (const i of d.global) { const was = i.isDefault ? '' : i.limit; if (!same(g[i.workType], was)) out[i.workType] = toNum(g[i.workType]); }
    if (Object.keys(out).length && await run(() => api.put('/limits/global', { limits: out }), 'Genel limitler kaydedildi')) st.reload();
  };
  const saveProject = async () => {
    const d = st.data; const out = {};
    for (const i of d.global) { const was = i.project ? i.project.limit : ''; if (!same(p[i.workType], was)) out[i.workType] = toNum(p[i.workType]); }
    if (Object.keys(out).length && await run(() => api.put(`/limits/projects/${projectId}`, { limits: out }), 'Proje limitleri kaydedildi')) st.reload();
  };
  const saveCats = async () => {
    const d = st.data;
    const changed = d.categories.filter((x) => !same(c[x.id].dailyMax, x.daily_max) || !same(c[x.id].publishMax, x.publish_max));
    const ok = await run(async () => { for (const x of changed) await api.put(`/limits/categories/${x.id}`, { dailyMax: toNum(c[x.id].dailyMax), publishMax: toNum(c[x.id].publishMax) }); }, 'Kategori limitleri kaydedildi');
    if (ok) st.reload();
  };
  const reset = async () => { if (await confirm({ title: 'Genel limitler varsayılana dönsün mü?', body: 'Tüm genel limitler fabrika değerlerine döner (yeni makale 3, eski makale kontrolü 10, kapsamlı güncelleme 2 …). Proje ve kategori limitleri değişmez.', confirmText: 'Varsayılana dön' }) && await run(() => api.post('/limits/reset', { projectId }), 'Varsayılan limitler geri yüklendi')) st.reload(); };

  return (
    <div className="page">
      <PageHead title="Günlük Çalışma Ayarları">Her işin günde en fazla kaç kez yapılacağını kod değiştirmeden buradan yönetin. Değişiklik kaydedildiği anda geçerli olur; bir iş başlamadan önce üç seviye birden kontrol edilir: <strong>genel → proje → kategori</strong>. En dar sınır kazanır; 0 yazarsanız o iş durur.</PageHead>
      <Async state={st}>{(d) => {
        const paused = d.bots.paused;
        const gDirty = d.global.some((i) => !same(g[i.workType], i.isDefault ? '' : i.limit));
        const pDirty = d.global.some((i) => !same(p[i.workType], i.project ? i.project.limit : ''));
        const pBlank = p.new_article === '' || p.new_article === undefined;                        // the new-article row can never be empty
        const cDirty = d.categories.some((x) => c[x.id] && (!same(c[x.id].dailyMax, x.daily_max) || !same(c[x.id].publishMax, x.publish_max)));
        return (
          <>
            <Alert kind={paused ? 'warn' : 'ok'} title={paused ? 'Botlar duraklatıldı' : 'Botlar çalışabilir durumda'}>
              <div className="row between"><span>{paused ? `Duraklatan: ${d.bots.pausedBy || '—'}. Otomatik işler çalışmaz.` : 'Botlar çalışmaya hazır. Bu anahtar kapatılırsa otomatik işler ve limit gerektiren yeni işler durur.'}</span>
                {can('bots.control') && (paused ? <button className="btn sm primary" disabled={busy} onClick={() => pause(false)}><PlayCircle size={15} />Devam ettir</button> : <button className="btn sm" disabled={busy} onClick={() => pause(true)}><PauseCircle size={15} />Botları duraklat</button>)}</div>
            </Alert>
            <Card title={`Genel günlük limitler · ${d.day}`} actions={canEdit && <button className="btn sm" disabled={busy} onClick={reset}><RotateCcw size={14} />Varsayılana dön</button>}>
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>İş türü</th><th className="num">Günlük limit</th><th className="num">Bugün yapılan</th><th className="num">Kalan</th><th>Durum</th></tr></thead>
                <tbody>{d.global.map((i) => (
                  <tr key={i.workType}><td>{i.label}</td>
                    <td className="num"><LimitInput value={g[i.workType]} onChange={(v) => setG((x) => ({ ...x, [i.workType]: v }))} max={i.max} disabled={!canEdit} label={`${i.label} günlük limit`} placeholder={String(i.limit)} /></td>
                    <td className="num">{num(i.done)}</td><td className="num">{i.limit === 0 ? '—' : num(i.remaining)}</td>
                    <td>{(g[i.workType] === '' || g[i.workType] === undefined) ? <Badge>Varsayılan ({i.limit})</Badge> : toNum(g[i.workType]) === 0 ? <Badge kind="bad">Durduruldu</Badge> : <Badge kind="info">Özel</Badge>}{i.limit > 0 && i.remaining === 0 && <> <Badge kind="warn">Bugün doldu</Badge></>}</td></tr>))}</tbody></table></div>
              <div className="row between" style={{ marginTop: 12 }}><small className="faint">Boş bırakırsanız varsayılan değer kullanılır. Üst sınırlar: yeni makale 50, eski makale kontrolü 500, güncelleme 50, yayın 200, anahtar kelime 5000, SERP 2000, haber 5000.</small>
                {canEdit && <button className="btn primary" disabled={busy || !gDirty} onClick={saveGlobal}>Genel limitleri kaydet</button>}</div>
            </Card>
            {projectId && project ? (
              <Card title={`Proje limitleri · ${project.name}`}>
                <p className="muted" style={{ marginBottom: 10 }}>Bu projenin kendi günlük sınırı. Her işte <strong>en dar sınır</strong> geçerlidir (genel → proje → kategori). “Yeni makale” sınırı Strateji sayfasındaki günlük içerik limitiyle aynıdır ve <strong>boş bırakılamaz</strong> (her projenin bir günlük makale sınırı olmalı: yapay zekâ harcamasına karşı korumadır; varsayılan 3, en çok 50). Günde 3’ten fazla makale istiyorsanız yukarıdaki “Genel günlük limitler”deki yeni makale sayısını da yükseltin. Diğer satırlarda boş = bu proje için ayrı sınır yok (genel sınır geçerli).</p>
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th>İş türü</th><th className="num">Proje limiti</th><th className="num">Bugün (bu proje)</th><th className="num">Kalan</th></tr></thead>
                  <tbody>{d.global.map((i) => <tr key={i.workType}><td>{i.label}</td><td className="num"><LimitInput value={p[i.workType]} onChange={(v) => setP((x) => ({ ...x, [i.workType]: v }))} max={i.max} disabled={!canEdit} label={`${i.label} proje limiti`} placeholder={i.workType === 'new_article' ? 'zorunlu' : undefined} /></td>
                    <td className="num">{i.project ? num(i.project.done) : '—'}</td><td className="num">{i.project ? num(i.project.remaining) : '—'}</td></tr>)}</tbody></table></div>
                {canEdit && <div className="row end" style={{ marginTop: 12 }}>{pBlank && <small style={{ color: 'var(--bad)' }}>“Yeni makale” proje limiti boş bırakılamaz: 0 ile {d.global.find((x) => x.workType === 'new_article').max} arası bir sayı yazın.</small>}<button className="btn primary" disabled={busy || !pDirty || pBlank} onClick={saveProject}>Proje limitlerini kaydet</button></div>}
              </Card>
            ) : <Card><Empty title="Proje limitleri">Proje ve kategori limitlerini düzenlemek için üstteki menüden bir proje seçin.</Empty></Card>}
            {projectId && d.categories.length > 0 && (
              <Card title="Kategori limitleri">
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Kategori</th><th className="num">Günlük yeni makale</th><th className="num">Günlük yayın</th></tr></thead>
                  <tbody>{d.categories.map((x) => c[x.id] && (
                    <tr key={x.id}><td>{x.name_en}<div className="faint">{x.name}</div></td>
                      <td className="num"><LimitInput value={c[x.id].dailyMax} onChange={(v) => setC((s) => ({ ...s, [x.id]: { ...s[x.id], dailyMax: v } }))} max={50} disabled={!canEdit} label={`${x.name_en} günlük yeni makale`} /></td>
                      <td className="num"><LimitInput value={c[x.id].publishMax} onChange={(v) => setC((s) => ({ ...s, [x.id]: { ...s[x.id], publishMax: v } }))} max={200} disabled={!canEdit} label={`${x.name_en} günlük yayın`} /></td></tr>))}</tbody></table></div>
                {canEdit && <div className="row end" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy || !cDirty} onClick={saveCats}>Kategori limitlerini kaydet</button></div>}
              </Card>
            )}
            {!canEdit && <Alert kind="info">Limitleri yalnızca yönetici (admin) değiştirebilir.</Alert>}
          </>
        );
      }}</Async>
    </div>
  );
}
