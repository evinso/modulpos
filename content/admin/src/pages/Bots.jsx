import { PauseCircle, PlayCircle } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, PageHead, useAction, useApp, useLoad } from '../ui.jsx';
import { dt } from '../format.js';

export default function Bots() {
  const { can } = useApp();
  const st = useLoad(() => api.get('/bots'), []);
  const [run, busy] = useAction();
  const pause = async (p) => { if (await run(() => api.post(p ? '/bots/pause' : '/bots/resume'), p ? 'Botlar duraklatıldı' : 'Botlar devam ediyor')) st.reload(); };
  return (
    <div className="page">
      <PageHead title="Bot Yönetimi">Platformun 15 botu. Bir bot yalnızca kodu gerçekten çalışıyorsa “Hazır” görünür. Aşama 2 botları ilgili sayfalardaki düğmelerle <strong>elle</strong> çalıştırılır; kendiliğinden çalıştıran zamanlayıcı ve görev kuyruğu Aşama 4’te gelecek. “Son çalışma”, “işlem” ve “hata” sayıları gerçek çalıştırma kayıtlarından gelir; henüz yazılmamış botlarda sahte bilgi gösterilmez.</PageHead>
      <Async state={st}>{(d) => (
        <>
          <Alert kind={d.paused ? 'warn' : 'info'} title={d.paused ? 'Botlar duraklatıldı' : `${d.items.filter((b) => b.implemented).length} / ${d.items.length} bot hazır`}>
            <div className="row between"><span>Duraklatma, ileride çalışacak bütün otomatik işleri durdurur (limit sistemi bu anahtara şimdiden bağlı).</span>
              {can('bots.control') && (d.paused ? <button className="btn sm primary" disabled={busy} onClick={() => pause(false)}><PlayCircle size={15} />Devam ettir</button> : <button className="btn sm" disabled={busy} onClick={() => pause(true)}><PauseCircle size={15} />Botları duraklat</button>)}</div>
          </Alert>
          <Card flat>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Bot</th><th>Ne yapar</th><th>Durum</th><th>Son çalışma</th><th>Sonraki çalışma</th><th className="num">İşlem</th><th className="num">Hata</th></tr></thead>
              <tbody>{d.items.map((b) => (
                <tr key={b.key}><td><strong>{b.label}</strong></td><td className="muted">{b.about}</td>
                  <td><Badge kind={b.implemented ? (b.status === 'paused' ? 'warn' : 'ok') : ''}>{b.statusText}</Badge></td>
                  <td className="faint">{b.lastRunAt ? <>{dt(b.lastRunAt)} <Badge kind={b.lastRunStatus === 'ok' ? 'ok' : b.lastRunStatus === 'partial' ? 'warn' : 'bad'}>{b.lastRunStatus}</Badge></> : '—'}</td><td className="faint">{b.implemented ? 'zamanlayıcı yok (Aşama 4)' : '—'}</td><td className="num faint">{b.processed ?? '—'}</td><td className="num faint">{b.errors ?? '—'}</td></tr>))}</tbody></table></div>
          </Card>
        </>
      )}</Async>
    </div>
  );
}
