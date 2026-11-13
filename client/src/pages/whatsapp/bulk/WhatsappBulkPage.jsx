import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Wifi, WifiOff, ShieldAlert, Megaphone, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';
import CampaignForm from './CampaignForm';
import CampaignDetail from './CampaignDetail';
import { STATUS_LABEL, STATUS_STYLE, errorText, numText } from './bulkHelpers';

const muted = { fontSize: 12, color: 'var(--text-muted)' };

/**
 * Admin area "Toplu WhatsApp": a message to a list of numbers (typed, pasted or imported from a CSV file), sent one after another with a
 * random pause between a minimum and a maximum number of seconds. It uses the ONE WhatsApp number linked on the "WhatsApp" page.
 */
export default function WhatsappBulkPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [view, setView] = useState({ name: 'list' });          // list | new | edit (campaign) | detail (id)
  const [overview, setOverview] = useState(null);
  const [campaigns, setCampaigns] = useState(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const [o, l] = await Promise.all([api.get('/whatsapp-bulk/overview'), api.get('/whatsapp-bulk/campaigns')]);
      setOverview(o.data); setCampaigns(l.data); setLoadError('');
    } catch (err) { setLoadError(errorText(err, 'Toplu mesaj sayfası yüklenemedi')); }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!isAdmin) return null;
  if (loadError) return <div className="card" style={{ padding: 20, color: 'var(--danger)' }}>{loadError}</div>;
  if (!overview || !campaigns) return <div className="loading-spinner"><div className="spinner"></div></div>;

  const conn = overview.connection;
  const connected = conn.state === 'authorized';
  const connecting = conn.state === 'starting';
  const back = () => { setView({ name: 'list' }); load(); };

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Toplu WhatsApp</h1>
          <p>Eklediğiniz numaralara, her mesaj arasında rastgele bir süre bekleyerek toplu mesaj gönderin. Numaraları yazabilir, yapıştırabilir ya da CSV dosyasından içe aktarabilirsiniz.</p>
        </div>
        {view.name === 'list' && (
          <button type="button" className="btn btn-primary" onClick={() => setView({ name: 'new' })}><Plus size={16} /> Yeni kampanya</button>
        )}
      </div>

      <div className="card" style={{ padding: '12px 16px', marginBottom: 14, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }} data-testid="bulk-connection">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, color: connected ? 'var(--success)' : connecting ? 'var(--warning)' : 'var(--danger)' }}>
          {connected ? <Wifi size={15} /> : connecting ? <RefreshCw size={15} /> : <WifiOff size={15} />}
          {connected ? 'WhatsApp bağlı' : connecting ? 'WhatsApp bağlanıyor…' : 'WhatsApp bağlı değil'}
        </span>
        {conn.message && <span style={muted}>{conn.message}</span>}
        {!connected && !connecting && <Link to="/whatsapp" className="btn btn-secondary btn-sm">WhatsApp sayfasına git</Link>}
        <span style={{ ...muted, marginLeft: 'auto' }}>Bugün toplu gönderilen: <strong data-testid="overview-sent-today">{numText(overview.sentToday)}</strong></span>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'rgba(245,158,11,0.10)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }} data-testid="bulk-warning">
        <ShieldAlert size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>Numaranızı koruyun.</strong> Burada kullanılan, bildirimlerin de gittiği tek WhatsApp numarasıdır. Resmî olmayan bir bağlantı olduğundan, çok sayıda kişiye
          ya da size izin vermemiş kişilere mesaj atmak (şikayet edilmek) numaranın WhatsApp tarafından kısıtlanmasına yol açabilir; o zaman bildirimler de durur.
          Yalnızca sizden mesaj almayı kabul etmiş kişilere gönderin, bekleme süresini uzun ve günlük sınırı düşük tutun, yeni numarada az sayıyla başlayın.
        </div>
      </div>

      {view.name === 'new' && <CampaignForm overview={overview} onCancel={back} onSaved={(c) => { load(); setView({ name: 'detail', id: c.id }); }} />}
      {view.name === 'edit' && <CampaignForm overview={overview} initial={view.campaign} onCancel={() => setView({ name: 'detail', id: view.campaign.id })} onSaved={() => setView({ name: 'detail', id: view.campaign.id })} />}
      {view.name === 'detail' && (
        <CampaignDetail key={view.id} id={view.id} overview={overview} onBack={back} onChanged={load} onEdit={(campaign) => setView({ name: 'edit', campaign })} />
      )}

      {view.name === 'list' && (
        campaigns.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <Megaphone size={48} className="empty-icon" />
              <h3>Henüz kampanya yok</h3>
              <p>“Yeni kampanya” ile numaraları ekleyip mesajı yazın. Kaydedince hiçbir şey gönderilmez; mesajları kontrol edip siz başlatırsınız.</p>
              <button type="button" className="btn btn-primary" onClick={() => setView({ name: 'new' })}><Plus size={16} /> Yeni kampanya</button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <div className="table-container">
              <table>
                <thead><tr><th>Kampanya</th><th>Durum</th><th style={{ textAlign: 'right' }}>Numara</th><th style={{ textAlign: 'right' }}>Gönderilen</th><th style={{ textAlign: 'right' }}>Başarısız</th><th>Bekleme</th></tr></thead>
                <tbody>
                  {campaigns.map((c) => {
                    const st = STATUS_STYLE[c.status] || STATUS_STYLE.draft;
                    return (
                      <tr key={c.id} data-testid="campaign-row" style={{ cursor: 'pointer' }} onClick={() => setView({ name: 'detail', id: c.id })}>
                        <td style={{ fontWeight: 500 }}>{c.name}</td>
                        <td><span style={{ fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 20, color: st.color, background: st.bg }}>{STATUS_LABEL[c.status]}</span></td>
                        <td style={{ textAlign: 'right' }}>{numText(c.counts.total)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>{numText(c.counts.sent)}</td>
                        <td style={{ textAlign: 'right', color: c.counts.failed ? 'var(--danger)' : undefined }}>{numText(c.counts.failed)}</td>
                        <td style={muted}>{c.minDelaySec}–{c.maxDelaySec} sn</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
