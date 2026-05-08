import { useState, useEffect, useRef } from 'react';
import {
  Truck, RefreshCw, Search, Edit2, Trash2, X,
  Package, Clock, CheckCircle, XCircle, ChevronDown,
  Wallet, Tag, AlertCircle, ArrowRight, Check
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const STATUS = {
  pending:   { label: 'Bekliyor',         color: 'badge-warning',  icon: Clock },
  ordered:   { label: 'Sipariş Verildi',  color: 'badge-info',     icon: Package },
  shipped:   { label: 'Kargoda',          color: 'badge-primary',  icon: Truck },
  delivered: { label: 'Teslim Edildi',    color: 'badge-success',  icon: CheckCircle },
  cancelled: { label: 'İptal',            color: 'badge-danger',   icon: XCircle },
};

export default function DropshipOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');

  // Credit balance
  const [balance, setBalance] = useState(null);

  // Product search
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [productSearching, setProductSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const searchTimeout = useRef(null);

  // Order form
  const [campaignCode, setCampaignCode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);

  // Detail / edit
  const [detailOrder, setDetailOrder] = useState(null);
  const [editingStatus, setEditingStatus] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    fetchOrders();
    fetchBalance();
  }, []);

  const fetchBalance = async () => {
    try {
      const res = await api.get('/credits/balance');
      setBalance(res.data.balance);
    } catch {}
  };

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

  // Debounced product search
  const handleProductSearch = (val) => {
    setProductSearch(val);
    setSelectedProduct(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!val.trim()) { setProductResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setProductSearching(true);
      try {
        const res = await api.get('/products', { params: { search: val, limit: 10 } });
        setProductResults(res.data.products || []);
      } catch {
        setProductResults([]);
      } finally {
        setProductSearching(false);
      }
    }, 350);
  };

  const selectProduct = (p) => {
    setSelectedProduct(p);
    setProductSearch(p.title);
    setProductResults([]);
    setQuantity(1);
  };

  const clearProduct = () => {
    setSelectedProduct(null);
    setProductSearch('');
    setProductResults([]);
  };

  const unitCost = selectedProduct
    ? (selectedProduct.xmlPrice > 0 ? selectedProduct.xmlPrice : selectedProduct.price)
    : 0;
  const totalCost = parseFloat((unitCost * Math.max(1, parseInt(quantity) || 1)).toFixed(2));
  const canAfford = balance !== null && balance >= totalCost;

  const handlePlace = async (e) => {
    e.preventDefault();
    if (!selectedProduct) return toast.error('Ürün seçin');
    if (!campaignCode.trim()) return toast.error('Kampanya / kargo kodu zorunludur');
    if (!canAfford) return toast.error(`Yetersiz kredi (Gerekli: ₺${totalCost}, Mevcut: ₺${balance?.toFixed(2)})`);

    setPlacing(true);
    try {
      const res = await api.post('/dropship-orders/place', {
        productId: selectedProduct.id,
        campaignCode: campaignCode.trim(),
        quantity: parseInt(quantity) || 1,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        shippingAddress: shippingAddress || undefined,
        notes: notes || undefined
      });
      toast.success(`Sipariş oluşturuldu! ₺${res.data.deducted} kredi düşüldü.`);
      // Reset form
      clearProduct();
      setCampaignCode('');
      setQuantity(1);
      setCustomerName('');
      setCustomerPhone('');
      setShippingAddress('');
      setNotes('');
      fetchOrders();
      fetchBalance();
    } catch (err) {
      const msg = err.response?.data?.error || 'Sipariş oluşturulamadı';
      toast.error(msg);
    } finally {
      setPlacing(false);
    }
  };

  const handleStatusChange = async (orderId, newStatus) => {
    try {
      await api.put(`/dropship-orders/${orderId}`, { status: newStatus });
      toast.success('Durum güncellendi');
      setEditingStatus(null);
      fetchOrders();
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

  const openEdit = (order) => {
    setEditForm({
      campaignCode: order.campaignCode || '',
      trackingNumber: order.trackingNumber || '',
      cargoCompany: order.cargoCompany || '',
      supplierOrderId: order.supplierOrderId || '',
      notes: order.notes || ''
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
    } catch {
      toast.error('Güncellenemedi');
    } finally {
      setEditSaving(false);
    }
  };

  const filtered = orders.filter(o => {
    const matchStatus = !filterStatus || o.status === filterStatus;
    const q = search.toLowerCase();
    const matchSearch = !q || [o.productName, o.customerName, o.campaignCode, o.supplierName]
      .some(v => v?.toLowerCase().includes(q));
    return matchStatus && matchSearch;
  });

  const stats = Object.fromEntries(
    Object.keys(STATUS).map(k => [k, orders.filter(o => o.status === k).length])
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Tedarikçi Siparişleri</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            XML kaynaklı ürünleri tedarikçiye sipariş edin, kredi bakiyenizden ödeme yapılır
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {balance !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'rgba(59,130,246,0.1)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.2)' }}>
              <Wallet size={14} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-primary)' }}>₺{Number(balance).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
            </div>
          )}
          <button className="btn btn-secondary" onClick={() => { fetchOrders(); fetchBalance(); }} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 24, alignItems: 'flex-start' }}>
        {/* ─── Left: New Order Form ─── */}
        <div className="card" style={{ padding: 24, position: 'sticky', top: 80 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag size={16} style={{ color: 'var(--accent-primary)' }} /> Yeni Sipariş Oluştur
          </h3>

          <form onSubmit={handlePlace} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Product search */}
            <div style={{ position: 'relative' }}>
              <label className="form-label">Ürün Ara (XML Kaynakları)</label>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 32, paddingRight: selectedProduct ? 32 : 12 }}
                  placeholder="Ürün adı, SKU veya barkod..."
                  value={productSearch}
                  onChange={e => handleProductSearch(e.target.value)}
                />
                {selectedProduct && (
                  <button type="button" onClick={clearProduct} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Dropdown results */}
              {productResults.length > 0 && !selectedProduct && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                  background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', maxHeight: 280, overflowY: 'auto', marginTop: 4
                }}>
                  {productResults.map(p => {
                    const cost = p.xmlPrice > 0 ? p.xmlPrice : p.price;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className="dropdown-item"
                        style={{ width: '100%', textAlign: 'left', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}
                        onClick={() => selectProduct(p)}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                            {p.xmlSource?.name || 'Bilinmeyen kaynak'}{p.sku ? ` · ${p.sku}` : ''}
                          </div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>
                          ₺{Number(cost).toLocaleString('tr-TR')}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {productSearching && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 14, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Aranıyor...
                </div>
              )}
            </div>

            {/* Selected product preview */}
            {selectedProduct && (
              <div style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedProduct.title}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span>{selectedProduct.xmlSource?.name || '—'}{selectedProduct.sku ? ` · ${selectedProduct.sku}` : ''}</span>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>₺{Number(unitCost).toLocaleString('tr-TR')} / adet</span>
                </div>
              </div>
            )}

            {/* Quantity */}
            <div>
              <label className="form-label">Adet</label>
              <input type="number" className="form-input" min="1" value={quantity}
                onChange={e => setQuantity(e.target.value)} />
            </div>

            {/* Campaign code */}
            <div>
              <label className="form-label">Trendyol Kampanya / Kargo Kodu *</label>
              <input type="text" className="form-input" value={campaignCode}
                onChange={e => setCampaignCode(e.target.value)}
                placeholder="Kampanya veya kargo kodu giriniz"
                required />
            </div>

            {/* Customer info */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Müşteri Bilgisi (Opsiyonel)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input type="text" className="form-input" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Müşteri adı soyadı" />
                <input type="text" className="form-input" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="Telefon numarası" />
                <textarea className="form-input" rows={2} value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} placeholder="Kargo adresi..." />
              </div>
            </div>

            <div>
              <label className="form-label">Notlar</label>
              <textarea className="form-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ek notlar, özel talepler..." />
            </div>

            {/* Cost summary */}
            {selectedProduct && (
              <div style={{
                background: canAfford ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)',
                border: `1px solid ${canAfford ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                borderRadius: 10, padding: '12px 14px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ödenecek Kredi</span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: canAfford ? 'var(--success, #22c55e)' : 'var(--danger)' }}>
                    ₺{totalCost.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </span>
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

            <button
              type="submit"
              className="btn btn-primary"
              disabled={placing || !selectedProduct || !campaignCode.trim() || !canAfford}
              style={{ justifyContent: 'center' }}
            >
              {placing ? 'Sipariş Veriliyor...' : (
                <><Check size={16} /> Sipariş Ver — ₺{totalCost.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} Kredi Düş</>
              )}
            </button>
          </form>
        </div>

        {/* ─── Right: Orders list ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Stats row */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {Object.entries(STATUS).map(([k, v]) => {
              const Icon = v.icon;
              return (
                <button
                  key={k}
                  onClick={() => setFilterStatus(filterStatus === k ? '' : k)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: 8, border: `1px solid ${filterStatus === k ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: filterStatus === k ? 'rgba(59,130,246,0.1)' : 'var(--bg-card)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 500, color: 'var(--text-primary)'
                  }}
                >
                  <Icon size={13} /> {v.label} <span style={{ fontWeight: 700 }}>{stats[k]}</span>
                </button>
              );
            })}
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="table-header" style={{ display: 'flex', gap: 10 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input type="text" className="form-input" style={{ paddingLeft: 32 }} placeholder="Sipariş ara..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>

            {loading ? (
              <div className="loading-spinner"><div className="spinner"></div></div>
            ) : filtered.length === 0 ? (
              <div className="empty-state" style={{ padding: 48 }}>
                <Truck size={48} className="empty-icon" />
                <h3>{orders.length === 0 ? 'Henüz sipariş yok' : 'Filtreyle eşleşen sipariş yok'}</h3>
                <p>Sol panelden ürün arayıp kampanya kodu girerek sipariş oluşturun</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      {['Ürün', 'Tedarikçi', 'Kampanya Kodu', 'Miktar', 'Kredi', 'Müşteri', 'Durum', 'Takip', 'İşlem'].map(h => (
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
                            <div style={{ fontWeight: 600, fontSize: 13, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.productName}</div>
                            {order.productCode && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{order.productCode}</div>}
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>{order.supplierName || '—'}</td>
                          <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500 }}>
                            {order.campaignCode || <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 13 }}>{order.quantity} adet</td>
                          <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--accent-primary)' }}>
                            {order.creditAmount > 0 ? `₺${Number(order.creditAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 12 }}>
                            <div>{order.customerName || '—'}</div>
                            {order.customerPhone && <div style={{ color: 'var(--text-secondary)' }}>{order.customerPhone}</div>}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ position: 'relative', display: 'inline-block' }}>
                              <button
                                className={`badge ${st.color}`}
                                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, border: 'none', padding: '4px 8px' }}
                                onClick={() => setEditingStatus(editingStatus === order.id ? null : order.id)}
                              >
                                <StIcon size={11} /> {st.label} <ChevronDown size={10} />
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
                          <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>
                            {order.trackingNumber || '—'}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="header-icon-btn" title="Düzenle" onClick={() => openEdit(order)}><Edit2 size={14} /></button>
                              <button className="header-icon-btn text-danger" title="Sil" onClick={() => handleDelete(order.id)}><Trash2 size={14} /></button>
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
        </div>
      </div>

      {/* Edit Modal */}
      {editModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 460, padding: 0 }}>
            <div className="table-header">
              <h3>Sipariş Bilgilerini Güncelle</h3>
              <button className="text-btn" onClick={() => setEditModal(null)}>Kapat</button>
            </div>
            <form onSubmit={handleEditSave} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{editModal.productName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{editModal.supplierName || '—'}</div>
              </div>
              <div>
                <label className="form-label">Kampanya / Kargo Kodu</label>
                <input type="text" className="form-input" value={editForm.campaignCode} onChange={e => setEditForm({...editForm, campaignCode: e.target.value})} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label">Tedarikçi Sipariş No</label>
                  <input type="text" className="form-input" value={editForm.supplierOrderId} onChange={e => setEditForm({...editForm, supplierOrderId: e.target.value})} />
                </div>
                <div>
                  <label className="form-label">Kargo Firması</label>
                  <input type="text" className="form-input" value={editForm.cargoCompany} onChange={e => setEditForm({...editForm, cargoCompany: e.target.value})} placeholder="Yurtiçi, Aras..." />
                </div>
              </div>
              <div>
                <label className="form-label">Takip Numarası</label>
                <input type="text" className="form-input" value={editForm.trackingNumber} onChange={e => setEditForm({...editForm, trackingNumber: e.target.value})} />
              </div>
              <div>
                <label className="form-label">Notlar</label>
                <textarea className="form-input" rows={2} value={editForm.notes} onChange={e => setEditForm({...editForm, notes: e.target.value})} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditModal(null)}>Vazgeç</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={editSaving}>
                  {editSaving ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
