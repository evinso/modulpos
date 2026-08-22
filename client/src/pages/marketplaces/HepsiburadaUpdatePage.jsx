import { useState, useEffect } from 'react';
import { Send, Plus, Trash2, RefreshCw, Search, ChevronDown, ChevronUp, Package, CheckCircle, XCircle, Clock, AlertCircle, Image } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const FIELD_RESULT_COLORS = {
  APPROVED:        { color: '#10b981', label: 'Onaylandı' },
  REJECTED:        { color: '#ef4444', label: 'Reddedildi' },
  IN_PROGRESS:     { color: '#f59e0b', label: 'İşlemde' },
  PARTIAL_APPROVED:{ color: '#8b5cf6', label: 'Kısmen Onaylandı' },
};

const FIELD_NAME_TR = {
  NAME: 'Ürün Adı', DESCRIPTION: 'Açıklama', KDV: 'KDV', BARCODE: 'Barkod',
  IS_CUSTOMIZABLE: 'Özelleştirilebilir', BRAND: 'Marka', DESI: 'Desi',
  WARRANTY_PERIOD: 'Garanti Süresi', MEDIA: 'Görsel/Video', ATTRIBUTE: 'Özellik',
};

function FieldResultBadge({ result }) {
  const s = FIELD_RESULT_COLORS[result] || { color: 'var(--text-muted)', label: result };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: s.color, background: `${s.color}18`, borderRadius: 4, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

function emptyItem() {
  return {
    hbSku: '',
    productName: '',
    productDescription: '',
    images: ['', '', '', '', ''],
    video: '',
    attributes: [{ key: '', value: '' }],
    _expanded: true,
    _showAllImages: false,
  };
}

export default function HepsiburadaUpdatePage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('update');

  // Update form
  const [items, setItems] = useState([emptyItem()]);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  // Status query
  const [ticketId, setTicketId] = useState('');
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketResult, setTicketResult] = useState(null);

  // History query
  const [hbSkuQuery, setHbSkuQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyResult, setHistoryResult] = useState(null);

  useEffect(() => { fetchConnections(); }, []);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const hb = res.data.filter(c => c.marketplaceType === 'hepsiburada');
      setConnections(hb);
      if (hb.length > 0) setSelectedConn(hb[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  // ── Item helpers ──────────────────────────────────────────────────────────

  const updateItem = (idx, patch) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const updateImage = (idx, imgIdx, val) => setItems(prev => prev.map((it, i) => {
    if (i !== idx) return it;
    const images = [...it.images];
    images[imgIdx] = val;
    return { ...it, images };
  }));
  const updateAttr = (idx, attrIdx, field, val) => setItems(prev => prev.map((it, i) => {
    if (i !== idx) return it;
    const attributes = it.attributes.map((a, j) => j === attrIdx ? { ...a, [field]: val } : a);
    return { ...it, attributes };
  }));
  const addAttr = (idx) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, attributes: [...it.attributes, { key: '', value: '' }] } : it));
  const removeAttr = (idx, attrIdx) => setItems(prev => prev.map((it, i) => {
    if (i !== idx) return it;
    const attributes = it.attributes.filter((_, j) => j !== attrIdx);
    return { ...it, attributes: attributes.length ? attributes : [{ key: '', value: '' }] };
  }));
  const addItem = () => setItems(prev => [...prev, emptyItem()]);
  const removeItem = (idx) => setItems(prev => prev.length === 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx));

  // ── Build payload ─────────────────────────────────────────────────────────

  const buildPayload = () => {
    const result = [];
    for (const it of items) {
      if (!it.hbSku.trim()) continue;
      const entry = { hbSku: it.hbSku.trim() };
      if (it.productName.trim()) entry.productName = it.productName.trim();
      if (it.productDescription.trim()) entry.productDescription = it.productDescription.trim();
      if (it.video.trim()) entry.video = it.video.trim();
      it.images.forEach((url, i) => { if (url.trim()) entry[`image${i + 1}`] = url.trim(); });
      const attrs = {};
      for (const a of it.attributes) { if (a.key.trim()) attrs[a.key.trim()] = a.value; }
      if (Object.keys(attrs).length) entry.attributes = attrs;
      result.push(entry);
    }
    return result;
  };

  const handleSend = async () => {
    if (!selectedConn) return;
    const payload = buildPayload();
    if (payload.length === 0) return toast.error('En az bir ürün ve hbSku giriniz');
    setSending(true);
    setSendResult(null);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/hepsiburada-update-products`, { items: payload });
      setSendResult(res.data);
      const tid = res.data?.data?.trackingId || res.data?.trackingId;
      if (tid) { setTicketId(String(tid)); toast.success(`Güncelleme gönderildi. Takip ID: ${tid}`); }
      else toast.success('Güncelleme talebi oluşturuldu');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setSending(false); }
  };

  const checkTicket = async () => {
    if (!ticketId.trim() || !selectedConn) return;
    setTicketLoading(true);
    setTicketResult(null);
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/hepsiburada-ticket-status/${ticketId.trim()}`);
      setTicketResult(res.data);
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setTicketLoading(false); }
  };

  const checkHistory = async () => {
    if (!hbSkuQuery.trim() || !selectedConn) return;
    setHistoryLoading(true);
    setHistoryResult(null);
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/hepsiburada-update-history/${encodeURIComponent(hbSkuQuery.trim())}`);
      setHistoryResult(res.data);
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setHistoryLoading(false); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Hepsiburada — Ürün Güncelle</h1></div>
        <div className="card"><div className="empty-state"><Package size={48} className="empty-icon" /><h3>Hepsiburada bağlantısı bulunamadı</h3></div></div>
      </div>
    );
  }

  // Flatten ticket result items
  const ticketGroups = ticketResult
    ? (ticketResult.data || (Array.isArray(ticketResult) ? ticketResult : []))
    : [];

  return (
    <div>
      {/* Header */}
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Hepsiburada — Ürün Güncelle</h1>
          <p>Mevcut ürünlerin adını, açıklamasını, görsellerini ve özelliklerini güncelleyin</p>
        </div>
        {connections.length > 1 && (
          <select className="form-select" style={{ width: 220 }} value={selectedConn?.id || ''}
            onChange={e => setSelectedConn(connections.find(c => c.id === e.target.value))}>
            {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
          </select>
        )}
      </div>

      {/* Info */}
      <div style={{ background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
        <AlertCircle size={15} style={{ color: '#ff6000', flexShrink: 0, marginTop: 1 }} />
        <span>Sadece değiştirmek istediğiniz alanları doldurun. Boş bırakılan alanlar Hepsiburada tarafından korunur. Görseli güncellemek için mutlaka yeni URL kullanın. Özelliği silmek için değeri boş bırakın.</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border-color)', paddingBottom: 0 }}>
        {[{ key: 'update', label: 'Ürün Güncelle' }, { key: 'status', label: 'Durum Sorgula' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: tab === t.key ? 600 : 400, border: 'none', cursor: 'pointer',
              background: 'none', color: tab === t.key ? '#ff6000' : 'var(--text-secondary)',
              borderBottom: tab === t.key ? '2px solid #ff6000' : '2px solid transparent', marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Update ─────────────────────────────────────────────────────── */}
      {tab === 'update' && (
        <div>
          {items.map((it, idx) => (
            <div key={idx} className="card" style={{ marginBottom: 12 }}>
              {/* Item header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: it._expanded ? 16 : 0 }}>
                <div style={{ flex: 1 }}>
                  <input className="form-input" placeholder="HB SKU (zorunlu) — örn: HBV00001234567"
                    value={it.hbSku} onChange={e => updateItem(idx, { hbSku: e.target.value })}
                    style={{ fontFamily: 'monospace', fontWeight: 600 }} />
                </div>
                <button type="button" onClick={() => updateItem(idx, { _expanded: !it._expanded })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 6 }}>
                  {it._expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                <button type="button" onClick={() => removeItem(idx)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 6 }}>
                  <Trash2 size={15} />
                </button>
              </div>

              {it._expanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Product name */}
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Ürün Adı</label>
                    <input className="form-input" placeholder="Güncellenecekse doldurun, boş bırakılabilir"
                      value={it.productName} onChange={e => updateItem(idx, { productName: e.target.value })} />
                  </div>

                  {/* Description */}
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Ürün Açıklaması</label>
                    <textarea className="form-input" rows={3} placeholder="Güncellenecekse doldurun, boş bırakılabilir"
                      value={it.productDescription} onChange={e => updateItem(idx, { productDescription: e.target.value })}
                      style={{ resize: 'vertical', minHeight: 80 }} />
                  </div>

                  {/* Images */}
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Image size={13} /> Görseller (Değiştirilecek Olanlar)
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(it._showAllImages ? it.images : it.images.slice(0, 5)).map((url, imgIdx) => (
                        <div key={imgIdx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 52, flexShrink: 0 }}>Görsel {imgIdx + 1}</span>
                          <input className="form-input" placeholder="Yeni görsel URL (değiştirmiyorsanız boş bırakın)"
                            value={url} onChange={e => updateImage(idx, imgIdx, e.target.value)} />
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => updateItem(idx, { _showAllImages: !it._showAllImages })}
                      style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
                      {it._showAllImages ? '▲ Daha az göster' : '▼ Görsel 6–10 göster'}
                    </button>
                  </div>

                  {/* Video */}
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Video URL</label>
                    <input className="form-input" placeholder="Yeni video URL (değiştirmiyorsanız boş bırakın)"
                      value={it.video} onChange={e => updateItem(idx, { video: e.target.value })} />
                  </div>

                  {/* Attributes */}
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
                      Özellikler — Silmek için değeri boş bırakın
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {it.attributes.map((a, attrIdx) => (
                        <div key={attrIdx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input className="form-input" placeholder="Özellik anahtarı (örn: renk_variant_property)"
                            value={a.key} onChange={e => updateAttr(idx, attrIdx, 'key', e.target.value)}
                            style={{ flex: 1 }} />
                          <input className="form-input" placeholder="Değer (silmek için boş bırakın)"
                            value={a.value} onChange={e => updateAttr(idx, attrIdx, 'value', e.target.value)}
                            style={{ flex: 1 }} />
                          <button type="button" onClick={() => removeAttr(idx, attrIdx)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', flexShrink: 0, padding: 4 }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => addAttr(idx)}
                      style={{ marginTop: 6, fontSize: 12, color: '#ff6000', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0' }}>
                      <Plus size={13} /> Özellik Ekle
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <button className="btn btn-secondary" onClick={addItem} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={15} /> Ürün Ekle
            </button>
            <button className="btn btn-primary" onClick={handleSend} disabled={sending}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {sending ? <><RefreshCw size={15} className="spinning" /> Gönderiliyor...</> : <><Send size={15} /> Güncellemeyi Gönder</>}
            </button>
          </div>

          {sendResult && (
            <div className="card" style={{ marginBottom: 16, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <CheckCircle size={16} style={{ color: '#10b981' }} />
                <span style={{ fontWeight: 600, color: '#10b981' }}>Güncelleme talebi oluşturuldu</span>
              </div>
              {(sendResult?.data?.trackingId || sendResult?.trackingId) && (
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  Takip ID: <strong style={{ fontFamily: 'monospace' }}>{sendResult?.data?.trackingId || sendResult?.trackingId}</strong>
                  <button className="btn btn-secondary btn-sm" style={{ marginLeft: 10, fontSize: 11 }}
                    onClick={() => { setTicketId(String(sendResult?.data?.trackingId || sendResult?.trackingId)); setTab('status'); }}>
                    Durumu Sorgula
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Status ─────────────────────────────────────────────────────── */}
      {tab === 'status' && (
        <div>
          {/* Ticket status */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13 }}>Güncelleme Talebi Durumu</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: ticketResult ? 16 : 0 }}>
              <input className="form-input" placeholder="Takip ID (trackingId) girin..."
                value={ticketId} onChange={e => setTicketId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && checkTicket()} style={{ flex: 1, fontFamily: 'monospace' }} />
              <button className="btn btn-primary" onClick={checkTicket} disabled={ticketLoading || !ticketId.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                {ticketLoading ? <><RefreshCw size={14} className="spinning" /> Sorgulanıyor...</> : <><Search size={14} /> Sorgula</>}
              </button>
            </div>

            {ticketResult && (
              ticketGroups.length === 0
                ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sonuç bulunamadı</div>
                : ticketGroups.map((group, gi) => (
                  <div key={gi}>
                    {(group.items || []).map((item, ii) => (
                      <div key={ii} style={{ background: 'var(--bg-tertiary)', borderRadius: 6, padding: '12px 14px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13 }}>{item.hbSku}</span>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                            color: item.productStatus === 'COMPLETED' ? '#10b981' : '#f59e0b',
                            background: item.productStatus === 'COMPLETED' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)' }}>
                            {item.productStatus === 'COMPLETED' ? 'Tamamlandı' : 'Devam Ediyor'}
                          </span>
                          {item.message && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.message}</span>}
                        </div>
                        {(item.updateResults || []).map((ur, uri) => (
                          <div key={uri} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 12, borderLeft: '2px solid var(--border-color)', marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                              <span style={{ color: 'var(--text-secondary)', fontWeight: 500, minWidth: 130 }}>{FIELD_NAME_TR[ur.fieldName] || ur.fieldName}</span>
                              <FieldResultBadge result={ur.fieldResult} />
                              {ur.rejectReason && <span style={{ fontSize: 11, color: '#ef4444' }}>{ur.rejectReason}</span>}
                            </div>
                            {(ur.attributes || []).map((attr, ai) => (
                              <div key={ai} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, paddingLeft: 12, color: 'var(--text-muted)' }}>
                                <span style={{ minWidth: 140 }}>{attr.displayName || attr.attributeId}</span>
                                <FieldResultBadge result={attr.fieldResult} />
                                {attr.rejectReason && <span style={{ color: '#ef4444' }}>{attr.rejectReason}</span>}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))
            )}
          </div>

          {/* History by hbSku */}
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13 }}>Ürün Güncelleme Geçmişi</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: historyResult ? 16 : 0 }}>
              <input className="form-input" placeholder="HB SKU girin (örn: HBV00001234567)..."
                value={hbSkuQuery} onChange={e => setHbSkuQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && checkHistory()} style={{ flex: 1, fontFamily: 'monospace' }} />
              <button className="btn btn-secondary" onClick={checkHistory} disabled={historyLoading || !hbSkuQuery.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                {historyLoading ? <><RefreshCw size={14} className="spinning" /> Yükleniyor...</> : <><Clock size={14} /> Geçmişi Gör</>}
              </button>
            </div>

            {historyResult && (
              <div>
                {(() => {
                  const entries = historyResult?.data
                    ? (Array.isArray(historyResult.data) ? historyResult.data : [historyResult.data])
                    : [];
                  return entries.length === 0
                    ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Bu ürün için güncelleme geçmişi bulunamadı</div>
                    : entries.map((entry, i) => {
                      const tid = entry.trackingId || entry.id;
                      const date = entry.createdAt || entry.createdDate || '';
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                          <Clock size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <span style={{ fontFamily: 'monospace', fontSize: 12, flex: 1 }}>{tid}</span>
                          {date && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{new Date(date).toLocaleString('tr-TR')}</span>}
                          {tid && (
                            <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '3px 10px' }}
                              onClick={() => { setTicketId(String(tid)); checkTicket(); }}>
                              Durumu Gör
                            </button>
                          )}
                        </div>
                      );
                    });
                })()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
