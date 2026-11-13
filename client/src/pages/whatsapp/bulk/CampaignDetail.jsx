import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Play, Pause, Trash2, Pencil, RotateCcw, Plus, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import RecipientImport from './RecipientImport';
import { STATUS_LABEL, STATUS_STYLE, RECIPIENT_LABEL, RECIPIENT_COLOR, durationText, estimateSeconds, formatTimeSec, secondsBetween, secText, errorText, numText, senderState } from './bulkHelpers';

const muted = { fontSize: 12, color: 'var(--text-muted)' };
const POLL_MS = 4000;

/** One campaign: progress, controls, the finished messages of the first people, and every number with its result. */
export default function CampaignDetail({ id, overview, onBack, onChanged, onEdit }) {
  const base = `/whatsapp-bulk/campaigns/${id}`;
  const [c, setC] = useState(null);
  const [list, setList] = useState({ total: 0, totalPages: 1, recipients: [] });
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(Date.now());
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState(null);

  const load = useCallback(async () => {
    try {
      const [camp, rec] = await Promise.all([
        api.get(base),
        api.get(`${base}/recipients`, { params: { status: filter || undefined, page, limit: 50 } }),
      ]);
      setC(camp.data); setList(rec.data);
    } catch (err) { toast.error(errorText(err, 'Kampanya okunamadı')); }
  }, [base, filter, page]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { load(); }, [load]);

  const running = c && c.status === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const poll = setInterval(() => loadRef.current(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [running]);

  if (!c) return <div className="loading-spinner"><div className="spinner"></div></div>;

  const act = async (key, fn) => { setBusy(key); try { await fn(); await load(); onChanged(); } catch (err) { toast.error(errorText(err, 'İşlem yapılamadı')); } finally { setBusy(''); } };

  const start = () => {
    const left = c.counts.pending;
    const text = `${numText(left)} numaraya gönderilecek.\nHer mesajdan sonra ${c.minDelaySec}–${c.maxDelaySec} saniye arasında rastgele beklenir; tahmini süre ${durationText(estimateSeconds(left, c.minDelaySec, c.maxDelaySec))}.`
      + `${c.dailyLimit > 0 ? `\nGünlük sınır: ${numText(c.dailyLimit)} mesaj.` : ''}\n\nMesajları kontrol ettiniz mi? Başlatılsın mı?`;
    if (!window.confirm(text)) return;
    act('start', async () => { await api.post(`${base}/start`); toast.success('Gönderim başladı'); });
  };
  const pause = () => act('pause', async () => { await api.post(`${base}/pause`); toast('Kampanya duraklatıldı'); });
  const retry = () => act('retry', async () => {
    const { data } = await api.post(`${base}/retry-failed`);
    toast.success(data.requeued > 0 ? `${numText(data.requeued)} numara yeniden sıraya alındı. “Devam et”e basın.` : 'Yeniden denenecek numara yok');
  });
  const remove = () => {
    if (!window.confirm(`“${c.name}” kampanyası ve sonuçları silinsin mi? Gönderilmiş mesajlar geri alınamaz.`)) return;
    act('delete', async () => { await api.delete(base); toast.success('Kampanya silindi'); onBack(); });
  };
  const addNumbers = () => act('add', async () => {
    const { data } = await api.post(`${base}/recipients`, { recipients: more.rows });
    toast.success(`${numText(data.added)} numara eklendi`);
    if (data.missingColumns && data.missingColumns.length) toast(`Dikkat: mesajdaki {${data.missingColumns[0]}} alanı yeni listede yok`, { duration: 7000 });
    setAdding(false); setMore(null);
  });

  const { counts } = c;
  const finished = counts.sent + counts.failed;
  const pct = counts.total ? Math.round((finished / counts.total) * 100) : 0;
  const st = STATUS_STYLE[c.status] || STATUS_STYLE.draft;
  const wait = running && c.nextSendAt ? Math.max(0, Math.round((new Date(c.nextSendAt).getTime() - now) / 1000)) : null;
  const sender = c.sender || null;                                        // the number this campaign sends from (null = none chosen)
  const editable = c.status === 'draft' || c.status === 'paused';

  return (
    <div data-testid="campaign-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}><ArrowLeft size={14} /> Kampanyalar</button>
        <h3 style={{ margin: 0 }}>{c.name}</h3>
        <span data-testid="campaign-status" style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, color: st.color, background: st.bg }}>{STATUS_LABEL[c.status]}</span>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
          <span data-testid="progress-text"><strong>{numText(finished)}</strong> / {numText(counts.total)} işlendi ({pct}%)</span>
          <span style={{ display: 'flex', gap: 14 }}>
            <span style={{ color: RECIPIENT_COLOR.sent }}>Gönderildi: <strong data-testid="count-sent">{numText(counts.sent)}</strong></span>
            <span style={{ color: RECIPIENT_COLOR.pending }}>Bekleyen: <strong data-testid="count-pending">{numText(counts.pending + counts.sending)}</strong></span>
            <span style={{ color: RECIPIENT_COLOR.failed }}>Başarısız: <strong data-testid="count-failed">{numText(counts.failed)}</strong></span>
          </span>
        </div>
        <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--success)', transition: 'width .4s' }} />
        </div>

        {running && (
          <div data-testid="next-send" style={{ ...muted, marginTop: 8 }}>
            {wait == null ? 'Mesaj gönderiliyor…' : wait > 0 ? `Sıradaki mesaj yaklaşık ${wait} sn sonra gidecek.` : 'Sıradaki mesaj gönderiliyor…'}
          </div>
        )}
        {c.statusNote && (
          <div data-testid="status-note" style={{ marginTop: 10, fontSize: 13, color: c.status === 'paused' ? 'var(--danger)' : 'var(--warning)', display: 'flex', gap: 8 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{c.statusNote}</span>
          </div>
        )}
        {c.status !== 'done' && !sender && (
          <div data-testid="no-sender" style={{ marginTop: 10, fontSize: 13, color: 'var(--danger)' }}>Bu kampanya için gönderici numara seçilmemiş. “Düzenle” ile bir numara seçin (numara yoksa sayfanın üstünden ekleyip QR ile bağlayın).</div>
        )}
        {c.status !== 'done' && sender && !sender.ready && (
          <div data-testid="sender-not-ready" style={{ marginTop: 10, fontSize: 13, color: 'var(--danger)' }}>“{sender.name}” numarası bağlı değil: {sender.message || 'sayfanın üstünden QR kodu okutup bağlayın.'}</div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {(c.status === 'draft' || c.status === 'paused') && (
            <button type="button" className="btn btn-primary" disabled={!!busy || counts.pending === 0 || !sender} onClick={start}>
              {busy === 'start' ? <Loader2 size={14} className="spinning" /> : <Play size={14} />} {c.status === 'draft' ? 'Başlat' : 'Devam et'}
            </button>
          )}
          {running && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={pause}><Pause size={14} /> Duraklat</button>}
          {editable && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => onEdit(c)}><Pencil size={14} /> Düzenle</button>}
          {c.status !== 'running' && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setAdding((v) => !v)}><Plus size={14} /> Numara ekle</button>}
          {counts.failed > 0 && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={retry}><RotateCcw size={14} /> Başarısızları yeniden dene</button>}
          {c.status !== 'running' && <button type="button" className="btn btn-danger" disabled={!!busy} onClick={remove}><Trash2 size={14} /> Sil</button>}
        </div>

        {adding && (
          <div style={{ marginTop: 14 }}>
            <RecipientImport onChange={setMore} />
            <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} disabled={!more || !!busy} onClick={addNumbers}>Listeye ekle ({more ? numText(more.valid) : 0} numara)</button>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ ...muted, marginBottom: 6 }}>
          Gönderici: <strong data-testid="sender-name">{sender ? sender.name : 'seçilmemiş'}</strong>{sender && <span> ({senderState(sender).label}{sender.message ? ` · ${sender.message.replace('Bağlı numara: ', '')}` : ''})</span>} ·
          Bekleme: <strong>{c.minDelaySec}–{c.maxDelaySec} sn</strong> (rastgele) · Günlük sınır: <strong>{c.dailyLimit > 0 ? numText(c.dailyLimit) : 'yok'}</strong> · Bu numaradan bugün toplu gönderilen: <strong data-testid="sent-today">{numText(c.sentToday)}</strong>
          {c.status !== 'done' && counts.pending > 0 && <> · Kalan tahmini süre: {durationText(estimateSeconds(counts.pending, c.minDelaySec, c.maxDelaySec))}</>}
        </div>
        {c.observed && (
          <div data-testid="observed-gaps" style={{ ...muted, marginBottom: 6 }}>
            Gerçekleşen bekleme (son {numText(c.observed.count + 1)} mesaj): <strong>{secText(c.observed.minSec)}–{secText(c.observed.maxSec)} sn</strong>, ortalama {secText(c.observed.avgSec)} sn.
            WhatsApp mesaj saatini yalnızca dakikayla gösterir; art arda giden mesajlar aynı dakikada görünebilir. Saniyeler aşağıdaki tabloda.
          </div>
        )}
        <div style={{ fontWeight: 600, fontSize: 13, margin: '10px 0 4px' }}>Mesaj</div>
        <div data-testid="message-text" style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: 'var(--bg-tertiary)', borderRadius: 8, padding: '10px 12px' }}>{c.message}</div>
        {c.preview && c.preview.length > 0 && (
          <div data-testid="preview" style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>İlk {c.preview.length} kişiye gidecek mesajlar</div>
            {c.preview.map((p) => (
              <div key={p.phone} style={{ fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: 'var(--text-muted)' }}>{p.phone}{p.name ? ` · ${p.name}` : ''}</span>
                <div style={{ whiteSpace: 'pre-wrap', background: 'var(--bg-tertiary)', borderRadius: 8, padding: '6px 10px', marginTop: 2 }}>{p.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <h4 style={{ margin: 0 }}>Numaralar</h4>
          <select className="form-input" aria-label="Duruma göre süz" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} style={{ width: 170 }}>
            <option value="">Hepsi</option>
            {Object.entries(RECIPIENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span style={muted}>{numText(list.total)} kayıt</span>
        </div>
        <div className="table-container">
          <table>
            <thead><tr><th>#</th><th>Numara</th><th>Ad</th><th>Durum</th><th>Zaman</th><th>Not</th></tr></thead>
            <tbody>
              {list.recipients.map((r, i) => {
                const prev = filter === '' && i > 0 ? list.recipients[i - 1] : null;
                const gap = prev && prev.sentAt && r.sentAt ? secondsBetween(prev.sentAt, r.sentAt) : null;
                return (
                <tr key={r.id} data-testid="recipient-row">
                  <td style={{ color: 'var(--text-muted)' }}>{r.position}</td>
                  <td>{r.phone}</td>
                  <td>{r.name || <span style={muted}>—</span>}</td>
                  <td style={{ color: RECIPIENT_COLOR[r.status], fontWeight: 500 }}>{RECIPIENT_LABEL[r.status]}</td>
                  <td style={muted} data-testid="sent-time">{formatTimeSec(r.sentAt)}{gap != null && gap > 0 && gap < 3600 ? <span data-testid="sent-gap"> (önceki mesajdan +{secText(gap)} sn)</span> : null}</td>
                  <td style={{ fontSize: 12, color: 'var(--danger)', maxWidth: 360 }}>{r.error || ''}</td>
                </tr>
                );
              })}
              {list.recipients.length === 0 && <tr><td colSpan={6} style={muted}>Bu durumda numara yok</td></tr>}
            </tbody>
          </table>
        </div>
        {list.totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Önceki</button>
            <span style={muted}>Sayfa {page} / {list.totalPages}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page >= list.totalPages} onClick={() => setPage(page + 1)}>Sonraki</button>
          </div>
        )}
      </div>
    </div>
  );
}
