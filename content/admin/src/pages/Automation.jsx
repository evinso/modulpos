import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, Hand, UserCheck, Bot as BotIcon, CheckCircle2, CircleAlert, Wand2 } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Check, Field, NeedsProject, PageHead, useAction, useApp, useLoad } from '../ui.jsx';
import { usd } from '../format.js';

const MODE_ICON = { manual: Hand, semi: UserCheck, full: BotIcon };
const FIELDS = ['dailyArticles', 'dailyPublish', 'writerFrom', 'writerTo', 'publishFrom', 'publishTo', 'weekends', 'minQuality', 'dailyBudgetUsd'];

/** The values as the server wants them (numbers as numbers, an empty budget = no limit) */
function bodyValues(f, keys) {
  const out = {};
  for (const k of keys) {
    if (k === 'dailyBudgetUsd') out[k] = f[k] === '' || f[k] === null ? null : Number(f[k]);
    else if (['dailyArticles', 'dailyPublish', 'minQuality'].includes(k)) out[k] = Number(f[k]);
    else out[k] = f[k];
  }
  return out;
}

function Missing({ list }) {
  if (!list || !list.length) return null;
  return <div className="faint" style={{ fontSize: 12 }}>Gerekli: {list.map((m, i) => <span key={m.text}>{i > 0 && ' · '}<Link to={m.to}>{m.text}</Link></span>)}</div>;
}

/** Otomasyon Modu: three modes, the checkboxes behind them and the values that keep a new site on a sane path. It only edits settings that already exist elsewhere. */
export default function Automation() {
  const { projectId, can, confirm } = useApp();
  const canEdit = can('bots.control');
  const st = useLoad(() => (projectId ? api.get(`/automation${qs({ projectId })}`) : Promise.resolve(null)), [projectId]);
  const [sel, setSel] = useState({}); const [f, setF] = useState(null); const [touched, setTouched] = useState(new Set()); const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    const d = st.data; if (!d) return;
    setSel(Object.fromEntries(d.options.map((o) => [o.key, o.on])));
    setF({ ...d.values, dailyBudgetUsd: d.values.dailyBudgetUsd === null ? '' : d.values.dailyBudgetUsd }); setTouched(new Set());
  }, [st.data]);
  const dirty = useMemo(() => !!(st.data && st.data.options.some((o) => !!sel[o.key] !== o.on)), [st.data, sel]);
  if (!projectId) return <NeedsProject />;
  const set = (k) => (e) => { const v = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e; setF((x) => ({ ...x, [k]: v })); setTouched((t) => new Set([...t, k])); };

  const toggle = (o, on) => setSel((x) => {
    const n = { ...x, [o.key]: on };
    if (o.key === 'publishLive' && on) n.publishing = true;                 // "publish live" is a way of sending: it needs sending
    if (o.key === 'publishing' && !on) n.publishLive = false;
    return n;
  });

  /** sends the change; a refusal that asks for a yes is shown in words and, if given, sent again with confirm */
  const send = async (body, okText) => {
    const out = await run(async () => {
      try { return await api.put('/automation', { projectId, ...body }); }
      catch (e) {
        if (e.status === 409 && e.data && e.data.requiresConfirmation) {
          const yes = await confirm({ title: 'Siz bakmadan yayına çıkacak', body: e.message, confirmText: 'Evet, devam et', danger: true });
          if (!yes) throw new Error('Onaylanmadı; hiçbir şey değiştirilmedi');
          return api.put('/automation', { projectId, ...body, confirm: true });
        }
        throw e;
      }
    }, okText);
    if (out && out.applied) { setResult(out.applied); st.reload(); }
  };
  const differs = (keys) => keys.filter((k) => String(f[k] ?? '') !== String(st.data.values[k] ?? ''));        // only what the person really changed is sent: the rest is left exactly as it is
  const applyMode = (mode) => send({ mode, values: mode === 'manual' ? undefined : bodyValues(f, [...touched]) }, 'Otomasyon modu uygulandı');
  const saveOptions = () => send({ mode: 'custom', options: sel, values: bodyValues(f, differs(FIELDS)) }, 'Seçimler uygulandı');
  const fillRecommended = () => { const r = st.data.recommended; setF({ ...r, dailyBudgetUsd: r.dailyBudgetUsd === null ? '' : r.dailyBudgetUsd }); setTouched(new Set(FIELDS)); };

  return (
    <div className="page">
      <PageHead title="Otomasyon Modu">
        Sistemin ne kadarının kendi kendine çalışacağını buradan seçersiniz. Bu sayfanın kendine ait bir ayarı yoktur: aşağıdaki seçenekler Bot Yönetimi, Günlük Çalışma Ayarları ve Ayarlar’daki gerçek anahtarları açıp kapatır; bu sayfadan yaptığınız değişiklik oralarda da görünür. Zorunlu kontroller (doğruluk, AdSense riski, tekrar, kalite) hiçbir modda kapanmaz.
      </PageHead>
      <Async state={st}>{(d) => d && f && (
        <div className="stack">
          {!canEdit && <Alert kind="info">Bu sayfayı yalnızca yönetici (admin) değiştirebilir; siz görüntüleyebilirsiniz.</Alert>}
          <Alert kind={d.mode === 'full' ? 'warn' : 'info'} title={`Şu anki mod: ${d.modeLabel}`}>{d.summary}</Alert>
          {d.warnings.map((w) => <Alert key={w.text} kind={w.kind === 'bad' ? 'bad' : w.kind === 'warn' ? 'warn' : 'info'}>{w.text}{w.to && <> <Link to={w.to}>Aç</Link></>}</Alert>)}

          <div className="grid g3">
            {d.modes.map((m) => {
              const Icon = MODE_ICON[m.key] || Zap; const current = d.mode === m.key;
              return (
                <Card key={m.key} title={<span className="row" style={{ gap: 8 }}><Icon size={17} />{m.label}{current && <Badge kind="ok">şu an bu</Badge>}</span>}>
                  <div className="stack">
                    <p>{m.about}</p>
                    {m.blockedBy.length > 0 && !m.applicable && <Alert kind="warn" title="Bu mod için eksikler var">{m.blockedBy.map((x) => <div key={x.text}><Link to={x.to}>{x.text}</Link></div>)}</Alert>}
                    {m.applicable && m.skips.length > 0 && <small className="faint">Bağlı olmadığı için açılmayacaklar: {m.skips.map((s) => s.label).join(', ')}.</small>}
                    <button className={`btn ${m.key === 'full' ? 'danger' : 'primary'}`} disabled={!canEdit || busy || !m.applicable || current} onClick={() => applyMode(m.key)}>{current ? 'Uygulandı' : `${m.label} modunu uygula`}</button>
                  </div>
                </Card>
              );
            })}
          </div>

          {result && (
            <Alert kind="ok" title="Son uygulama">
              {result.changes.length === 0 ? 'Zaten bu durumdaydı: hiçbir şey değişmedi.' : <ul style={{ margin: '4px 0 0 18px' }}>{result.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
              {result.skipped.length > 0 && <div style={{ marginTop: 6 }}>Açılamayanlar (eksik bağlantı): {result.skipped.map((s) => `${s.label} (${s.missing.map((m) => m.text).join(', ')})`).join('; ')}</div>}
            </Alert>
          )}

          <Card title="Seçenekler" actions={canEdit && <button className="btn primary" disabled={busy || !dirty} onClick={saveOptions}>Seçimi uygula</button>}>
            <div className="stack">
              {d.groups.map((g) => (
                <div key={g.key} className="stack">
                  <strong>{g.label}</strong>
                  {d.options.filter((o) => o.group === g.key).map((o) => (
                    <div key={o.key} className="stack" style={{ gap: 2, paddingLeft: 4 }}>
                      <Check checked={!!sel[o.key]} disabled={!canEdit || busy || (!o.ready && !o.on)} onChange={(v) => toggle(o, v)}>
                        <span>{o.label}{o.spends && <> <Badge kind="info" title="Yapay zekâ ya da veri kredisi harcar">ücretli</Badge></>}{o.risk && <> <Badge kind="warn" title="Sizi onay sürecinden çıkarır">dikkat</Badge></>}</span>
                      </Check>
                      <small className="faint" style={{ marginLeft: 24 }}>{o.help}</small>
                      {!o.ready && <div style={{ marginLeft: 24 }}><Missing list={o.missing} /></div>}
                    </div>
                  ))}
                </div>
              ))}
              <small className="faint">“Seçimi uygula” bu kutuların tam olarak işaretlendiği hâli kaydeder (mod “Özel” olabilir). Hazır olmayan bir seçenek, gerekli bağlantı kurulana kadar işaretlenemez.</small>
            </div>
          </Card>

          <Card title="Değerler" actions={canEdit && <button className="btn" disabled={busy} onClick={fillRecommended}><Wand2 size={15} />Önerilen değerleri yaz</button>}>
            <div className="stack">
              <p className="muted">Yeni bir alan adı için günde birkaç iyi yazı, çok sayıda zayıf yazıdan daha sağlıklıdır. Bir mod düğmesine bastığınızda burada <strong>değiştirmediğiniz</strong> değerler önerilene çekilir; değiştirdikleriniz olduğu gibi kalır. “Seçimi uygula” ise burada ne yazıyorsa onu kaydeder.</p>
              <div className="grid g3">
                <Field label="Günlük yeni makale" hint={`Önerilen ${d.recommended.dailyArticles}. Bu sınır aşılamaz.`}><input className="input num" type="number" min={1} max={d.max.dailyArticles} value={f.dailyArticles} onChange={set('dailyArticles')} disabled={!canEdit} aria-label="Günlük yeni makale" /></Field>
                <Field label="Günlük WordPress yayını" hint={`Önerilen ${d.recommended.dailyPublish}.`}><input className="input num" type="number" min={1} max={d.max.dailyPublish} value={f.dailyPublish} onChange={set('dailyPublish')} disabled={!canEdit} aria-label="Günlük WordPress yayını" /></Field>
                <Field label="En düşük kalite puanı" hint={`Önerilen ${d.recommended.minQuality}. Altındaki makale hazır sayılmaz.`}><input className="input num" type="number" min={50} max={100} value={f.minQuality} onChange={set('minQuality')} disabled={!canEdit} aria-label="En düşük kalite puanı" /></Field>
                <Field label="Yazım saatleri" hint="Makale botunun çalıştığı saat aralığı"><div className="row"><input className="input" type="time" value={f.writerFrom} onChange={set('writerFrom')} disabled={!canEdit} aria-label="Yazım başlangıcı" /><span>–</span><input className="input" type="time" value={f.writerTo} onChange={set('writerTo')} disabled={!canEdit} aria-label="Yazım bitişi" /></div></Field>
                <Field label="Yayın saatleri" hint="WordPress’e gönderim bu saatler içinde"><div className="row"><input className="input" type="time" value={f.publishFrom} onChange={set('publishFrom')} disabled={!canEdit} aria-label="Yayın başlangıcı" /><span>–</span><input className="input" type="time" value={f.publishTo} onChange={set('publishTo')} disabled={!canEdit} aria-label="Yayın bitişi" /></div></Field>
                <Field label="Günlük toplam bütçe (USD)" hint={`Boş = sınır yok. Önerilen ${usd(d.recommended.dailyBudgetUsd)}. Yalnızca fiyatı bilinen harcamayı sayar.`}><input className="input num" type="number" min={0} step="0.5" value={f.dailyBudgetUsd} onChange={set('dailyBudgetUsd')} disabled={!canEdit} placeholder="sınırsız" aria-label="Günlük toplam bütçe" /></Field>
              </div>
              <Check checked={!!f.weekends} onChange={set('weekends')} disabled={!canEdit}>Hafta sonu da yayınla</Check>
            </div>
          </Card>

          <Card title="Başlamadan önce kontrol listesi">
            <div className="stack">
              {d.checklist.map((c) => (
                <div key={c.key} className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  {c.ok ? <CheckCircle2 size={17} style={{ color: 'var(--ok)', flex: 'none' }} /> : <CircleAlert size={17} style={{ color: 'var(--warn)', flex: 'none' }} />}
                  <div><strong>{c.label}</strong>: {c.detail} {!c.ok && <Link to={c.to}>Düzelt</Link>}</div>
                </div>
              ))}
              {d.readyBacklog > 0 && <small className="faint">Şu an “Yayına hazır” durumunda, henüz hiçbir siteye gönderilmemiş {d.readyBacklog} makale var; gönderim açılırsa günlük yayın limiti kadarı gider.</small>}
            </div>
          </Card>
        </div>
      )}</Async>
    </div>
  );
}
