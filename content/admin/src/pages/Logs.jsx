import { Fragment, useState } from 'react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, PageHead, Pager, Tabs, useApp, useLoad } from '../ui.jsx';
import { dt } from '../format.js';

function Json({ v }) { return v ? <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', maxWidth: 520 }}>{JSON.stringify(v, null, 2)}</pre> : <span className="faint">—</span>; }

export default function Logs() {
  const { can } = useApp();
  const [tab, setTab] = useState('audit');
  const [page, setPage] = useState(1); const [action, setAction] = useState(''); const [level, setLevel] = useState('');
  const [open, setOpen] = useState(null);
  const size = 30;
  const allowed = can('logs.read');
  const st = useLoad(() => (allowed ? api.get(tab === 'audit' ? `/audit${qs({ limit: size, offset: (page - 1) * size, action })}` : `/system-logs${qs({ limit: size, offset: (page - 1) * size, level })}`) : Promise.resolve({ total: 0, items: [] })), [tab, page, action, level, allowed]);
  if (!allowed) return <div className="page"><PageHead title="İşlem Geçmişi" /><Alert kind="warn">Bu sayfayı görmek için yetkiniz yok.</Alert></div>;
  return (
    <div className="page">
      <PageHead title="İşlem Geçmişi">Panelde yapılan her önemli değişiklik (kim, ne zaman, neyi, önceki/sonraki değer) ve sistem olayları. API anahtarları ve şifreler günlüğe yazılmaz.</PageHead>
      <Tabs tabs={[['audit', 'Kullanıcı işlemleri'], ['system', 'Sistem günlüğü']]} value={tab} onChange={(t) => { setTab(t); setPage(1); setOpen(null); }} />
      {tab === 'audit' ? <input className="input" style={{ maxWidth: 320 }} placeholder="İşlemde ara (örn. limits, article)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
        : <select className="input" style={{ maxWidth: 200 }} value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }}><option value="">Tüm seviyeler</option>{['error', 'warn', 'info', 'debug'].map((l) => <option key={l}>{l}</option>)}</select>}
      <Async state={st}>{(d) => (d.total === 0 ? <Card><Empty title="Kayıt yok" /></Card> : (
        <Card flat><div className="tbl-wrap"><table className="tbl">
          {tab === 'audit' ? <><thead><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Kayıt</th><th>IP</th><th /></tr></thead>
            <tbody>{d.items.map((r) => <Fragment key={r.id}><tr><td className="faint">{dt(r.created_at)}</td><td>{r.user_email || '—'}</td><td className="mono">{r.action}</td><td className="faint mono clip">{r.entity} {r.entity_id}</td><td className="faint">{r.ip}</td>
              <td>{(r.before || r.after) && <button className="btn sm ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Gizle' : 'Ayrıntı'}</button>}</td></tr>
              {open === r.id && <tr><td colSpan={6}><div className="grid g2"><div><div className="lbl">Önce</div><Json v={r.before} /></div><div><div className="lbl">Sonra</div><Json v={r.after} /></div></div></td></tr>}</Fragment>)}</tbody></>
            : <><thead><tr><th>Zaman</th><th>Seviye</th><th>Kaynak</th><th>Mesaj</th></tr></thead><tbody>{d.items.map((r) => <tr key={r.id}><td className="faint">{dt(r.created_at)}</td><td><Badge kind={r.level === 'error' ? 'bad' : r.level === 'warn' ? 'warn' : ''}>{r.level}</Badge></td><td>{r.source}</td><td>{r.message}</td></tr>)}</tbody></>}
        </table></div><div style={{ marginTop: 12 }}><Pager page={page} pageSize={size} total={d.total} onPage={setPage} /></div></Card>
      ))}</Async>
    </div>
  );
}
