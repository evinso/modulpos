import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Square, Loader2, CheckCircle2, CircleAlert, PauseCircle, XCircle, Circle, Power } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Check, Empty, Field, NeedsProject, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, usd } from '../format.js';

const STATE = { running: ['Çalışıyor', 'info'], waiting: ['Bekliyor', 'warn'], stopped: ['Durdu: sizin bir şey yapmanız gerekebilir', 'bad'] };
const span = (sec) => (sec < 90 ? `${sec} sn` : sec < 5400 ? `${Math.round(sec / 60)} dk` : `${Math.round(sec / 3600)} sa`);

/** one step of the cycle: done / working now / waiting / stopped / still to come */
function StepDot({ s }) {
  const icon = s.state === 'done' ? <CheckCircle2 size={18} style={{ color: 'var(--ok)' }} /> : s.state === 'now' ? <Loader2 size={18} style={{ color: 'var(--info)', animation: 'spin 1s linear infinite' }} />
    : s.state === 'waiting' ? <PauseCircle size={18} style={{ color: 'var(--warn)' }} /> : s.state === 'stopped' ? <XCircle size={18} style={{ color: 'var(--bad)' }} /> : <Circle size={18} style={{ color: 'var(--faint, #9aa0aa)' }} />;
  return (
    <li data-testid={`step-${s.key}`} data-state={s.state} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: s.state === 'todo' ? 400 : 600, opacity: s.state === 'todo' ? 0.6 : 1 }}>
      {icon}<span>{s.label}</span>
    </li>
  );
}

/** the bots that look after what is already published: each with its own "how often" */
const UPKEEP_NAME = {
  content_refresh: ['Paylaşılan içeriğin güncellenmesi', 'Yayındaki makaleler için, kanıtı olan değişikliklerde güncelleme taslağı hazırlar.'],
  internal_linking: ['İç bağlantı ekleme', 'Makaleler arası bağlantı önerir (eklemeyi siz onaylarsınız).'],
  content_health: ['Eski makale kontrolü', 'Yayındaki makalelerde bozuk bağlantı ve yeni gelişme arar.'],
  seo_performance: ['Search Console verisi', 'Sitenin tıklama ve gösterim sayılarını çeker.'],
  adsense_compliance: ['AdSense site denetimi', 'Sitenin AdSense hazırlığını herkese açık sayfalardan denetler.'],
  reporting: ['Günlük ve haftalık rapor', 'Önceki günün (pazartesileri haftanın) raporunu hazırlar.'],
  content_publishing: ['WordPress durum okuma', 'WordPress’te elle yayımladığınız ya da zamanladığınız yazıları okuyup panele yansıtır.'],
};
const UPKEEP_ORDER = ['content_refresh', 'internal_linking', 'content_health', 'seo_performance', 'adsense_compliance', 'reporting', 'content_publishing'];
const EVERY = [[360, '6 saatte 1'], [720, '12 saatte 1'], [1440, 'Günde 1'], [2880, '2 günde 1'], [10080, 'Haftada 1']];
const EVERY_PUBLISHING = [[30, '30 dakikada 1'], [60, 'Saatte 1'], [120, '2 saatte 1'], ...EVERY];

function Upkeep({ canEdit }) {
  const st = useLoad(() => api.get('/bots'), []);
  const [run, busy] = useAction();
  const save = async (b, body, ok) => { if (await run(() => api.put(`/bots/${b.key}/schedule`, body), ok)) st.reload(); };
  return (
    <Card title="Bakım botları" actions={<small className="faint">Üretim hattından ayrıdır</small>}>
      <p className="muted">Yayındaki makalelere bakan botlar. Hepsi varsayılan olarak <strong>günde 1 kez</strong> çalışır; sıklığı buradan değiştirebilirsiniz. Üretim hattını etkilemezler.</p>
      <Async state={st}>{(d) => (
        <div className="tbl-wrap"><table className="tbl" aria-label="Bakım botları">
          <thead><tr><th>Bot</th><th>Çalışma sıklığı</th><th>Son çalışma</th><th>Sonraki</th><th /></tr></thead>
          <tbody>{UPKEEP_ORDER.map((k) => d.items.find((b) => b.key === k)).filter((b) => b && b.schedule).map((b) => {
            const list = b.key === 'content_publishing' ? EVERY_PUBLISHING : EVERY; const cur = b.schedule.intervalMinutes; const known = list.some(([m]) => m === cur);
            const [name, about] = UPKEEP_NAME[b.key];
            return (
              <tr key={b.key} data-testid={`upkeep-${b.key}`}>
                <td><strong>{name}</strong>{b.schedule.spends && <> <Badge kind="info" title="Yapay zekâ kredisi harcar">ücretli</Badge></>}<div className="faint">{about}</div></td>
                <td><select className="input" style={{ width: 'auto' }} aria-label={`${name}: ne sıklıkla`} value={cur} disabled={!canEdit || busy} onChange={(e) => save(b, { intervalMinutes: Number(e.target.value) }, `${name}: sıklık kaydedildi`)}>
                  {!known && <option value={cur}>{cur} dakikada 1</option>}{list.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></td>
                <td className="faint">{b.lastRunAt ? <>{dt(b.lastRunAt)} <Badge kind={b.lastRunStatus === 'ok' ? 'ok' : b.lastRunStatus === 'partial' ? 'warn' : 'bad'}>{b.lastRunStatus}</Badge></> : '—'}</td>
                <td className="faint">{b.schedule.enabled ? (b.nextRunAt ? dt(b.nextRunAt) : 'sıradaki kontrolde') : 'kapalı'}</td>
                <td className="num">{canEdit && <button className="btn sm" disabled={busy} onClick={() => save(b, { enabled: !b.schedule.enabled }, b.schedule.enabled ? `${name} kapatıldı` : `${name} açıldı`)}>{b.schedule.enabled ? 'Kapat' : 'Aç'}</button>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}</Async>
    </Card>
  );
}

/** "Otomatik Üretim": one switch, one pace, one piece of work at a time (the default tab of "Otomasyon ve Ayarlar") */
export default function Pipeline() {
  const { projectId, can, confirm, reloadProjects } = useApp();
  const canEdit = can('bots.control');
  const st = useLoad(() => (projectId ? api.get(`/pipeline${qs({ projectId })}`) : Promise.resolve(null)), [projectId]);
  const [run, busy] = useAction();
  const [changes, setChanges] = useState(null);
  useEffect(() => {
    if (!projectId) return undefined;
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') st.reload(); }, 6000);
    return () => clearInterval(t);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [openTrail, setOpenTrail] = useState(false);
  const trail = useMemo(() => (st.data && st.data.current ? [...st.data.current.trail].reverse() : []), [st.data]);
  if (!projectId) return <NeedsProject />;

  /** sends the change; the refusal that asks for a yes is shown in words and, if given, sent again with confirm */
  const send = async (body, okText) => {
    const out = await run(async () => {
      try { return await api.put('/pipeline', { projectId, ...body }); }
      catch (e) {
        if (e.status === 409 && e.data && e.data.requiresConfirmation) {
          const yes = await confirm({ title: 'Siz bakmadan yayına çıkacak', body: e.message, confirmText: 'Evet, aç', danger: true });
          if (!yes) throw new Error('Onaylanmadı; hiçbir şey değiştirilmedi');
          return api.put('/pipeline', { projectId, ...body, confirm: true });
        }
        throw e;
      }
    }, okText);
    if (out && out.changes) setChanges(out.changes);
    st.reload(); reloadProjects().catch(() => {});                 // the menu hides the research pages while the line is on
  };
  const startNow = async () => { if (await run(() => api.post('/pipeline/start', { projectId }), 'Döngü başlatıldı')) st.reload(); };
  const cancel = async () => {
    if (!(await confirm({ title: 'Bu döngü bırakılsın mı?', body: 'Şu an üzerinde çalışılan fikir ve varsa taslağı olduğu gibi kalır (taslağı Makale Arşivi’nde görürsünüz). Sonraki döngü zamanı gelince yeni bir fikirle başlar.', confirmText: 'Bırak' }))) return;
    if (await run(() => api.post('/pipeline/cancel', { projectId }), 'Döngü bırakıldı')) st.reload();
  };

  return (
    <div className="stack">
      <p className="muted">Sistem <strong>tek bir işi</strong> baştan sona götürür: fikir bulur, anahtar kelime ve SERP analizi yapar, uygunluğu kontrol eder, makaleyi yazar, eksik varsa giderir, WordPress’e yayımlar ve o işin geride bıraktığı araştırmayı siler. <strong>Hiçbir adım, başarılı olmadan bir sonrakine geçmez</strong>: bir fikir elenirse aynı kategoriden sıradaki denenir. Kategoriler sırayla çalışır.</p>
      <Async state={st}>{(d) => d && (
        <div className="stack">
          {!canEdit && <Alert kind="info">Bu sayfayı yalnızca yönetici değiştirebilir; siz görüntüleyebilirsiniz.</Alert>}
          {d.warnings.map((w, i) => <Alert key={i} kind={w.kind === 'bad' ? 'bad' : 'warn'}>{w.text}{w.to && <> <Link to={w.to}>Aç</Link></>}</Alert>)}
          {!d.schedulerRunning && <Alert kind="warn" title="Zamanlayıcı bu sunucuda çalışmıyor">Hat kendiliğinden başlamaz (yalnızca canlı ortamda otomatik açılır).</Alert>}

          <Card title={<span className="row" style={{ gap: 8 }}><Power size={17} />Otomatik Üretim{d.enabled ? <Badge kind="ok">AÇIK</Badge> : <Badge>KAPALI</Badge>}</span>}>
            <div className="stack">
              <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <Field label="Ne sıklıkla yeni makale?" hint={`${d.cyclesPerDay} döngü / gün. Her döngü bir makale yayımlar.`}>
                  <select className="input" aria-label="Üretim sıklığı" value={d.everyMinutes} disabled={!canEdit || busy} onChange={(e) => send({ everyMinutes: Number(e.target.value) }, 'Sıklık kaydedildi')}>
                    {d.frequencies.map((f) => <option key={f.minutes} value={f.minutes}>{f.label}</option>)}
                  </select>
                </Field>
                {canEdit && (d.enabled
                  ? <button className="btn" disabled={busy} onClick={() => send({ enabled: false }, 'Otomatik üretim kapatıldı')}><Square size={15} />Kapat</button>
                  : <button className="btn primary" disabled={busy || !d.prerequisites.ok} onClick={() => send({ enabled: true }, 'Otomatik üretim açıldı')}><Play size={15} />Aç</button>)}
              </div>
              {!d.prerequisites.ok && (
                <Alert kind="warn" title="Açmak için eksikler var">
                  {d.prerequisites.items.filter((i) => !i.ok).map((i) => <div key={i.key}><strong>{i.label}</strong>: {i.detail} <Link to={i.to}>Düzelt</Link></div>)}
                </Alert>
              )}
              <div className="stack" style={{ gap: 6 }}>
                <Check checked={!!d.acceptSubjectWarning} disabled={!canEdit || busy} onChange={(v) => send({ acceptSubjectWarning: v }, v ? 'Açıldı' : 'Kapatıldı')}>
                  <span>Konu kaynaklı AdSense uyarısını (hassas içerik) hat kendisi çözsün
                    <small className="faint" style={{ display: 'block' }}>Önce metni bir kez nötrleştirir (sansasyonel anlatım, kişisel veri, zarar verebilecek ayrıntı çıkarılır). Uyarı konunun kendisinden geliyorsa ve başka eksik yoksa uyarıyı <strong>sizin adınıza kabul edip</strong> makaleyi onaylar ve yayımlar; kabul kaydında “Otomatik Üretim” yazar. “Yayınlanamaz” sınıfı ve kapsam dışı konu, tekrar, kaynaksızlık hiçbir zaman kabul edilmez. Kapalıyken bu fikir elenir. AdSense’in kendi kararını değiştirmez: hassas içerikli sayfalarda reklam kısıtlanabilir.</small></span>
                </Check>
                <Check checked={!!d.newsFallback} disabled={!canEdit || busy} onChange={(v) => send({ newsFallback: v }, v ? 'Açıldı' : 'Kapatıldı')}>
                  <span>Anahtar kelime hakkı bitince beklemeyip taze haber hattıyla devam et
                    <small className="faint" style={{ display: 'block' }}>Apify ücretsiz planında günde 5 çalıştırma var (her çalıştırmada sıradaki birkaç fikrin kelimeleri birlikte sorulur, bu yüzden genelde yeter). Hak yine de biterse, <strong>taze</strong> bir haber fikri aranma hacmi olmadan ama gerçek SERP rekabeti ölçülerek yazılır. Kapalıyken hat Apify’ın yenilenmesini bekler.</small></span>
                </Check>
              </div>
              {d.enabled && <small className="faint">Açıkken eski toplu botlar (haber taraması, fırsat puanlama, anahtar kelime, SERP, makale yazımı, düzeltme) kendi zamanlamalarıyla çalışmaz: bu işleri hat tek tek yürütür. Kapatırsanız eski zamanlamalar geri gelir.</small>}
              {changes && changes.length > 0 && <Alert kind="ok" title="Son değişiklik"><ul style={{ margin: '4px 0 0 18px' }}>{changes.map((c) => <li key={c}>{c}</li>)}</ul></Alert>}
            </div>
          </Card>

          {d.enabled && (
            <Card title="Şu anki iş" actions={canEdit && <div className="row">{(!d.current || d.current.status !== 'running') && <button className="btn sm primary" disabled={busy} onClick={startNow}><Play size={14} />Şimdi başlat</button>}{d.current && <button className="btn sm" disabled={busy} onClick={cancel}>Bu döngüyü bırak</button>}</div>}>
              {!d.current ? (
                <div className="stack">
                  <p><strong>Bekliyor:</strong> sonraki döngü {dt(d.next.at)} civarında başlar{d.next.categoryName ? <>; sırası <strong>{d.next.categoryName}</strong> kategorisinde</> : ''}.</p>
                  {d.recent[0] && d.recent[0].status === 'done' && <small className="faint">Son tamamlanan: “{d.recent[0].title}” ({d.recent[0].categoryName || '—'})</small>}
                </div>
              ) : (
                <div className="stack">
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <Badge kind={STATE[d.current.status][1]}>{STATE[d.current.status][0]}</Badge>
                    {d.current.categoryName && <Badge kind="info">Kategori: {d.current.categoryName}</Badge>}
                    <Badge>{d.current.attempt}. fikir</Badge>
                    {d.current.trigger === 'manual' && <Badge>elle başlatıldı</Badge>}
                    <small className="faint">Başladı: {dt(d.current.startedAt)} · Harcama: {d.current.costUsd ? usd(d.current.costUsd, 4) : '$0'}{d.current.unknownCost ? ` (+${d.current.unknownCost} fiyatı bilinmeyen çağrı)` : ''}</small>
                  </div>
                  <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>{d.current.steps.map((s) => <StepDot key={s.key} s={s} />)}</ol>
                  {d.current.idea && <p style={{ margin: 0 }}><strong>Fikir:</strong> {d.current.idea.title}{d.current.idea.keyword ? <> · anahtar kelime <em>{d.current.idea.keyword}</em></> : ''}{d.current.idea.total !== null && d.current.idea.total !== undefined ? ` · fırsat puanı ${d.current.idea.total}` : ''}</p>}
                  {d.current.article && <p style={{ margin: 0 }}><strong>Makale:</strong> <Link to={`/articles/${d.current.article.id}`}>{d.current.article.title}</Link> ({d.current.article.words} kelime{d.current.article.quality !== null ? `, kalite ${d.current.article.quality}` : ''})</p>}
                  {d.current.note && <Alert kind={d.current.status === 'stopped' ? 'bad' : 'warn'} title={d.current.status === 'stopped' ? 'Durdu' : 'Bekleme nedeni'}>{d.current.note}{d.current.waitUntil && d.current.status === 'waiting' && <> <small>(en erken {dt(d.current.waitUntil)} sonrası kendiliğinden devam eder)</small></>}{d.current.status === 'stopped' && <> <small>Sorun giderilince hat 30 dakika içinde kendiliğinden devam eder; beklemek istemezseniz “Şimdi başlat”.</small></>}</Alert>}
                  <div>
                    <button className="btn sm" onClick={() => setOpenTrail(!openTrail)}>{openTrail ? 'Ayrıntıyı gizle' : `Ayrıntı: ne oldu? (${d.current.trail.length})`}</button>
                    {openTrail && <ol data-testid="trail" style={{ margin: '8px 0 0 18px', padding: 0 }}>{trail.map((t, i) => <li key={i} style={{ color: t.ok === false ? 'var(--bad)' : undefined }}><small className="faint">{new Date(t.at).toLocaleTimeString('tr-TR')}</small> {t.text}</li>)}</ol>}
                  </div>
                </div>
              )}
            </Card>
          )}

          <div className="grid g2">
            <Card title="Bugün">
              <div className="grid cols-metrics">
                <div className="metric"><span className="l">Yayımlanan</span><span className="v">{d.today.published}</span></div>
                <div className="metric"><span className="l">Makale yeri</span><span className="v">{d.today.articles.done} / {d.today.articles.limit}</span></div>
                <div className="metric"><span className="l">Yayın yeri</span><span className="v">{d.today.publishes.done} / {d.today.publishes.limit}</span></div>
                <div className="metric"><span className="l">Harcama</span><span className="v">{usd(d.today.costUsd, 4)}</span></div>
              </div>
              {d.lastCleanup && <small className="faint">Son temizlik ({dt(d.lastCleanup.ranAt)}): {d.lastCleanup.counts.usedIdeas} fikir, {d.lastCleanup.counts.keywords} anahtar kelime silindi.</small>}
            </Card>
            <Card title="Son sonuçlar">
              {d.recent.length === 0 ? <Empty title="Henüz tamamlanan döngü yok" /> : (
                <div className="tbl-wrap"><table className="tbl" aria-label="Son sonuçlar"><thead><tr><th>Makale</th><th>Kategori</th><th className="num">Fikir</th><th className="num">Süre</th><th className="num">Harcama</th></tr></thead>
                  <tbody>{d.recent.map((r) => <tr key={r.id}><td>{r.status === 'cancelled' ? <span className="faint">bırakıldı</span> : (r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : r.title)}</td><td className="faint">{r.categoryName || '—'}</td><td className="num">{r.attempts}</td><td className="num">{r.seconds ? span(r.seconds) : '—'}</td><td className="num">{r.costUsd ? usd(r.costUsd, 4) : '—'}{r.unknownCost ? ` +${r.unknownCost}?` : ''}</td></tr>)}</tbody></table></div>
              )}
            </Card>
          </div>
        </div>
      )}</Async>
      <Upkeep canEdit={canEdit} />
      <small className="faint"><CircleAlert size={13} style={{ verticalAlign: '-2px' }} /> Zorunlu kontroller (doğruluk, AdSense riski, tekrar, kalite) ve günlük limitler/bütçe hiçbir ayarla kapanmaz. Detaylı eski ayarlar için diğer sekmelere bakın.</small>
    </div>
  );
}
