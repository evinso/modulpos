import { useState, useEffect, useRef } from 'react';
import {
  Truck, RefreshCw, Search, Edit2, Trash2, X, Plus,
  Package, Clock, CheckCircle, XCircle, Wallet, AlertCircle, Check
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const STATUS = {
  pending:   { label: 'Bekliyor',        color: 'badge-warning',  icon: Clock },
  ordered:   { label: 'Sipariş Verildi', color: 'badge-info',     icon: Package },
  shipped:   { label: 'Kargoda',         color: 'badge-primary',  icon: Truck },
  delivered: { label: 'Teslim Edildi',   color: 'badge-success',  icon: CheckCircle },
  cancelled: { label: 'İptal',           color: 'badge-danger',   icon: XCircle },
};

const EMPTY_NEW = {
  productSearch: '', selectedProduct: null, productResults: [],
  productSearching: false, quantity: 1, campaignCode: '',
  customerName: '', customerPhone: '', shippingAddress: '', notes: ''
};

export default function DropshipOrdersPage() {
  const [orders, setOrders]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [balance, setBalance]       = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch]         = useState('');

  // ── New order modal ──
  const [newModal, setNewModal]     = useState(false);
  const [newForm, setNewForm]       = useState(EMPTY_NEW);
  const [placing, setPlacing]       = useState(false);
  const searchTimeout               = useRef(null);

  // ── Edit modal (status + tracking + notes) ──
  const [editModal, setEditModal]   = useState(null);
  const [editForm, setEditForm]     = useState({});
  const [editSaving, setEditSaving] = useState(false);

  // ── Delete confirm modal ──
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleting, setDeleting]     = useState(false);

  useEffect(() => { fetchOrders(); fetchBalance(); }, []);

  const fetchBalance = async () => {
    try { const r = await api.get('/credits/balance'); setBalance(r.data.balance); } catch {}
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const r = await api.get('/dropship-orders', { params: { limit: 200 } });
      setOrders(r.data.orders);
    } catch { toast.error('Siparişler yüklenemedi'); }
    finally { setLoading(false); }
  };

  // ── Product search (inside new modal) ──
  const handleProductSearch = (val) => {
    setNewForm(f => ({ ...f, productSearch: val, selectedProduct: null }));
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!val.trim()) { setNewForm(f => ({ ...f, productResults: [] })); return; }
    searchTimeout.current = setTimeout(async () => {
      setNewForm(f => ({ ...f, productSearching: true }));
      try {
        const r = await api.get('/products', { params: { search: val, limit: 10, globalXmlOnly: 'true' } });
        setNewForm(f => ({ ...f, productResults: r.data.products || [], productSearching: false }));
      } catch { setNewForm(f => ({ ...f, productResults: [], productSearching: false })); }
    }, 350);
  };

  const selectProduct = (p) => {
    setNewForm(f => ({ ...f, selectedProduct: p, productSearch: p.title, productResults: [] }));
  };

  const unitCost = newForm.selectedProduct
    ? (newForm.selectedProduct.xmlPrice > 0 ? newForm.selectedProduct.xmlPrice : newForm.selectedProduct.price)
    : 0;
  const totalCost   = parseFloat((unitCost * Math.max(1, parseInt(newForm.quantity) || 1)).toFixed(2));
  const canAfford   = balance !== null && balance >= totalCost;

  const handlePlace = async (e) => {
    e.preventDefault();
    if (!newForm.selectedProduct) return toast.error('Ürün seçin');
    if (!newForm.campaignCode.trim()) return toast.error('Kampanya / kargo kodu zorunludur');
    if (!canAfford) return toast.error(`Yetersiz kredi (Gerekli: ₺${totalCost})`);
    setPlacing(true);
    try {
      const r = await api.post('/dropship-orders/place', {
        productId:       newForm.selectedProduct.id,
        campaignCode:    newForm.campaignCode.trim(),
        quantity:        parseInt(newForm.quantity) || 1,
        customerName:    newForm.customerName   || undefined,
        customerPhone:   newForm.customerPhone  || undefined,
        shippingAddress: newForm.shippingAddress || undefined,
        notes:           newForm.notes           || undefined,
      });
      toast.success(`Sipariş oluşturuldu! ₺${r.data.deducted} kredi düşüldü.`);
      setNewModal(false);
      setNewForm(EMPTY_NEW);
      fetchOrders(); fetchBalance();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Sipariş oluşturulamadı');
    } finally { setPlacing(false); }
  };

  // ── Edit modal ──
  const openEdit = (order) => {
    setEditForm({
      status:          order.status,
      campaignCode:    order.campaignCode    || '',
      trackingNumber:  order.trackingNumber  || '',
      cargoCompany:    order.cargoCompany    || '',
      supplierOrderId: order.supplierOrderId || '',
      notes:           order.notes           || '',
    });
    setEditModal(order);
  };

  const handleEditSave = async (e) => {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api.put(`/dropship-orders/${editModal.id}`, editForm);
      toast.success('Sipariş güncellendi');
      setEditModal(null);
      fetchOrders();
    } catch { toast.error('Güncellenemedi'); }
    finally { setEditSaving(false); }
  };

  // ── Delete ──
  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      await api.delete(`/dropship-orders/${deleteModal.id}`);
      toast.success('Sipariş silindi');
      setDeleteModal(null);
      fetchOrders();
    } catch { toast.error('Silinemedi'); }
    finally { setDeleting(false); }
  };

  const filtered = orders.filter(o => {
    const ms = !filterStatus || o.status === filterStatus;
    const q  = search.toLowerCase();
    return ms && (!q || [o.productName, o.customerName, o.campaignCode, o.supplierName].some(v => v?.toLowerCase().includes(q)));
  });

  const stats = Object.fromEntries(Object.keys(STATUS).map(k => [k, orders.filter(o => o.status === k).length]));

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Tedarikçi Siparişleri</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>XML kaynaklı ürünleri tedarikçiye sipariş edin, kredi bakiyenizden ödeme yapılır</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {balance !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'rgba(59,130,246,0.1)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.2)' }}>
              <Wallet size={14} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-primary)' }}>₺{Number(balance).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
            </div>
          )}
          <button className="btn btn-secondary" onClick={() => { fetchOrders(); fetchBalance(); }} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
          <button className="btn btn-primary" onClick={() => { setNewForm(EMPTY_NEW); setNewModal(true); }}>
            <Plus size={16} /> Yeni Sipariş
          </button>
        </div>
      </div>

      {/* ── Status filter pills ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {Object.entries(STATUS).map(([k, v]) => {
          const Icon = v.icon;
          return (
            <button key={k} onClick={() => setFilterStatus(filterStatus === k ? '' : k)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                border: `1px solid ${filterStatus === k ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                background: filterStatus === k ? 'rgba(59,130,246,0.1)' : 'var(--bg-card)', color: 'var(--text-primary)' }}>
              <Icon size={13} /> {v.label} <strong>{stats[k]}</strong>
            </button>
          );
        })}
      </div>

      {/* ── Table ── */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-header" style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input type="text" className="form-input" style={{ paddingLeft: 32 }} placeholder="Ürün, müşteri, kampanya kodu ara..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="loading-spinner"><div className="spinner"></div></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: 56 }}>
            <Truck size={48} className="empty-icon" />
            <h3>{orders.length === 0 ? 'Henüz sipariş yok' : 'Filtreyle eşleşen sipariş yok'}</h3>
            <p>Ürün seçip kampanya kodu girerek sipariş oluşturun</p>
            <button className="btn btn-primary" onClick={() => setNewModal(true)} style={{ marginTop: 12 }}>
              <Plus size={16} /> İlk Siparişi Oluştur
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {['Ürün', 'Tedarikçi', 'Kampanya Kodu', 'Miktar', 'Ödenen', 'Müşteri', 'Durum', 'Takip No', 'Tarih', 'İşlem'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(order => {
                  const st = STATUS[order.status] || STATUS.pending;
                  const StIcon = st.icon;
                  return (
                    <tr key={order.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 600, fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.productName}</div>
                        {order.productCode && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{order.productCode}</div>}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{order.supplierName || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{order.campaignCode || <span style={{ color: 'var(--text-secondary)' }}>—</span>}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, whiteSpace: 'nowrap' }}>{order.quantity} adet</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>
                        {order.creditAmount > 0 ? `₺${Number(order.creditAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12 }}>
                        <div>{order.customerName || '—'}</div>
                        {order.customerPhone && <div style={{ color: 'var(--text-secondary)' }}>{order.customerPhone}</div>}
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span className={`badge ${st.color}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <StIcon size={11} /> {st.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {order.trackingNumber
                          ? <><div style={{ fontWeight: 500 }}>{order.trackingNumber}</div><div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{order.cargoCompany}</div></>
                          : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {new Date(order.createdAt).toLocaleDateString('tr-TR')}
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12, height: 'auto' }} onClick={() => openEdit(order)}>
                            <Edit2 size={13} style={{ marginRight: 4 }} /> Düzenle
                          </button>
                          <button className="header-icon-btn text-danger" title="Sil" onClick={() => setDeleteModal(order)}>
                            <Trash2 size={14} />
                          </button>
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

      {/* ════ NEW ORDER MODAL ════ */}
      {newModal && (
        <Modal title="Yeni Tedarikçi Siparişi" onClose={() => setNewModal(false)} maxWidth={580}>
          <form onSubmit={handlePlace} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Product search */}
            <div style={{ position: 'relative' }}>
              <label className="form-label">Ürün Ara (Hazır XML Market) *</label>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
                <input type="text" className="form-input"
                  style={{ paddingLeft: 32, paddingRight: newForm.selectedProduct ? 32 : 12 }}
                  placeholder="Ürün adı, SKU veya barkod..."
                  value={newForm.productSearch}
                  onChange={e => handleProductSearch(e.target.value)} />
                {newForm.selectedProduct && (
                  <button type="button" onClick={() => setNewForm(f => ({ ...f, selectedProduct: null, productSearch: '', productResults: [] }))}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    <X size={14} />
                  </button>
                )}
              </div>
              {(newForm.productResults.length > 0 || newForm.productSearching) && !newForm.selectedProduct && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: 260, overflowY: 'auto', marginTop: 4 }}>
                  {newForm.productSearching
                    ? <div style={{ padding: 14, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>Aranıyor...</div>
                    : newForm.productResults.map(p => {
                        const cost = p.xmlPrice > 0 ? p.xmlPrice : p.price;
                        return (
                          <button key={p.id} type="button" className="dropdown-item"
                            style={{ width: '100%', textAlign: 'left', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}
                            onClick={() => selectProduct(p)}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{p.xmlSource?.name || '—'}{p.sku ? ` · ${p.sku}` : ''}</div>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>₺{Number(cost).toLocaleString('tr-TR')}</div>
                          </button>
                        );
                      })}
                </div>
              )}
            </div>

            {/* Selected product preview */}
            {newForm.selectedProduct && (
              <div style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{newForm.selectedProduct.title}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span>{newForm.selectedProduct.xmlSource?.name || '—'}{newForm.selectedProduct.sku ? ` · ${newForm.selectedProduct.sku}` : ''}</span>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>₺{Number(unitCost).toLocaleString('tr-TR')} / adet</span>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label">Adet</label>
                <input type="number" className="form-input" min="1" value={newForm.quantity} onChange={e => setNewForm(f => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Trendyol Kampanya / Kargo Kodu *</label>
                <input type="text" className="form-input" value={newForm.campaignCode} onChange={e => setNewForm(f => ({ ...f, campaignCode: e.target.value }))} placeholder="Kampanya veya kargo kodu" required />
              </div>
            </div>

            <Divider label="Müşteri Bilgisi (Opsiyonel)" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label">Müşteri Adı</label>
                <input type="text" className="form-input" value={newForm.customerName} onChange={e => setNewForm(f => ({ ...f, customerName: e.target.value }))} placeholder="Ad Soyad" />
              </div>
              <div>
                <label className="form-label">Telefon</label>
                <input type="text" className="form-input" value={newForm.customerPhone} onChange={e => setNewForm(f => ({ ...f, customerPhone: e.target.value }))} placeholder="05XX XXX XX XX" />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Kargo Adresi</label>
                <textarea className="form-input" rows={2} value={newForm.shippingAddress} onChange={e => setNewForm(f => ({ ...f, shippingAddress: e.target.value }))} placeholder="Teslimat adresi..." />
              </div>
            </div>

            <div>
              <label className="form-label">Notlar</label>
              <textarea className="form-input" rows={2} value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} placeholder="Ek notlar, özel talepler..." />
            </div>

            {/* Cost summary */}
            {newForm.selectedProduct && (
              <div style={{ background: canAfford ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)', border: `1px solid ${canAfford ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ödenecek Kredi</span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: canAfford ? '#22c55e' : 'var(--danger)' }}>₺{totalCost.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                </div>
                {balance !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span>Mevcut bakiye</span>
                    <span>₺{Number(balance).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {!canAfford && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>
                    <AlertCircle size={13} /> Yetersiz bakiye — <a href="/credits" style={{ color: 'var(--danger)', textDecoration: 'underline' }}>Kredi yükle</a>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setNewModal(false)}>Vazgeç</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}
                disabled={placing || !newForm.selectedProduct || !newForm.campaignCode.trim() || !canAfford}>
                {placing ? 'Sipariş Veriliyor...' : <><Check size={15} /> Sipariş Ver — ₺{totalCost.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} Kredi Düş</>}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ════ EDIT MODAL ════ */}
      {editModal && (
        <Modal title="Siparişi Düzenle" onClose={() => setEditModal(null)} maxWidth={480}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', marginBottom: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{editModal.productName}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {editModal.supplierName || '—'}{editModal.campaignCode ? ` · ${editModal.campaignCode}` : ''}
              {editModal.creditAmount > 0 ? ` · ₺${Number(editModal.creditAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : ''}
            </div>
          </div>
          <form onSubmit={handleEditSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label">Durum</label>
                <select className="form-input" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Kampanya / Kargo Kodu</label>
                <input type="text" className="form-input" value={editForm.campaignCode} onChange={e => setEditForm(f => ({ ...f, campaignCode: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Kargo Firması</label>
                <input type="text" className="form-input" value={editForm.cargoCompany} onChange={e => setEditForm(f => ({ ...f, cargoCompany: e.target.value }))} placeholder="Yurtiçi, Aras..." />
              </div>
              <div>
                <label className="form-label">Takip Numarası</label>
                <input type="text" className="form-input" value={editForm.trackingNumber} onChange={e => setEditForm(f => ({ ...f, trackingNumber: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Tedarikçi Sipariş No</label>
                <input type="text" className="form-input" value={editForm.supplierOrderId} onChange={e => setEditForm(f => ({ ...f, supplierOrderId: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Notlar</label>
                <textarea className="form-input" rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditModal(null)}>Vazgeç</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={editSaving}>
                {editSaving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ════ DELETE CONFIRM MODAL ════ */}
      {deleteModal && (
        <Modal title="Siparişi Sil" onClose={() => setDeleteModal(null)} maxWidth={400}>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
            <strong>{deleteModal.productName}</strong> siparişini silmek istediğinize emin misiniz?
            <br /><span style={{ color: 'var(--danger)', fontSize: 13 }}>Bu işlem geri alınamaz.</span>
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setDeleteModal(null)}>Vazgeç</button>
            <button className="btn btn-primary" style={{ flex: 1, background: 'var(--danger)', borderColor: 'var(--danger)' }}
              onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Siliniyor...' : 'Evet, Sil'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Shared helpers ── */
function Modal({ title, onClose, maxWidth = 500, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth, padding: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="table-header" style={{ flexShrink: 0 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h3>
          <button className="header-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

function Divider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
    </div>
  );
}
