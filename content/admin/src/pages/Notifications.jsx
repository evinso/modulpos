import { useState } from 'react';
import { CheckCheck } from 'lucide-react';
import { api, qs } from '../api.js';
import { Async, Badge, Card, Empty, PageHead, Pager, Tabs, useAction, useApp, useLoad } from '../ui.jsx';
import { dt } from '../format.js';
import TelegramCard from './TelegramCard.jsx';

const SEV = { info: ['Bilgi', 'info'], warning: ['Uyarı', 'warn'], critical: ['Kritik', 'bad'] };

export default function Notifications() {
  const { refreshUnread, can } = useApp();
  const [tab, setTab] = useState('unread');
  const [page, setPage] = useState(1);
  const size = 25;
  const st = useLoad(() => api.get(`/notifications${qs({ unread: tab === 'unread' ? '1' : undefined, limit: size, offset: (page - 1) * size })}`), [tab, page]);
  const [run, busy] = useAction();
  const read = async (id) => { if (await run(() => api.post(`/notifications/${id}/read`))) { st.reload(); refreshUnread(); } };
  const readAll = async () => { if (await run(() => api.post('/notifications/read-all'), 'Hepsi okundu işaretlendi')) { st.reload(); refreshUnread(); } };
  return (
    <div className="page">
      <PageHead title="Bildirimler" actions={<button className="btn" disabled={busy} onClick={readAll}><CheckCheck size={15} />Hepsini okundu yap</button>}>Bütçe dolması, hazır makale, başarısız görev gibi olaylar burada toplanır. Telegram’a iletme Aşama 7’de eklenecek.</PageHead>
      {can('providers.write') && <TelegramCard />}
      <Tabs tabs={[['unread', 'Okunmamış'], ['all', 'Tümü']]} value={tab} onChange={(t) => { setTab(t); setPage(1); }} />
      <Async state={st}>{(d) => (d.total === 0 ? <Card><Empty title={tab === 'unread' ? 'Okunmamış bildirim yok' : 'Henüz bildirim yok'} /></Card> : (
        <Card flat><div className="stack">{d.items.map((n) => (
          <div key={n.id} className="row between" style={{ opacity: n.read ? 0.6 : 1, borderBottom: '1px solid var(--line-soft)', paddingBottom: 10 }}>
            <div className="stack" style={{ gap: 2 }}><span><Badge kind={SEV[n.severity][1]}>{SEV[n.severity][0]}</Badge> <strong>{n.title}</strong></span>{n.body && <span className="muted">{n.body}</span>}<small className="faint">{dt(n.createdAt)}</small></div>
            {!n.read && <button className="btn sm" disabled={busy} onClick={() => read(n.id)}>Okundu</button>}</div>))}</div>
          <div style={{ marginTop: 12 }}><Pager page={page} pageSize={size} total={d.total} onPage={setPage} /></div></Card>
      ))}</Async>
    </div>
  );
}
