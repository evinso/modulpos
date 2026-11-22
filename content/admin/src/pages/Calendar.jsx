import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, NeedsProject, PageHead, useApp, useLoad } from '../ui.jsx';
import { dt } from '../format.js';
import { PUB } from './Publishing.jsx';

const dayOf = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const label = (k) => new Date(`${k}T12:00:00Z`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

/** What is written and what is going public, day by day. Without a connected site it is the PREPARATION calendar (articles written per day). */
export default function Calendar() {
  const { projectId } = useApp();
  const st = useLoad(() => (projectId ? api.get(`/calendar${qs({ projectId, from: new Date(Date.now() - 14 * 86400000).toISOString(), to: new Date(Date.now() + 60 * 86400000).toISOString() })}`) : Promise.resolve(null)), [projectId]);
  const sites = useLoad(() => (projectId ? api.get(`/sites?projectId=${projectId}`) : Promise.resolve(null)), [projectId]);
  if (!projectId) return <NeedsProject />;
  return (
    <div className="page">
      <PageHead title="İçerik Takvimi">Geçmiş iki hafta ve gelecek iki ay. Bir WordPress sitesi bağlı değilken burası <strong>hazırlık takvimidir</strong> (günde kaç makale yazıldı); site bağlanınca zamanlanmış ve yayımlanmış yazılar günlerine yerleşir.</PageHead>
      <Async state={st}>{(d) => d && (() => {
        const days = new Map();
        const add = (k, kind, v) => { if (!days.has(k)) days.set(k, { pubs: [], written: 0 }); const x = days.get(k); if (kind === 'pub') x.pubs.push(v); else x.written += v; };
        d.publications.forEach((p) => add(dayOf(p.scheduledAt || p.publishedAt, d.timezone), 'pub', p));
        d.written.forEach((w) => add(w.day, 'written', w.n));
        const keys = [...days.keys()].sort();
        return (
          <div className="stack">
            {sites.data && sites.data.sites.length === 0 && <Alert kind="info" title="Bağlı WordPress sitesi yok: hazırlık takvimi">{d.readyUnsent} makale “Yayına hazır” ve gönderilmeyi bekliyor. Site bağlayınca <Link to="/publishing">Toplu Yayınlama</Link>’dan zamanlayabilirsiniz.</Alert>}
            {sites.data && sites.data.sites.length > 0 && d.readyUnsent > 0 && <Alert kind="info">{d.readyUnsent} “Yayına hazır” makale henüz hiçbir siteye gönderilmedi. <Link to="/publishing">Toplu Yayınlama</Link></Alert>}
            {keys.length === 0 ? <Card><Empty title="Bu aralıkta kayıt yok" /></Card> : keys.map((k) => { const x = days.get(k); return (
              <Card key={k} flat title={label(k)} actions={<>{x.written > 0 && <Badge>{x.written} makale yazıldı</Badge>}{x.pubs.length > 0 && <Badge kind="info">{x.pubs.length} yayın</Badge>}</>}>
                {x.pubs.length === 0 ? <small className="faint">Bu gün yayın yok.</small> : <div className="stack">{x.pubs.map((p) => <div key={p.id} className="row between"><span><Link to={`/articles/${p.articleId}`}>{p.articleTitle}</Link> <span className="faint">· {p.siteName} · {dt(p.scheduledAt || p.publishedAt)}</span></span><Badge kind={PUB[p.status][1]}>{PUB[p.status][0]}</Badge></div>)}</div>}
              </Card>); })}
          </div>
        );
      })()}</Async>
    </div>
  );
}
