import { useEffect, useRef, useState } from 'react';
import { Plus, QrCode, Trash2, Unplug, Loader2, Smartphone, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import { QR_TIMING } from '../qrTiming';
import { errorText, numText, senderState } from './bulkHelpers';

const muted = { fontSize: 12, color: 'var(--text-muted)' };

/** The QR of one sender: renewed while it waits (a QR lives ~20 s), closes by itself once the phone has scanned it. */
function SenderQr({ id, onLinked, onClose }) {
  const [qr, setQr] = useState(null);
  const done = useRef(onLinked);
  done.current = onLinked;

  useEffect(() => {
    let stopped = false; let retry = null;
    const started = Date.now();
    const base = `/whatsapp-bulk/senders/${id}`;
    const fetchQr = async () => {
      try {
        const { data } = await api.get(`${base}/qr`);
        if (stopped) return;
        if (data.type === 'alreadyLogged') { stopped = true; done.current(); return; }
        setQr(data);
        if (data.type === 'loading') retry = setTimeout(fetchQr, 3000);   // the connection is still coming up: look again soon
      } catch (err) { if (!stopped) setQr({ type: 'error', message: errorText(err, 'QR kodu alınamadı') }); }
    };
    fetchQr();
    const renew = setInterval(fetchQr, QR_TIMING.qrMs);
    const watch = setInterval(async () => {
      if (stopped) return;
      if (Date.now() - started > QR_TIMING.maxMs) { stopped = true; setQr({ type: 'error', message: 'QR süresi doldu. Yeniden denemek için “QR kodu göster”e basın.' }); return; }
      try {
        const { data } = await api.get(`${base}/status`);
        if (!stopped && data.stateInstance === 'authorized') { stopped = true; done.current(); }
      } catch { /* the next round tries again */ }
    }, QR_TIMING.statusMs);
    return () => { stopped = true; clearInterval(renew); clearInterval(watch); if (retry) clearTimeout(retry); };
  }, [id]);

  return (
    <div data-testid="sender-qr" style={{ marginTop: 10, padding: 14, background: 'var(--bg-tertiary)', borderRadius: 10, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ width: 200, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: 8 }}>
        {qr && qr.type === 'qrCode'
          ? <img alt="QR Code" src={`data:${qr.mimetype || 'image/png'};base64,${qr.message}`} style={{ width: 200, height: 200 }} />
          : <span data-testid="qr-msg" style={{ ...muted, padding: 12, textAlign: 'center', color: qr && qr.type === 'error' ? 'var(--danger)' : 'var(--text-muted)' }}>{qr ? qr.message : <Loader2 size={20} className="spinning" />}</span>}
      </div>
      <div style={{ flex: 1, minWidth: 220, fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
        <strong>Telefonunuzdan bağlayın</strong>
        <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
          <li>Bu numaranın WhatsApp’ını açın</li>
          <li>Ayarlar → <em>Bağlı cihazlar</em> → <em>Cihaz bağla</em></li>
          <li>Ekrandaki QR kodu okutun</li>
        </ol>
        <div style={{ ...muted, marginTop: 8 }}>QR kodu kendiliğinden yenilenir; bağlanınca bu kutu kapanır. Burada bağladığınız numara ModulPOS’un bildirim WhatsApp’ından <strong>ayrıdır</strong>.</div>
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={onClose}><X size={12} /> Kapat</button>
      </div>
    </div>
  );
}

/**
 * "Gönderici numaralar": the WhatsApp numbers that send the bulk messages. Each is linked here with its own QR and has nothing to do
 * with the platform's own WhatsApp number (notifications) on the "WhatsApp" page.
 */
export default function SenderPanel({ overview, onChanged }) {
  const { senders, maxSenders, engine } = overview;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [qrFor, setQrFor] = useState(null);

  if (engine !== 'embedded') {
    return (
      <div className="card" style={{ padding: 16, marginBottom: 14, fontSize: 13, color: 'var(--danger)' }} data-testid="sender-panel">
        Toplu gönderici numaralar yalnızca yerleşik WhatsApp bağlantısıyla çalışır; bu sunucuda WAHA ayarlı olduğu için bu sayfa kullanılamıyor.
      </div>
    );
  }

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Numaraya bir ad verin'); return; }
    setBusy('add');
    try {
      const { data } = await api.post('/whatsapp-bulk/senders', { name: name.trim() });
      setName(''); setAdding(false); setQrFor(data.id);
      onChanged();
    } catch (err) { toast.error(errorText(err, 'Numara eklenemedi')); }
    finally { setBusy(''); }
  };
  const unlink = async (s) => {
    if (!window.confirm(`“${s.name}” numarasının bağlantısı kesilsin mi? Telefonda bağlı cihazlardan da kaldırılır; yeniden QR okutmanız gerekir.`)) return;
    setBusy(s.id);
    try { await api.post(`/whatsapp-bulk/senders/${s.id}/logout`); toast.success('Bağlantı kesildi'); setQrFor(null); onChanged(); }
    catch (err) { toast.error(errorText(err, 'Bağlantı kesilemedi')); }
    finally { setBusy(''); }
  };
  const remove = async (s) => {
    if (!window.confirm(`“${s.name}” numarası silinsin mi? Bu numarayı kullanan taslak/duraklatılmış kampanyalarda gönderici boş kalır, yeniden seçmeniz gerekir.`)) return;
    setBusy(s.id);
    try { await api.delete(`/whatsapp-bulk/senders/${s.id}`); toast.success('Numara silindi'); if (qrFor === s.id) setQrFor(null); onChanged(); }
    catch (err) { toast.error(errorText(err, 'Numara silinemedi')); }
    finally { setBusy(''); }
  };

  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }} data-testid="sender-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <Smartphone size={16} style={{ color: 'var(--accent-primary)' }} />
        <strong style={{ fontSize: 14 }}>Gönderici WhatsApp numaraları</strong>
        <span style={muted}>{senders.length}/{maxSenders}</span>
        {!adding && senders.length < maxSenders && (
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}><Plus size={13} /> Gönderici ekle</button>
        )}
      </div>
      <div style={{ ...muted, lineHeight: 1.6, marginBottom: 10 }}>
        Toplu mesajlar bu numaralardan gider. Her numara kendi QR kodunuzla bağlanır ve <strong>ModulPOS’un bildirim WhatsApp’ından (WhatsApp sayfası) tamamen ayrıdır</strong>:
        birbirlerinin oturumunu, mesaj hakkını ya da numarasını kullanmaz. Kampanya oluştururken hangi numaradan gideceğini seçersiniz.
      </div>

      {adding && (
        <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <input className="form-input" aria-label="Numara adı" value={name} maxLength={60} autoFocus placeholder="Numaraya bir ad verin (ör. Kampanya hattı)" onChange={(e) => setName(e.target.value)} style={{ maxWidth: 320 }} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy === 'add'}>{busy === 'add' ? <Loader2 size={13} className="spinning" /> : <QrCode size={13} />} Ekle ve QR göster</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setName(''); }}>Vazgeç</button>
        </form>
      )}

      {senders.length === 0 && !adding && (
        <div data-testid="no-senders" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Henüz gönderici numara yok. Toplu mesaj göndermek için önce “Gönderici ekle” ile bir numara ekleyip QR kodla bağlayın.
        </div>
      )}

      {senders.map((s) => {
        const st = senderState(s);
        return (
          <div key={s.id} data-testid="sender-row" style={{ padding: '10px 0', borderTop: '1px solid var(--border-color, rgba(148,163,184,0.2))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13 }}>{s.name}</strong>
              <span data-testid="sender-state" style={{ fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 20, color: st.color, background: st.bg }}>{st.label}</span>
              {s.message && <span style={muted}>{s.message}</span>}
              <span style={{ ...muted, marginLeft: 'auto' }}>Bugün: {numText(s.sentToday)} mesaj</span>
              {qrFor !== s.id && !s.ready && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQrFor(s.id)}><QrCode size={13} /> QR kodu göster</button>
              )}
              {s.ready && <button type="button" className="btn btn-secondary btn-sm" disabled={busy === s.id} onClick={() => unlink(s)}><Unplug size={13} /> Bağlantıyı kes</button>}
              <button type="button" className="btn btn-danger btn-sm" disabled={busy === s.id} title="Numarayı sil" onClick={() => remove(s)}><Trash2 size={13} /></button>
            </div>
            {qrFor === s.id && <SenderQr id={s.id} onClose={() => setQrFor(null)} onLinked={() => { setQrFor(null); toast.success(`“${s.name}” bağlandı`); onChanged(); }} />}
          </div>
        );
      })}
    </div>
  );
}
