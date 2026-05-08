import { useState, useEffect } from 'react';
import {
  Truck, Plus, RefreshCw, Search, Edit2, Trash2, X, Check,
  Package, Clock, CheckCircle, XCircle, ChevronDown
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const STATUS = {
  pending:   { label: 'Bekliyor',    color: 'badge-warning',  icon: Clock },
  ordered:   { label: 'Sipariş Verildi', color: 'badge-info', icon: Package },
  shipped:   { label: 'Kargoda',     color: 'badge-primary',  icon: Truck },
  delivered: { label: 'Teslim Edildi', color: 'badge-success', icon: CheckCircle },
  cancelled: { label: 'İptal',       color: 'badge-danger',   icon: XCircle },
};

const EMPTY_FORM = {
  orderRef: '', productName: '', productCode: '', supplierName: '',
  quantity: 1, unitPrice: '', customerName: '', customerPhone: '',
  shippingAddress: '', notes: ''
};

export default function DropshipOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [showModal, setShowModal] = useState(false);  // 'new' | order object
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [detailOrder, setDetailOrder] = useState(null);
  const [editingStatus, setEditingStatus] = useState(null);

  useEffect(() => { fetchOrders(); }, []);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dropship-orders', { params: { limit: 200 } });
      setOrders(res.data.orders);
    } catch {
      toast.error('Siparişler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const openNew = () => {
    setForm(EMPTY_FORM);
    setShowModal('new');
  };

  const openEdit = (order) => {
    setForm({
      orderRef: order.orderRef || '',
      productName: order.productName || '',
      productCode: order.productCode || '',
      supplierName: order.supplierName || '',
      quantity: order.quantity || 1,
      unitPrice: order.unitPrice || '',
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      shippingAddress: order.shippingAddress || '',
      notes: order.notes || ''
    });
    setShowModal(order);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (showModal === 'new') {
        await api.post('/dropship-orders', form);
        toast.success('Sipariş oluşturuldu');
      } else {
        await api.put(`/dropship-orders/${showModal.id}`, form);
        toast.success('Sipariş güncellendi');
      }
      setShowModal(false);
      fetchOrders();
    } catch (err) {
      toast.error(err.response?.data?.error || 'İşlem başarısız');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (orderId, newStatus) => {
    try {
      await api.put(`/dropship-orders/${orderId}`, { status: newStatus });
      toast.success('Durum güncellendi');
      setEditingStatus(null);
      fetchOrders();
      if (detailOrder?.id === orderId) setDetailOrder(prev => ({ ...prev, status: newStatus }));
    } catch {
      toast.error('Durum güncellenemedi');
    }
  };

  const handleDelete = async (orderId) => {
    if (!window.confirm('Bu siparişi silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/dropship-orders/${orderId}`);
      toast.success('Sipariş silindi');
      if (detailOrder?.id === orderId) setDetailOrder(null);
      fetchOrders();
    } catch {
      toast.error('Silinemedi');
    }
  };

  const filtered = orders.filter(o => {
    const matchStatus = !filterStatus || o.status === filterStatus;
    const q = search.toLowerCase();
    const matchSearch = !q || [o.productName, o.customerName, o.orderRef, o.supplierName]
      .some(v => v?.toLowerCase().includes(q));
    return matchStatus && matchSearch;
  });

  const stats = {
    total: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    ordered: orders.filter(o => o.status === 'ordered').length,
    shipped: orders.filter(o => o.status === 'shipped').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Tedarikçi Siparişleri</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Hazır XML Market ürünleri için tedarikçiye iletilen siparişleri yönetin
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={fetchOrders} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
          <button className="btn btn-primary" onClick={openNew}>
            <Plus size={16} /> Yeni Sipariş
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-4" style={{ marginBottom: 24, gap: 12 }}>
        {[
          { key: '', label: 'Toplam', value: stats.total, color: 'var(--text-primary)' },
          { key: 'pending', label: 'Bekliyor', value: stats.pending, color: '#f59e0b' },
          { key: 'ordered', label: 'Sipariş Verildi', value: stats.ordered, color: '#3b82f6' },
          { key: 'shipped', label: 'Kargoda', value: stats.shipped, color: '#8b5cf6' },
        ].map(s => (
          <div
            key={s.key}
            className="card"
            style={{ padding: '14px 18px', cursor: 'pointer', border: filterStatus === s.key ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)' }}
            onClick={() => setFilterStatus(s.key)}
          >
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-header" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Ürün, müşteri, sipariş no ara..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32, width: '100%' }}
              className="form-input"
            />
          </div>
          <select
            className="form-input"
            style={{ width: 'auto', minWidth: 160 }}
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="">Tüm Durumlar</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="loading-spinner"><div className="spinner"></div></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: 48 }}>
            <Truck size={48} className="empty-icon" />
            <h3>Henüz tedarikçi siparişi yok</h3>
            <p>Hazır XML Market'ten aldığınız ürünler için siparişleri buradan takip edin</p>
            <button className="btn btn-primary" onClick={openNew} style={{ marginTop: 12 }}>
              <Plus size={16} /> İlk Siparişi Oluştur
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {['Ürün', 'Tedarikçi', 'Müşteri', 'Miktar / Fiyat', 'Pz. Sipariş No', 'Durum', 'Tarih', 'İşlem'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(order => {
                  const st = STATUS[order.status] || STATUS.pending;
                  const StIcon = st.icon;
                  return (
                    <tr
                      key={order.id}
                      style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                      onClick={() => setDetailOrder(order)}
                    >
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{order.productName}</div>
                        {order.productCode && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>SKU: {order.productCode}</div>}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)' }}>
                        {order.supplierName || '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 13 }}>
                        <div>{order.customerName || '—'}</div>
                        {order.customerPhone && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{order.customerPhone}</div>}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 13 }}>
                        <div>{order.quantity} adet</div>
                        {order.unitPrice > 0 && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>₺{Number(order.unitPrice).toLocaleString('tr-TR')}</div>}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>
                        {order.orderRef || '—'}
                      </td>
                      <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <button
                            className={`badge ${st.color}`}
                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, border: 'none', padding: '4px 8px' }}
                            onClick={() => setEditingStatus(editingStatus === order.id ? null : order.id)}
                          >
                            <StIcon size={12} /> {st.label} <ChevronDown size={11} />
                          </button>
                          {editingStatus === order.id && (
                            <div style={{
                              position: 'absolute', top: '100%', left: 0, zIndex: 50,
                              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                              borderRadius: 8, padding: 4, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
                            }}>
                              {Object.entries(STATUS).map(([k, v]) => (
                                <button
                                  key={k}
                                  onClick={() => handleStatusChange(order.id, k)}
                                  className="dropdown-item"
                                  style={{ width: '100%', textAlign: 'left', padding: '6px 10px', fontSize: 12, background: order.status === k ? 'var(--bg-hover)' : 'transparent' }}
                                >
                                  {v.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {new Date(order.createdAt).toLocaleDateString('tr-TR')}
                      </td>
                      <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="header-icon-btn" title="Düzenle" onClick={() => openEdit(order)}><Edit2 size={15} /></button>
                          <button className="header-icon-btn text-danger" title="Sil" onClick={() => handleDelete(order.id)}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detailOrder && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 380,
          background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)',
          zIndex: 200, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.3)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Sipariş Detayı</h3>
            <button className="header-icon-btn" onClick={() => setDetailOrder(null)}><X size={18} /></button>
          </div>
          <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
            {(() => {
              const o = orders.find(x => x.id === detailOrder.id) || detailOrder;
              const st = STATUS[o.status] || STATUS.pending;
              const StIcon = st.icon;
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                    <span className={`badge ${st.color}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <StIcon size={12} /> {st.label}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {new Date(o.createdAt).toLocaleString('tr-TR')}
                    </span>
                  </div>

                  <Section title="Ürün Bilgisi">
                    <Row label="Ürün Adı" value={o.productName} />
                    <Row label="SKU / Kod" value={o.productCode} />
                    <Row label="Tedarikçi" value={o.supplierName} />
                    <Row label="Miktar" value={`${o.quantity} adet`} />
                    {o.unitPrice > 0 && <Row label="Birim Fiyat" value={`₺${Number(o.unitPrice).toLocaleString('tr-TR')}`} />}
                  </Section>

                  <Section title="Müşteri Bilgisi">
                    <Row label="Müşteri" value={o.customerName} />
                    <Row label="Telefon" value={o.customerPhone} />
                    <Row label="Adres" value={o.shippingAddress} />
                  </Section>

                  <Section title="Sipariş Takip">
                    <Row label="Pz. Sipariş No" value={o.orderRef} />
                    <Row label="Tedarikçi Sipariş No" value={o.supplierOrderId} />
                    <Row label="Kargo Firması" value={o.cargoCompany} />
                    <Row label="Takip No" value={o.trackingNumber} />
                    {o.orderedAt && <Row label="Sipariş Tarihi" value={new Date(o.orderedAt).toLocaleString('tr-TR')} />}
                    {o.shippedAt && <Row label="Kargo Tarihi" value={new Date(o.shippedAt).toLocaleString('tr-TR')} />}
                    {o.deliveredAt && <Row label="Teslim Tarihi" value={new Date(o.deliveredAt).toLocaleString('tr-TR')} />}
                  </Section>

                  {o.notes && (
                    <Section title="Notlar">
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{o.notes}</p>
                    </Section>
                  )}

                  <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
                    <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => openEdit(o)}>
                      <Edit2 size={14} /> Düzenle
                    </button>
                    <button className="btn btn-primary" style={{ flex: 1, background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handleDelete(o.id)}>
                      <Trash2 size={14} /> Sil
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Backdrop for detail */}
      {detailOrder && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.2)' }}
          onClick={() => setDetailOrder(null)}
        />
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 560, padding: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="table-header">
              <h3>{showModal === 'new' ? 'Yeni Tedarikçi Siparişi' : 'Siparişi Düzenle'}</h3>
              <button className="text-btn" onClick={() => setShowModal(false)}>Kapat</button>
            </div>
            <form onSubmit={handleSave} style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
              <fieldset style={{ border: 'none', padding: 0, marginBottom: 18 }}>
                <legend style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Ürün Bilgisi</legend>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Ürün Adı *</label>
                    <input type="text" className="form-input" value={form.productName} onChange={e => setForm({...form, productName: e.target.value})} required placeholder="Tedarikçiden sipariş ettiğiniz ürün" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Ürün Kodu / SKU</label>
                    <input type="text" className="form-input" value={form.productCode} onChange={e => setForm({...form, productCode: e.target.value})} placeholder="Opsiyonel" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tedarikçi Adı</label>
                    <input type="text" className="form-input" value={form.supplierName} onChange={e => setForm({...form, supplierName: e.target.value})} placeholder="Örn: ABC Tedarikçi" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Adet</label>
                    <input type="number" className="form-input" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} min="1" required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Birim Maliyet (₺)</label>
                    <input type="number" className="form-input" value={form.unitPrice} onChange={e => setForm({...form, unitPrice: e.target.value})} placeholder="0.00" step="0.01" min="0" />
                  </div>
                </div>
              </fieldset>

              <fieldset style={{ border: 'none', padding: 0, marginBottom: 18 }}>
                <legend style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Müşteri Bilgisi</legend>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Müşteri Adı</label>
                    <input type="text" className="form-input" value={form.customerName} onChange={e => setForm({...form, customerName: e.target.value})} placeholder="Ad Soyad" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Müşteri Telefonu</label>
                    <input type="text" className="form-input" value={form.customerPhone} onChange={e => setForm({...form, customerPhone: e.target.value})} placeholder="05XX XXX XX XX" />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Kargo Adresi</label>
                    <textarea className="form-input" rows={2} value={form.shippingAddress} onChange={e => setForm({...form, shippingAddress: e.target.value})} placeholder="Teslim adresi..." />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Pazaryeri Sipariş No (Referans)</label>
                    <input type="text" className="form-input" value={form.orderRef} onChange={e => setForm({...form, orderRef: e.target.value})} placeholder="Trendyol / Hepsiburada sipariş numarası" />
                  </div>
                </div>
              </fieldset>

              <fieldset style={{ border: 'none', padding: 0, marginBottom: 18 }}>
                <legend style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Notlar</legend>
                <textarea className="form-input" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Ek notlar, özel talepler..." />
              </fieldset>

              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowModal(false)}>Vazgeç</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
                  {saving ? 'Kaydediliyor...' : showModal === 'new' ? 'Sipariş Oluştur' : 'Değişiklikleri Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, gap: 12 }}>
      <span style={{ color: 'var(--text-secondary)', minWidth: 110 }}>{label}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}
