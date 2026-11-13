import { useRef, useState } from 'react';
import { Loader2, Save, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import RecipientImport from './RecipientImport';
import { durationText, estimateSeconds, errorText, numText, senderState } from './bulkHelpers';

const muted = { fontSize: 12, color: 'var(--text-muted)' };

/**
 * A new campaign (name, message, pause range, daily limit, numbers) or - in edit mode - the settings of one that is not running.
 * Creating does NOT send anything: the campaign is saved as a draft and opened, where the finished messages can be checked before "Başlat".
 */
export default function CampaignForm({ overview, initial, onSaved, onCancel }) {
  const edit = !!initial;
  const limits = overview.limits;
  const [name, setName] = useState(initial ? initial.name : '');
  const [message, setMessage] = useState(initial ? initial.message : '');
  const [min, setMin] = useState(String(initial ? initial.minDelaySec : overview.defaults.minDelaySec));
  const [max, setMax] = useState(String(initial ? initial.maxDelaySec : overview.defaults.maxDelaySec));
  const [daily, setDaily] = useState(String(initial ? initial.dailyLimit : overview.defaults.dailyLimit));
  const senders = overview.senders || [];
  const [senderId, setSenderId] = useState(initial ? (initial.senderId || '') : (senders.length === 1 ? senders[0].id : ''));
  const [imported, setImported] = useState(null);
  const [saving, setSaving] = useState(false);
  const messageRef = useRef(null);

  const minN = Number(String(min).trim() === '' ? NaN : min); const maxN = Number(String(max).trim() === '' ? NaN : max); const dailyN = Number(daily);
  const problem = (() => {
    if (!name.trim()) return 'Kampanyaya bir ad verin';
    if (!senderId) return senders.length ? 'Mesajın hangi numaradan gideceğini seçin' : 'Önce sayfanın üstünden bir gönderici numara ekleyip bağlayın';
    if (!message.trim()) return 'Mesajı yazın';
    if (!Number.isInteger(minN) || !Number.isInteger(maxN)) return 'En az ve en çok bekleme süresini tam saniye olarak yazın (ör. 12 ve 20)';
    if (minN < limits.minDelayFloorSec) return `Bekleme en az ${limits.minDelayFloorSec} saniye olmalı`;
    if (maxN < minN) return 'En çok süre, en az süreden küçük olamaz';
    if (!Number.isInteger(dailyN) || dailyN < 0) return 'Günlük sınır 0 ya da pozitif bir tam sayı olmalı';
    if (!edit && !(imported && imported.valid > 0)) return 'Numara listesini ekleyip “Listeyi kontrol et”e basın';
    return '';
  })();

  const fields = ['ad', ...(imported ? imported.columns.map((c) => c.key).filter((k) => k !== 'ad') : [])];
  const insert = (key) => {
    const el = messageRef.current; const token = `{${key}}`;
    const at = el && typeof el.selectionStart === 'number' ? el.selectionStart : message.length;
    const to = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : at;
    setMessage(message.slice(0, at) + token + message.slice(to));
    setTimeout(() => { if (el) { el.focus(); el.setSelectionRange(at + token.length, at + token.length); } }, 0);
  };

  const save = async (e) => {
    e.preventDefault();
    if (problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      const settings = { name: name.trim(), senderId, message, minDelaySec: minN, maxDelaySec: maxN, dailyLimit: dailyN };
      const { data } = edit
        ? await api.put(`/whatsapp-bulk/campaigns/${initial.id}`, settings)
        : await api.post('/whatsapp-bulk/campaigns', { ...settings, recipients: imported.rows });
      if (!edit && data.skipped && (data.skipped.invalid || data.skipped.duplicates)) toast(`${data.skipped.invalid + data.skipped.duplicates} satır eklenmedi (geçersiz ya da tekrar)`, { duration: 5000 });
      toast.success(edit ? 'Kampanya kaydedildi' : 'Kampanya taslak olarak kaydedildi. Mesajları kontrol edip başlatın.');
      onSaved(data);
    } catch (err) { toast.error(errorText(err, 'Kaydedilemedi')); }
    finally { setSaving(false); }
  };

  const count = imported ? imported.valid : 0;
  const avg = (minN + maxN) / 2;

  return (
    <form onSubmit={save} className="card" style={{ padding: 20 }} data-testid="campaign-form">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}><ArrowLeft size={14} /> Geri</button>
        <h3 style={{ margin: 0 }}>{edit ? 'Kampanyayı düzenle' : 'Yeni toplu mesaj kampanyası'}</h3>
      </div>

      <div className="form-group">
        <label className="form-label">Kampanya adı</label>
        <input className="form-input" value={name} maxLength={100} placeholder="ör. Kasım indirimi duyurusu" onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">Gönderici numara</label>
        <select className="form-input" aria-label="Gönderici numara" value={senderId} onChange={(e) => setSenderId(e.target.value)} style={{ maxWidth: 360 }}>
          <option value="">{senders.length ? 'Numara seçin…' : 'Henüz gönderici numara yok'}</option>
          {senders.map((s) => <option key={s.id} value={s.id}>{s.name} — {senderState(s).label}</option>)}
        </select>
        <div style={{ ...muted, marginTop: 4 }}>
          Mesajlar bu WhatsApp numarasından gider (ModulPOS’un bildirim numarası kullanılmaz). Bağlı olmayan bir numara seçebilirsiniz ama kampanya ancak numara bağlanınca başlar.
        </div>
      </div>

      {!edit && (
        <div className="form-group">
          <label className="form-label">Alıcı numaralar</label>
          <RecipientImport onChange={setImported} />
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Mesaj</label>
        <textarea ref={messageRef} className="form-input" rows={6} value={message} maxLength={limits.maxMessage} onChange={(e) => setMessage(e.target.value)}
          placeholder={'Merhaba {ad}, ...'} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
        <div style={{ ...muted, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Kişiye özel alan ekle:</span>
          {fields.map((k) => <button key={k} type="button" className="btn btn-secondary btn-sm" onClick={() => insert(k)} style={{ padding: '1px 8px', fontSize: 12 }}>{`{${k}}`}</button>)}
          <span style={{ marginLeft: 'auto' }}>{message.length}/{numText(limits.maxMessage)}</span>
        </div>
        <div style={{ ...muted, marginTop: 4 }}>
          {'{ad}'} listedeki ad sütunudur; adı boş olanlara yedek yazı için <code>{'{ad|değerli müşterimiz}'}</code> yazabilirsiniz. Yalnızca metin gider (görsel/dosya yok).
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Mesajlar arası bekleme (saniye)</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>En az
            <input className="form-input" aria-label="En az saniye" type="number" min={limits.minDelayFloorSec} step="1" value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 90 }} />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>En çok
            <input className="form-input" aria-label="En çok saniye" type="number" min={limits.minDelayFloorSec} step="1" value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 90 }} />
          </label>
        </div>
        <div style={{ ...muted, marginTop: 4 }}>
          Her mesajdan sonra bu iki değerin arasında rastgele bir süre beklenir (ör. bir mesaj gider, 12 sn sonra diğeri, sonra 16 sn, sonra 13 sn…); her seferinde bu aralıkta, saniyenin kesirleri dahil rastgele bir an seçilir. Düzenli aralık WhatsApp’ın otomatik gönderimi fark etmesini kolaylaştırır; ne kadar seyrek ve değişken, o kadar güvenli. En düşük değer {limits.minDelayFloorSec} sn.
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Günlük sınır (mesaj)</label>
        <input className="form-input" aria-label="Günlük sınır" type="number" min="0" step="1" value={daily} onChange={(e) => setDaily(e.target.value)} style={{ width: 120 }} />
        <div style={{ ...muted, marginTop: 4 }}>
          Seçtiğiniz gönderici numaradan bir günde (Türkiye saatiyle) toplu gönderilecek en çok mesaj; o numaranın tüm kampanyalarının toplamı. Sınıra gelince gönderim durur, ertesi sabah 09:00’da kendiliğinden devam eder. 0 = sınırsız. Yeni ya da az kullanılan numaralarda günde 100–250 ile başlamanız önerilir.
        </div>
      </div>

      {!edit && count > 0 && Number.isFinite(avg) && (
        <div data-testid="estimate" style={{ ...muted, marginBottom: 12 }}>
          {numText(count)} numara · ortalama {String(Math.round(avg * 10) / 10).replace('.', ',')} sn bekleme ile tahmini süre {durationText(estimateSeconds(count, minN, maxN))}
          {dailyN > 0 && count > dailyN ? ` (günlük sınır nedeniyle ${Math.ceil(count / dailyN)} güne yayılır)` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary" disabled={saving || !!problem}>
          {saving ? <Loader2 size={14} className="spinning" /> : <Save size={14} />} {edit ? 'Kaydet' : 'Taslak olarak kaydet'}
        </button>
        {problem && <span data-testid="form-problem" style={muted}>{problem}</span>}
      </div>
    </form>
  );
}
