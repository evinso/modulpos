import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Field, PageHead, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, num, shortDay, usd } from '../format.js';
import CostAnalysis from './CostAnalysis.jsx';

function Provider({ p, canEdit, onChanged }) {
  const { confirm } = useApp();
  const [f, setF] = useState({ secret: '', extra: p.extra || {}, daily: p.dailyBudgetUsd ?? '', monthly: p.monthlyBudgetUsd ?? '' });
  const [run, busy] = useAction();
  const [test, setTest] = useState(null);
  useEffect(() => { setF({ secret: '', extra: p.extra || {}, daily: p.dailyBudgetUsd ?? '', monthly: p.monthlyBudgetUsd ?? '' }); }, [p]);
  const save = async () => {
    const body = { extra: f.extra, dailyBudgetUsd: f.daily === '' ? null : Number(f.daily), monthlyBudgetUsd: f.monthly === '' ? null : Number(f.monthly) };
    if (f.secret.trim()) body.secret = f.secret.trim();
    if (await run(() => api.put(`/providers/${p.key}`, body), `${p.label} kaydedildi`)) { setTest(null); onChanged(); }
  };
  const doTest = async () => { const r = await run(() => api.post(`/providers/${p.key}/test`)); if (r) { setTest(r); onChanged(); } };
  const clear = async () => { if (await confirm({ title: `${p.label} anahtarı silinsin mi?`, body: 'Kayıtlı anahtar sunucudan silinir. Bu servisi kullanan işler çalışmaz.', confirmText: 'Sil', danger: true }) && await run(() => api.put(`/providers/${p.key}`, { clearSecret: true }), 'Anahtar silindi')) onChanged(); };
  const res = test || (p.lastTestedAt ? { ok: p.lastTestOk, message: p.lastTestMessage } : null);
  const hasModelField = p.extraFields.some((x) => x.key === 'model');
  const needsModel = p.configured && hasModelField && ['gemini', 'openai'].includes(p.key) && !(p.extra && p.extra.model);          // Claude has a default model
  const [picked, setPicked] = useState('');
  const [pickedImg, setPickedImg] = useState('');
  const useModel = async (model, field = 'model') => {
    if (!model) return;
    if (await run(() => api.put(`/providers/${p.key}`, { extra: { ...f.extra, [field]: model } }), `${field === 'imageModel' ? 'Görsel modeli' : 'Model'} seçildi: ${model}`)) {
      setPicked(''); setPickedImg(''); const again = await run(() => api.post(`/providers/${p.key}/test`));                  // the saved message must describe the state NOW ("a model is still missing" is no longer true)
      setTest(again ? { ...again, models: undefined } : null); onChanged();
    }
  };
  return (
    <Card title={p.label} actions={p.configured ? <Badge kind="ok">Kayıtlı · …{p.secretLast4}</Badge> : <Badge>Anahtar yok</Badge>}>
      <div className="stack">
        <p className="muted">{p.help}</p>
        {canEdit && <Field label={p.secretLabel} hint={p.configured ? 'Güvenlik için kayıtlı anahtar gösterilmez. Değiştirmek için yenisini yazın; boş bırakırsanız eskisi kalır.' : 'Sunucuda şifreli saklanır, bir daha gösterilmez.'}>
          <input className="input" type="password" autoComplete="off" value={f.secret} placeholder={p.configured ? `•••• •••• ${p.secretLast4}` : ''} onChange={(e) => setF({ ...f, secret: e.target.value })} /></Field>}
        {p.extraFields.map((x) => <Field key={x.key} label={x.label}><input className="input" disabled={!canEdit} value={f.extra[x.key] || ''} onChange={(e) => setF({ ...f, extra: { ...f.extra, [x.key]: e.target.value } })} /></Field>)}
        {p.paid && <div className="grid g2"><Field label="Günlük bütçe (USD)" hint="Boş = sınırsız"><input className="input" type="number" min={0} step="0.01" disabled={!canEdit} value={f.daily} onChange={(e) => setF({ ...f, daily: e.target.value })} /></Field>
          <Field label="Aylık bütçe (USD)" hint="Doluysa bu servise yeni istek gitmez"><input className="input" type="number" min={0} step="0.01" disabled={!canEdit} value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} /></Field></div>}
        {needsModel && !(test && test.models) && <Alert kind="warn" title="Anahtar kayıtlı ama model seçilmedi">Makale yazımında kullanılabilmesi için bir <strong>model adı</strong> gerekir (şu an bu sağlayıcı “kullanılamıyor” görünür). “Bağlantıyı test et”e basın: anahtarınızla kullanılabilen modeller listelenir, birini tek tıkla seçersiniz.</Alert>}
        {test && test.models && test.models.length > 0 && canEdit && (
          <Alert kind="info" title="Bu anahtarla kullanılabilen modeller">
            <div className="stack">
              {test.suggested && <div className="row"><span>Öneri: <strong>{test.suggested}</strong> <span className="faint">(kararlı “flash” ailesi; genelde daha hızlı ve daha ucuzdur. Fiyatı Google’ın fiyat sayfasından kontrol edin.)</span></span><button className="btn sm primary" disabled={busy} onClick={() => useModel(test.suggested)}>Bunu kullan</button></div>}
              <div className="row"><select className="input" style={{ width: 'auto', maxWidth: '100%' }} value={picked} onChange={(e) => setPicked(e.target.value)} aria-label={`${p.label} modeli`}><option value="">— başka bir model seç —</option>{test.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                <button className="btn sm" disabled={busy || !picked} onClick={() => useModel(picked)}>Seç ve kaydet</button></div>
            </div></Alert>)}
        {test && test.imageModels && test.imageModels.length > 0 && canEdit && (
          <Alert kind="info" title="Kapak görseli için kullanılabilen modeller">
            <div className="stack">
              {test.suggestedImage && <div className="row"><span>Seçili değilse kullanılacak: <strong>{(p.extra && p.extra.imageModel) || test.suggestedImage}</strong> <span className="faint">(hesabınızdaki en yeni görsel modeli; adlar sık değişir, fiyatı OpenAI hesabınızdan kontrol edin)</span></span>{test.suggestedImage !== (p.extra && p.extra.imageModel) && <button className="btn sm primary" disabled={busy} onClick={() => useModel(test.suggestedImage, 'imageModel')}>Bunu sabitle</button>}</div>}
              <div className="row"><select className="input" style={{ width: 'auto', maxWidth: '100%' }} value={pickedImg} onChange={(e) => setPickedImg(e.target.value)} aria-label="OpenAI görsel modeli"><option value="">— başka bir görsel modeli seç —</option>{test.imageModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                <button className="btn sm" disabled={busy || !pickedImg} onClick={() => useModel(pickedImg, 'imageModel')}>Seç ve kaydet</button></div>
            </div></Alert>)}
        {res && <Alert kind={res.ok ? 'ok' : 'bad'} title={res.ok ? 'Bağlantı çalışıyor' : 'Bağlantı başarısız'}>{res.message}{p.lastTestedAt && !test && <small className="faint"> · {dt(p.lastTestedAt)}</small>}</Alert>}
        {canEdit && <div className="row"><button className="btn primary" disabled={busy} onClick={save}>Kaydet</button><button className="btn" disabled={busy || !p.configured} onClick={doTest}>Bağlantıyı test et</button>{p.configured && <button className="btn danger" disabled={busy} onClick={clear}>Anahtarı sil</button>}</div>}
      </div>
    </Card>
  );
}

export default function ApiUsage() {
  const { can } = useApp();
  const [days, setDays] = useState(30);
  const prov = useLoad(() => api.get('/providers'), []);
  const use = useLoad(() => api.get(`/usage${qs({ days, limit: 50 })}`), [days]);
  const canEdit = can('providers.write');
  return (
    <div className="page">
      <PageHead title="API Kullanımı ve Maliyetler" actions={<select className="input" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Aralık">{[7, 30, 60, 90].map((d) => <option key={d} value={d}>Son {d} gün</option>)}</select>}>
        Harici servislerin anahtarları ve her ücretli çağrının kaydı. Maliyet servisin gerçek fiyatına göre hesaplanır; hesaplanamayan tutar “Bilinmiyor” yazılır, asla 0 gösterilmez.
      </PageHead>
      <Alert kind="info" title="Gerçek servis testi">Aşağıdaki “Bağlantıyı test et” düğmeleri servisin kendi ücretsiz uç noktasını çağırır (OpenAI ve Gemini: modelleri listeler, Apify: hesabı ve aktörü okur, Telegram: botu sorgular). Serper’in ücretsiz bir uç noktası olmadığı için onun testi gerçek bir sorgu yapar ve 1 kredi harcar. Anahtarlarınızı girmeden test edilemez.</Alert>
      <Async state={prov}>{(d) => <div className="grid g3" style={{ alignItems: 'start' }}>{d.providers.map((p) => <Provider key={p.key} p={p} canEdit={canEdit} onChanged={() => { prov.reload(); use.reload(); }} />)}</div>}</Async>
      <Async state={use}>{(u) => (
        <>
          <div className="grid g4">
            <div className="metric"><span className="l">Bugün</span><span className="v">{usd(u.today.costUsd)}</span><span className="n">{num(u.today.requests)} istek{u.today.unknownCalls > 0 ? ` · ${u.today.unknownCalls} çağrının maliyeti bilinmiyor` : ''}</span></div>
            <div className="metric"><span className="l">Bu ay</span><span className="v">{usd(u.month.costUsd)}</span><span className="n">{num(u.month.requests)} istek{u.month.unknownCalls > 0 ? ` · ${u.month.unknownCalls} çağrının maliyeti bilinmiyor` : ''}</span></div>
          </div>
          <div className="grid g2">
            <Card title={`Sağlayıcıya göre (son ${days} gün)`}>
              {u.providers.length === 0 ? <p className="muted">Bu aralıkta kayıtlı çağrı yok.</p> : (
                <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>Sağlayıcı</th><th className="num">Maliyet</th><th className="num">İstek</th><th className="num">Birim</th><th className="num">Hata</th><th className="num">Bütçe engeli</th></tr></thead>
                  <tbody>{u.providers.map((x) => <tr key={x.provider}><td>{x.provider}</td><td className="num">{usd(x.costUsd)}{x.unknownCalls > 0 && <div className="faint">+{x.unknownCalls} bilinmiyor</div>}</td><td className="num">{num(x.requests)}</td><td className="num">{num(x.units)}</td><td className="num">{num(x.errors)}</td><td className="num">{num(x.blockedByBudget)}</td></tr>)}</tbody></table></div>)}
            </Card>
            <Card title="Günlük maliyet (USD)">
              {u.daily.length === 0 ? <p className="muted">Bu aralıkta maliyet kaydı yok.</p> : (() => {
                const m = new Map(); for (const r of u.daily) m.set(r.day, (m.get(r.day) || 0) + r.costUsd);
                const rows = [...m].map(([day, value]) => ({ label: shortDay(day), value }));
                return <div className="chartbox"><ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--line-soft)" /><XAxis dataKey="label" stroke="var(--text-3)" fontSize={11} /><YAxis stroke="var(--text-3)" fontSize={11} /><Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }} formatter={(v) => [usd(v), 'USD']} /><Area type="monotone" dataKey="value" stroke="var(--accent-2)" fill="var(--accent)" fillOpacity={0.25} /></AreaChart></ResponsiveContainer></div>;
              })()}
            </Card>
          </div>
          <CostAnalysis />
          <Card title="Son çağrılar">
            {u.recent.length === 0 ? <p className="muted">Henüz harici API çağrısı yapılmadı. Anahtar kelime, SERP, yapay zekâ ve Telegram çağrıları yapıldıkça her biri burada (süresi ve maliyetiyle) görünür.</p> : (
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Tarih</th><th>Sağlayıcı</th><th>Uç nokta</th><th>İşlem</th><th className="num">İstek</th><th className="num">Birim</th><th className="num">Maliyet</th><th>Sonuç</th></tr></thead>
                <tbody>{u.recent.map((r) => <tr key={r.id}><td className="faint">{dt(r.createdAt)}</td><td>{r.provider}</td><td className="mono clip">{r.endpoint || '—'}</td><td>{r.operation || '—'}</td><td className="num">{num(r.requests)}</td><td className="num">{r.units === null ? '—' : num(r.units)}</td>
                  <td className="num">{r.costUsd === null ? <Badge>Bilinmiyor</Badge> : r.costText}</td><td><Badge kind={r.result === 'ok' ? 'ok' : r.result === 'error' ? 'bad' : 'warn'}>{r.result === 'blocked_budget' ? 'bütçe engeli' : r.result}</Badge></td></tr>)}</tbody></table></div>)}
          </Card>
        </>
      )}</Async>
    </div>
  );
}
