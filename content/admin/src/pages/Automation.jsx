import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, Hand, UserCheck, Bot as BotIcon, CheckCircle2, CircleAlert, Wand2, Loader2, RefreshCw } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Check, Field, NeedsProject, PageHead, useAction, useApp, useLoad } from '../ui.jsx';
import { num, usd } from '../format.js';
import FlowPanel from './FlowPanel.jsx';

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

const STATE = { running: ['Çalışıyor', 'info'], queued: ['Sırada', 'info'], retry: ['Yeniden denenecek', 'warn'], waiting: ['Bekliyor', 'ok'], paused: ['Duraklatıldı', 'warn'], stopped: ['Hatalar nedeniyle durdu', 'bad'], off: ['Kapalı', ''] };
const OUT = { ok: ['Tamam', 'ok'], partial: ['Kısmen', 'warn'], error: ['Hata', 'bad'], skipped: ['Atlandı', ''], cancelled: ['İptal', ''] };
const TRG = { manual: 'elle', schedule: 'zamanlayıcı', retry: 'yeniden deneme', chain: 'zincir' };
const clock = (v) => (v ? new Date(v).toLocaleTimeString('tr-TR') : '—');
const span = (sec) => (sec < 90 ? `${sec} sn` : sec < 5400 ? `${Math.round(sec / 60)} dk` : `${Math.round(sec / 3600)} sa`);
const ago = (v, now) => (v ? `${span(Math.max(0, Math.round((new Date(now) - new Date(v)) / 1000)))} önce` : '');
const inFuture = (v, now) => { if (!v) return ''; const s = Math.round((new Date(v) - new Date(now)) / 1000); return s <= 30 ? 'birazdan' : `${span(s)} sonra (${new Date(v).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })})`; };

/** asks for the live picture now and then every 6 seconds while the tab is visible; a lost connection keeps the last picture and says so */
function useLive(projectId) {
  const [data, setData] = useState(null); const [err, setErr] = useState(null); const [at, setAt] = useState(null);
  const load = useCallback(async () => {
    if (!projectId) return;
    try { const d = await api.get(`/automation/live${qs({ projectId })}`); setData(d); setErr(null); setAt(new Date()); } catch (e) { setErr(e.message || 'Bağlantı kesildi'); }
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return undefined;
    load(); const t = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, 6000);
    return () => clearInterval(t);
  }, [projectId, load]);
  return { data, err, at, reload: load };
}

/** "Anlık durum": which bots work right now and on what, what waits, what is off and why, what finished lately. Read only. */
function LiveStatus({ projectId }) {
  const { data: d, err, at, reload } = useLive(projectId);
  return (
    <Card title="Anlık durum" actions={<span className="row" style={{ gap: 8 }}>{err ? <Badge kind="bad" title={err}>bağlantı kesildi</Badge> : <Badge kind="ok">● canlı</Badge>}<small className="faint">{at ? clock(at) : ''}</small><button className="btn sm" onClick={reload} aria-label="Anlık durumu yenile"><RefreshCw size={14} />Yenile</button></span>}>
      {!d ? <p className="muted">Yükleniyor…</p> : (
        <div className="stack">
          {err && <Alert kind="warn">Sunucuya ulaşılamıyor; aşağıdaki görüntü {clock(at)} anındaki son bilinen durumdur. {err}</Alert>}
          {d.paused && <Alert kind="warn" title="Botlar duraklatıldı">Otomatik işler yeni iş başlatmaz. <Link to="/limits">Günlük Çalışma Ayarları</Link> sayfasından devam ettirebilirsiniz.</Alert>}
          {!d.scheduler.running && <Alert kind="warn" title="Zamanlayıcı bu sunucuda çalışmıyor">Botlar kendiliğinden başlamaz (yalnızca canlı ortamda otomatik açılır). Elle başlattığınız işler çalışır.</Alert>}
          <div className="grid cols-metrics">
            <div className="metric"><span className="l">Şu an çalışan bot</span><span className="v">{num(d.summary.running)}</span><span className="n">{d.summary.enabled} / {d.summary.total} bot açık</span></div>
            <div className="metric"><span className="l">Kuyrukta bekleyen iş</span><span className="v">{num(d.summary.queued)}</span></div>
            <div className="metric"><span className="l">Yazılan / kontrol edilen</span><span className="v">{num(d.pipeline.writing)}</span><span className="n">şu an hattın içinde</span></div>
            <div className="metric"><span className="l">Onayınızı bekleyen</span><span className="v">{num(d.pipeline.needsReview)}</span><Link to="/articles" className="n">Makale Arşivi</Link></div>
            <div className="metric"><span className="l">Yayına hazır</span><span className="v">{num(d.pipeline.ready)}</span><span className="n">{d.pipeline.scheduled} zamanlanmış</span></div>
            <div className="metric"><span className="l">Bugün yazılan</span><span className="v">{d.today.articles.done} / {d.today.articles.limit}</span></div>
            <div className="metric"><span className="l">Bugün yayın</span><span className="v">{d.today.published.done} / {d.today.published.limit}</span></div>
          </div>
          <div className="tbl-wrap"><table className="tbl" aria-label="Botların anlık durumu">
            <thead><tr><th>Bot</th><th>Durum</th><th>Şu an / son sonuç</th><th>Sonraki</th></tr></thead>
            <tbody>{d.bots.map((b) => (
              <tr key={b.key} className={b.state === 'running' ? 'live-run' : ''}>
                <td><strong>{b.label}</strong>{b.spends && <> <Badge kind="info" title="Ücretli çağrı yapar">ücretli</Badge></>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{b.state === 'running' && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', marginRight: 4, verticalAlign: '-2px' }} />}<Badge kind={STATE[b.state][1]}>{STATE[b.state][0]}</Badge>{b.queued > 0 && b.state !== 'queued' && <small className="faint"> +{b.queued} sırada</small>}</td>
                <td>
                  {b.state === 'running' && <div><strong>{b.doing}</strong> <small className="faint">{span(b.runningForSeconds)} süredir{b.trigger ? ` · ${TRG[b.trigger] || b.trigger}` : ''}</small></div>}
                  {b.note && <div className="faint">{b.note}</div>}
                  {b.last ? <div className="row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}><Badge kind={OUT[b.last.outcome][1]}>{OUT[b.last.outcome][0]}</Badge><span>{b.last.message || 'Ayrıntı yok'} <small className="faint">{ago(b.last.at, d.now)}</small></span></div> : b.state !== 'running' && <small className="faint">Henüz çalışma kaydı yok</small>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{b.state === 'retry' ? inFuture(b.retryAt, d.now) : b.nextRunAt ? inFuture(b.nextRunAt, d.now) : '—'}</td>
              </tr>))}</tbody></table></div>
          <div className="stack">
            <strong>Son olaylar (son 24 saat)</strong>
            {d.events.length === 0 ? <small className="faint">Son 24 saatte tamamlanan bir çalışma yok.</small> : (
              <div className="tbl-wrap"><table className="tbl" aria-label="Son olaylar"><tbody>{d.events.map((e, i) => (
                <tr key={`${e.bot}-${e.at}-${i}`}><td style={{ whiteSpace: 'nowrap' }}>{clock(e.at)}</td><td><strong>{e.label}</strong> <small className="faint">{TRG[e.trigger] || e.trigger}{e.seconds !== null ? ` · ${span(e.seconds)}` : ''}</small></td><td><Badge kind={OUT[e.outcome][1]}>{OUT[e.outcome][0]}</Badge></td><td>{e.message || '—'}</td></tr>))}</tbody></table></div>
            )}
          </div>
          <small className="faint">Bu görüntü kendiliğinden yenilenir (6 sn); yalnızca okur, hiçbir şeyi başlatmaz ya da durdurmaz. Bir botu elle çalıştırmak ya da zamanlamasını ayrıntılı düzenlemek için <Link to="/bots">Bot Yönetimi</Link>.</small>
        </div>
      )}
    </Card>
  );
}

/** Otomasyon Modu: three modes, the checkboxes behind them and the values that keep a new site on a sane path. It only edits settings that already exist elsewhere. */
/** what really applies: the narrowest of the platform limit, the project limit (and the site's own limit); says so when the number typed is not what will happen */
function Effective({ e, typed, what }) {
  const t = Number(typed); const cap = (s) => e.caps.find((c) => c.scope === s);
  const names = e.caps.map((c) => `${c.label} ${c.limit}`).join(' · ');
  const platform = cap('platform'); const site = cap('site');
  const lifted = Number.isFinite(t) && platform && t > platform.limit; const siteTight = Number.isFinite(t) && site && t > site.limit;
  return (
    <span style={{ display: 'block', marginTop: 2 }}>
      <strong>Fiilen geçerli: günde en çok {e.value} {what}</strong> <small>({names}; en dar olan geçerlidir)</small>
      {lifted && <small style={{ display: 'block', color: 'var(--warn)' }}>Yazdığınız {t}, genel sınırdan ({platform.limit}) büyük: “Seçimi uygula” genel sınırı da {t} yapar; yoksa günde {platform.limit}’ten fazlası olmaz.</small>}
      {siteTight && <small style={{ display: 'block', color: 'var(--warn)' }}>{site.label} {site.limit}: yazdığınız {t} bundan büyük. Bu sınırı Web Sitelerim sayfasından değiştirirsiniz; buradaki düğme ona dokunmaz.</small>}
    </span>
  );
}

export default function Automation() {
  const { projectId, can, confirm } = useApp();
  const canEdit = can('bots.control');
  const st = useLoad(() => (projectId ? api.get(`/automation${qs({ projectId })}`) : Promise.resolve(null)), [projectId]);
  const [sel, setSel] = useState({}); const [f, setF] = useState(null); const [touched, setTouched] = useState(new Set()); const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    const d = st.data; if (!d) return;
    setSel(Object.fromEntries(d.options.map((o) => [o.key, o.on])));
    setF({ ...d.values, writerFrom: d.values.writerFrom || '', writerTo: d.values.writerTo || '', dailyBudgetUsd: d.values.dailyBudgetUsd === null ? '' : d.values.dailyBudgetUsd }); setTouched(new Set());
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

          <LiveStatus projectId={projectId} />
          <FlowPanel projectId={projectId} />

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
              <p className="muted">Yeni bir alan adı için günde birkaç iyi yazı, çok sayıda zayıf yazıdan daha sağlıklıdır. Bir mod düğmesine bastığınızda, <strong>kendi yazdığınız</strong> sayılar korunur; hâlâ fabrika değerinde duran limitler önerilene çekilir (kalite puanı yalnızca yükseltilir, tanımlı bir bütçe korunur). “Seçimi uygula” ise burada ne yazıyorsa onu kaydeder.</p>
              <div className="grid g3">
                <Field label="Günlük yeni makale" hint={<>{`Önerilen ${d.recommended.dailyArticles}. Bu sınır aşılamaz. `}<Effective e={d.effective.dailyArticles} typed={f.dailyArticles} what="makale" /></>}><input className="input num" type="number" min={1} max={d.max.dailyArticles} value={f.dailyArticles} onChange={set('dailyArticles')} disabled={!canEdit} aria-label="Günlük yeni makale" /></Field>
                <Field label="Günlük WordPress yayını" hint={<>{`Önerilen ${d.recommended.dailyPublish}. `}<Effective e={d.effective.dailyPublish} typed={f.dailyPublish} what="yazı" /></>}><input className="input num" type="number" min={1} max={d.max.dailyPublish} value={f.dailyPublish} onChange={set('dailyPublish')} disabled={!canEdit} aria-label="Günlük WordPress yayını" /></Field>
                <Field label="En düşük kalite puanı" hint={`Önerilen ${d.recommended.minQuality}. Altındaki makale hazır sayılmaz.`}><input className="input num" type="number" min={50} max={100} value={f.minQuality} onChange={set('minQuality')} disabled={!canEdit} aria-label="En düşük kalite puanı" /></Field>
                <Field label="Yazım saatleri" hint={f.writerFrom ? 'Makale botunun çalıştığı saat aralığı' : 'Şu an sınır YOK: bot gece dahil her saat çalışır. Saat aralığı yazıp “Seçimi uygula” deyin.'}><div className="row"><input className="input" type="time" value={f.writerFrom} onChange={set('writerFrom')} disabled={!canEdit} aria-label="Yazım başlangıcı" /><span>–</span><input className="input" type="time" value={f.writerTo} onChange={set('writerTo')} disabled={!canEdit} aria-label="Yazım bitişi" /></div></Field>
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
