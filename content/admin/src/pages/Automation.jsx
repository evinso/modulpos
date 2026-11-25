import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Badge, Card, NeedsProject, PageHead, Tabs, useApp } from '../ui.jsx';
import { num } from '../format.js';
import Pipeline from './Pipeline.jsx';
import { BotList, JobQueue } from './Bots.jsx';
import { LimitsPanel } from './Limits.jsx';
import { SettingsGroups, Users, System } from './Settings.jsx';

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
          {d.paused && <Alert kind="warn" title="Botlar duraklatıldı">Otomatik işler yeni iş başlatmaz. <Link to="/automation?tab=botlar">Botlar</Link> sekmesinden devam ettirebilirsiniz.</Alert>}
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
          <small className="faint">Bu görüntü kendiliğinden yenilenir (6 sn); yalnızca okur, hiçbir şeyi başlatmaz ya da durdurmaz. Bir botu elle çalıştırmak ya da zamanlamasını ayrıntılı düzenlemek için <Link to="/automation?tab=botlar">Botlar sekmesi</Link>.</small>
        </div>
      )}
    </Card>
  );
}

/** every tab of the single page; the last two are admin only */
const TABS = [['uretim', 'Otomatik Üretim'], ['botlar', 'Botlar'], ['kuyruk', 'Görev kuyruğu'], ['limitler', 'Günlük limitler'], ['ayarlar', 'Ayarlar'], ['kullanicilar', 'Kullanıcılar'], ['sistem', 'Sistem']];

/**
 * ONE page for everything that runs or limits the automation: the production line (Otomatik Üretim: ALL production happens there), the bots (live status and schedules), the job queue, the daily limits,
 * the settings groups and (admin) users and server facts. The tab lives in the address (?tab=) so the old addresses /bots, /limits and /settings can lead here.
 */
export default function Automation() {
  const { can, projectId } = useApp();
  const [sp, setSp] = useSearchParams();
  const tabs = TABS.filter(([k]) => can('users.manage') || !['kullanicilar', 'sistem'].includes(k));
  const asked = sp.get('tab'); const tab = tabs.some(([k]) => k === asked) ? asked : 'uretim';
  return (
    <div className="page">
      <PageHead title="Otomasyon ve Ayarlar">Günlük işiniz ilk sekmedir: <strong>Otomatik Üretim</strong> (aç/kapat ve sıklık). Diğer sekmeler gelişmiş ayarlardır: eski modlar, botların zamanlaması, görev kuyruğu, günlük limitler ve tüm ayarlar. Sekmeler aynı gerçek anahtarları gösterir; hiçbirinin kendine ait bir kopyası yoktur.</PageHead>
      <Tabs tabs={tabs} value={tab} onChange={(k) => setSp(k === 'uretim' ? {} : { tab: k })} />
      {tab === 'uretim' && <Pipeline />}
      {tab === 'botlar' && <>{projectId ? <LiveStatus projectId={projectId} /> : <NeedsProject />}<BotList /></>}
      {tab === 'kuyruk' && <JobQueue />}
      {tab === 'limitler' && <LimitsPanel />}
      {tab === 'ayarlar' && <SettingsGroups />}
      {tab === 'kullanicilar' && <Users />}
      {tab === 'sistem' && <System />}
    </div>
  );
}
