import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, PauseCircle, PlayCircle, Play, Rocket } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Check, Empty, Field, Modal, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, usd } from '../format.js';

const JOB = { queued: ['Sırada', 'info'], running: ['Çalışıyor', 'info'], done: ['Bitti', 'ok'], failed: ['Başarısız', 'bad'], cancelled: ['İptal', ''], skipped: ['Atlandı', 'warn'] };
const TRIGGER = { manual: 'elle', schedule: 'zamanlayıcı', chain: 'zincir', retry: 'yeniden' };
const EVERY = [[15, '15 dakikada bir'], [30, '30 dakikada bir'], [60, 'Saatte bir'], [120, '2 saatte bir'], [180, '3 saatte bir'], [240, '4 saatte bir'], [360, '6 saatte bir'], [720, '12 saatte bir'], [1440, 'Günde bir'], [10080, 'Haftada bir']];

function ScheduleModal({ bot, onClose, onSaved }) {
  const s = bot.schedule;
  const [f, setF] = useState({ enabled: s.enabled, intervalMinutes: s.intervalMinutes, windowStart: s.windowStart || '', windowEnd: s.windowEnd || '', weekdaysOnly: s.weekdaysOnly, perRun: s.options.perRun || '' });
  const [run, busy] = useAction();
  const save = async (e) => {
    e.preventDefault();
    const body = { enabled: f.enabled, intervalMinutes: Number(f.intervalMinutes), windowStart: f.windowStart || null, windowEnd: f.windowEnd || null, weekdaysOnly: f.weekdaysOnly };
    if ('perRun' in s.options) body.options = { perRun: Number(f.perRun) };
    if (await run(() => api.put(`/bots/${bot.key}/schedule`, body), `${bot.label} zamanlaması kaydedildi`)) { onSaved(); onClose(); }
  };
  const known = EVERY.some(([m]) => m === Number(f.intervalMinutes));
  return (
    <Modal title={`${bot.label}: zamanlama`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {s.spends && <Alert kind="warn" title="Bu bot para harcar">Yapay zekâ ya da SERP kredisi kullanır. Açık olduğunda her çalışmada günlük limitten yer ayırır, sağlayıcı ve toplam bütçeleri aşmaz; bütçe/limit dolunca iş “atlandı/kısmen” biter. Makaleler yine kendiliğinden yayımlanmaz.</Alert>}
        {s.disabledReason && <Alert kind="bad" title="Bu bot hatalar yüzünden kapatılmıştı">{s.disabledReason}</Alert>}
        <Check checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })}>Otomatik çalışsın</Check>
        <div className="grid g2">
          <Field label="Ne sıklıkla"><select className="input" value={f.intervalMinutes} onChange={(e) => setF({ ...f, intervalMinutes: e.target.value })}>{!known && <option value={f.intervalMinutes}>{f.intervalMinutes} dakikada bir</option>}{EVERY.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></Field>
          {'perRun' in s.options && <Field label="Her çalışmada en fazla" hint="Her çalışmada kaç makale/analiz yapılsın (günlük limit ayrıca geçerli)."><input className="input num" type="number" min={1} max={5} value={f.perRun} onChange={(e) => setF({ ...f, perRun: e.target.value })} /></Field>}
        </div>
        <div className="grid g2">
          <Field label="Çalışma saati: başlangıç" hint={`Saat dilimi: ${s.timezone}. İkisi de boşsa gün boyu.`}><input className="input" type="time" value={f.windowStart} onChange={(e) => setF({ ...f, windowStart: e.target.value })} /></Field>
          <Field label="Çalışma saati: bitiş"><input className="input" type="time" value={f.windowEnd} onChange={(e) => setF({ ...f, windowEnd: e.target.value })} /></Field>
        </div>
        <Check checked={f.weekdaysOnly} onChange={(v) => setF({ ...f, weekdaysOnly: v })}>Yalnızca hafta içi</Check>
        <small className="faint">Ücretsiz sunucu uyursa zamanlayıcı da durur; uyanınca kaçırılan her aralık için değil, yalnızca BİR kez çalışır.</small>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy}>Kaydet</button></div>
      </form>
    </Modal>
  );
}

function Queue({ canControl }) {
  const [status, setStatus] = useState('');
  const st = useLoad(() => api.get(`/jobs${qs({ status, limit: 60 })}`), [status]);
  const [run, busy] = useAction();
  const act = async (j, what) => { if (await run(() => api.post(`/jobs/${j.id}/${what}`), what === 'cancel' ? 'Görev iptal edildi' : 'Görev yeniden kuyruğa alındı')) st.reload(); };
  return (
    <Card flat title="Görev kuyruğu" actions={<select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Durum"><option value="">Hepsi</option>{Object.entries(JOB).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>}>
      <Async state={st}>{(d) => (
        <>
          <div className="row">{Object.entries(JOB).map(([k, [l, kind]]) => <Badge key={k} kind={kind}>{l}: {d.counts[k]}</Badge>)}<small className="faint">Kuyruk veritabanındadır: sunucu yeniden başlasa da işler kaybolmaz; aynı iş iki kez başlatılmaz.</small></div>
          {d.jobs.length === 0 ? <Empty title="Görev yok" /> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>#</th><th>Bot</th><th>Kaynak</th><th>Durum</th><th className="num">Deneme</th><th>Zaman</th><th>Sonuç / hata</th><th /></tr></thead>
              <tbody>{d.jobs.map((j) => (
                <tr key={j.id}><td>{j.id}</td><td>{j.botKey}</td><td>{TRIGGER[j.trigger]}</td><td><Badge kind={JOB[j.status][1]}>{JOB[j.status][0]}</Badge></td><td className="num">{j.attempts}/{j.maxAttempts}</td>
                  <td className="faint">{j.status === 'queued' ? `sıra: ${dt(j.runAfter)}` : dt(j.finishedAt || j.startedAt || j.createdAt)}</td>
                  <td style={{ maxWidth: 360 }} className={j.status === 'failed' ? '' : 'faint'}>{j.lastError && j.status !== 'done' ? j.lastError : (j.result && j.result.message) || '—'}</td>
                  <td className="num">{canControl && j.status === 'queued' && <button className="btn sm" disabled={busy} onClick={() => act(j, 'cancel')}>İptal</button>}{canControl && ['failed', 'cancelled', 'skipped'].includes(j.status) && <button className="btn sm" disabled={busy} onClick={() => act(j, 'retry')}>Yeniden dene</button>}</td></tr>))}</tbody></table></div>)}
        </>
      )}</Async>
    </Card>
  );
}

/** Bot schedules, the pause switch and the manual run (a tab of "Otomasyon ve Ayarlar"). */
export function BotList() {
  const { can, projectId, confirm } = useApp();
  const st = useLoad(() => api.get('/bots'), []);
  const line = useLoad(() => (projectId ? api.get(`/pipeline${qs({ projectId })}`) : Promise.resolve(null)), [projectId]);       // is the production line on? then it runs some of these bots itself
  const owned = line.data && line.data.enabled ? new Set(line.data.ownedBots) : new Set();
  const [run, busy] = useAction();
  const [edit, setEdit] = useState(null);
  const [all, setAll] = useState(null);                                  // the answer of the last "Tüm botları tetikle": the steps in order
  const [watch, setWatch] = useState(false); const since = useRef(0);       // while the sequence runs the table refreshes itself
  useEffect(() => {
    if (!watch) return undefined;
    const iv = setInterval(() => { if (Date.now() - since.current > 1800000) setWatch(false); else st.reload(); }, 5000);
    return () => clearInterval(iv);
  }, [watch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (watch && st.data && Date.now() - since.current > 8000 && st.data.items.every((b) => !b.queued && !b.running)) setWatch(false); }, [st.data, watch]);
  const pause = async (p) => {
    if (p && !(await confirm({ title: 'Botlar duraklatılsın mı?', body: 'Otomatik işler yeni iş başlatmaz. Sizin elle başlattığınız işler limitlere tabi olarak çalışmaya devam eder.', confirmText: 'Duraklat' }))) return;
    if (await run(() => api.post(p ? '/bots/pause' : '/bots/resume'), p ? 'Botlar duraklatıldı' : 'Botlar devam ediyor')) st.reload();
  };
  const now = async (b) => { if (await run(() => api.post(`/bots/${b.key}/run`, { projectId }), `${b.label} kuyruğa alındı`)) st.reload(); };
  const toggle = async (b, enabled) => { if (await run(() => api.put(`/bots/${b.key}/schedule`, { enabled }), enabled ? `${b.label} otomatik çalışacak` : `${b.label} otomatik çalışmayacak`)) st.reload(); };
  const canControl = can('bots.control');
  const runAll = async (d) => {
    const paid = d.items.filter((b) => b.schedule && b.schedule.spends).map((b) => b.label);
    const ok = await confirm({ title: 'Tüm botlar sırayla çalıştırılsın mı?', confirmText: 'Hepsini başlat', body: `${d.items.filter((b) => b.scheduled).length} zamanlanabilir bot, işin bağımlılık sırasına göre BİR kez çalışır: haber taraması → fikir puanlama → niş önerileri → anahtar kelime verisi ve SERP → fikirleri yeniden puanlama → makale yazımı → eksik giderme → WordPress gönderimi → bakım, güncelleme ve raporlar. Her adım öncekiler bitince başlar. Kapalı botlar da bir kez çalışır; çalışamayanlar (anahtar, site ya da yapılacak iş yok) nedenini söyleyerek atlanır.\n\nPara harcayabilenler: ${paid.join(', ')}. Günlük limitler ve bütçeler yine geçerlidir; yayın ayarlarınız (taslak ya da doğrudan yayın) değişmez.` });
    if (!ok) return;
    const r = await run(() => api.post('/bots/run-all', { projectId }));
    if (r) { setAll(r); since.current = Date.now(); setWatch(true); st.reload(); }
  };
  return (
    <div className="stack">
      <p className="muted">Platformun 15 botu. Bir bot yalnızca kodu gerçekten çalışıyorsa “Hazır” görünür. Zamanlanan botlar sunucudaki zamanlayıcı tarafından <strong>kalıcı görev kuyruğu</strong> üzerinden çalıştırılır (n8n yok): sunucu yeniden başlasa görevler kaybolmaz, aynı iş iki kez başlamaz, hatalı iş 1–5–20 dakika arayla yeniden denenir, art arda 5 başarısızlıkta bot kapanır ve size bildirim gelir. Para harcayan botlar (makale, SERP, anahtar kelime verisi) <strong>kapalı</strong> başlar; sizin açmanız gerekir.</p>
      <Async state={st}>{(d) => (
        <>
          <Alert kind={d.paused ? 'warn' : 'info'} title={d.paused ? 'Botlar duraklatıldı' : `${d.items.filter((b) => b.implemented).length} / ${d.items.length} bot hazır`}>
            <div className="row between"><span>Duraklatma, zamanlı bütün otomatik işleri durdurur (sizin elle başlattığınız işler sürer). Zamanlayıcı: {d.scheduler.running ? <>çalışıyor{d.scheduler.lastTickAt ? ` (son kontrol ${dt(d.scheduler.lastTickAt)})` : ''}</> : <strong>bu sunucuda kapalı</strong>}.</span>
              {canControl && <button className="btn sm primary" disabled={busy || !projectId} onClick={() => runAll(d)} title={projectId ? 'Tüm botları mantık sırasına göre bir kez çalıştırır' : 'Önce bir proje seçin'}><Rocket size={15} />Tüm botları tetikle</button>}
              {canControl && (d.paused ? <button className="btn sm primary" disabled={busy} onClick={() => pause(false)}><PlayCircle size={15} />Devam ettir</button> : <button className="btn sm" disabled={busy} onClick={() => pause(true)}><PauseCircle size={15} />Botları duraklat</button>)}</div>
          </Alert>
          {owned.size > 0 && <Alert kind="info" title="Otomatik Üretim açık">{d.items.filter((b) => owned.has(b.key)).map((b) => b.label).join(', ')} botları kendi zamanlamalarıyla çalışmaz: bu işleri üretim hattı tek tek, sırayla yürütür. Bu satırlardaki zamanlama, hat kapatılırsa yeniden geçerli olur. “Şimdi çalıştır” ve “Tüm botları tetikle” yine çalışır. <Link to="/automation">Otomatik Üretim</Link></Alert>}
          {all && (
            <Alert kind="info" title={all.queued ? `${all.queued} adım sıraya alındı${all.alreadyActive ? `, ${all.alreadyActive} adım zaten sırada/çalışıyordu` : ''}` : 'Hepsi zaten sırada ya da çalışıyor; yeni bir şey eklenmedi'}>
              {(() => { const now = d.items.filter((b) => b.running > 0).map((b) => b.label); const wait = d.items.reduce((n, b) => n + b.queued, 0); return <small className="faint" style={{ display: 'block', marginBottom: 6 }}>{watch ? <>Şu an: {now.length ? <strong>{now.join(', ')}</strong> : 'sıradaki adım alınıyor'} · sırada {wait} iş · bu görünüm 5 saniyede bir yenilenir.</> : 'Sıradaki işlerin hepsi bitti; sonuçlar aşağıdaki tabloda ve Görev kuyruğu sekmesinde.'}</small>; })()}
              <ol style={{ margin: '0 0 0 18px', padding: 0 }}>{all.steps.map((x, i) => <li key={i}>{x.what} <small className="faint">({x.label}{x.spends ? ', para harcar' : ''}{x.queued ? '' : ' · zaten sırada'})</small></li>)}</ol>
            </Alert>
          )}
          <Card flat>
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Bot</th><th>Ne yapar</th><th>Zamanlama</th><th>Son çalışma</th><th>Sonraki çalışma</th><th className="num">Kuyrukta</th><th className="num">İşlem / hata</th><th className="num">Bugün maliyet</th><th /></tr></thead>
                <tbody>{d.items.map((b) => (
                  <tr key={b.key}><td><strong>{b.label}</strong>{owned.has(b.key) && <div><Badge kind="info">üretim hattı yönetiyor</Badge></div>}</td><td className="muted">{b.about}</td>
                    <td><Badge kind={b.implemented ? (b.status === 'paused' ? 'warn' : b.status === 'scheduled' ? 'ok' : '') : ''}>{b.statusText}</Badge>{b.schedule && b.schedule.failStreak > 0 && b.schedule.enabled && <div className="faint">{b.schedule.failStreak} art arda hata</div>}{b.schedule && b.schedule.spends && <div className="faint">para harcar</div>}</td>
                    <td className="faint">{b.lastRunAt ? <>{dt(b.lastRunAt)} <Badge kind={b.lastRunStatus === 'ok' ? 'ok' : b.lastRunStatus === 'partial' ? 'warn' : 'bad'}>{b.lastRunStatus}</Badge></> : '—'}</td>
                    <td className="faint">{b.nextRunAt ? dt(b.nextRunAt) : b.scheduled && b.enabled && !d.paused ? 'sıradaki kontrolde' : '—'}</td>
                    <td className="num">{b.queued + b.running > 0 ? <Badge kind="info">{b.running ? `${b.running} çalışıyor` : ''}{b.running && b.queued ? ' · ' : ''}{b.queued ? `${b.queued} sırada` : ''}</Badge> : '—'}</td>
                    <td className="num">{b.processed === null ? '—' : `${b.processed} / ${b.errors}`}</td>
                    <td className="num">{b.costTodayUsd === null ? '—' : <>{usd(b.costTodayUsd, 4)}{b.costUnknownRuns > 0 && <div className="faint">+{b.costUnknownRuns} çalışmada bilinmiyor</div>}</>}</td>
                    <td className="num">{canControl && b.scheduled && <div className="row end" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn sm" disabled={busy} onClick={() => toggle(b, !b.enabled)}>{b.enabled ? 'Kapat' : 'Aç'}</button>
                      <button className="btn sm" onClick={() => setEdit(b)} aria-label={`${b.label} zamanlaması`}><CalendarClock size={14} />Zamanlama</button>
                      <button className="btn sm" disabled={busy || !projectId} onClick={() => now(b)} title={projectId ? 'Sıraya hemen alır' : 'Önce bir proje seçin'}><Play size={14} />Şimdi çalıştır</button></div>}</td></tr>))}</tbody></table></div>
          </Card>
          {edit && <ScheduleModal bot={edit} onClose={() => setEdit(null)} onSaved={st.reload} />}
        </>
      )}</Async>
    </div>
  );
}

/** The persistent job queue (a tab of "Otomasyon ve Ayarlar"). */
export function JobQueue() { const { can } = useApp(); return <Queue canControl={can('bots.control')} />; }
