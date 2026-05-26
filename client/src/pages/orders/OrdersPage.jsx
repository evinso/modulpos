import { useState, useEffect } from 'react';
import { RefreshCw, ShoppingCart, X, User, MapPin, Package } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const statusLabels = { new: 'Yeni', processing: 'Hazırlanıyor', shipped: 'Kargoda', delivered: 'Teslim Edildi', cancelled: 'İptal', returned: 'İade' };
const statusColors = { new: 'badge-info', processing: 'badge-warning', shipped: 'badge-primary', delivered: 'badge-success', cancelled: 'badge-danger', returned: 'badge-danger' };

function OrderDetailModal({ order, onClose }) {
  if (!order) return null;

  let items = [];
  try {
    items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
  } catch { items = []; }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620, width: '95%' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>Sipariş Detayı</h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {order.orderNumber}
            </p>
          </div>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Status + Marketplace */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`badge ${statusColors[order.status] || 'badge-info'}`}>
              {statusLabels[order.status] || order.status}
            </span>
            <span className="badge badge-primary">{order.connection?.marketplaceType || 'Manuel'}</span>
            {order.marketplaceOrderId && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                MP ID: {order.marketplaceOrderId}
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
              {new Date(order.orderDate).toLocaleString('tr-TR')}
            </span>
          </div>

          {/* Customer Info */}
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontWeight: 600, fontSize: 13 }}>
              <User size={15} style={{ color: 'var(--accent-primary)' }} /> Müşteri Bilgileri
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13 }}>
              {order.customerName && (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>Ad Soyad</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{order.customerName}</span>
                </>
              )}
              {order.customerEmail && (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>E-posta</span>
                  <span style={{ color: 'var(--text-primary)' }}>{order.customerEmail}</span>
                </>
              )}
              {order.customerPhone && (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>Telefon</span>
                  <span style={{ color: 'var(--text-primary)' }}>{order.customerPhone}</span>
                </>
              )}
            </div>
          </div>

          {/* Shipping Address */}
          {order.shippingAddress && (
            <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
                <MapPin size={15} style={{ color: 'var(--accent-primary)' }} /> Teslimat Adresi
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {typeof order.shippingAddress === 'string'
                  ? order.shippingAddress
                  : JSON.stringify(order.shippingAddress)}
              </p>
            </div>
          )}

          {/* Order Items */}
          {items.length > 0 && (
            <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontWeight: 600, fontSize: 13 }}>
                <Package size={15} style={{ color: 'var(--accent-primary)' }} /> Ürünler ({items.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 12px',
                    gap: 10,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.productName || item.name || item.title || `Ürün ${i + 1}`}
                      </div>
                      {(item.sku || item.barcode) && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>
                          {item.sku || item.barcode}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        x{item.quantity || item.qty || 1}
                      </span>
                      {(item.price || item.unitPrice || item.salePrice) != null && (
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                          ₺{Number(item.price || item.unitPrice || item.salePrice).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Total */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Toplam Tutar:</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              ₺{order.totalAmount?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [selectedOrder, setSelectedOrder] = useState(null);

  useEffect(() => { fetchOrders(); }, [pagination.page]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await api.get('/orders', { params: { page: pagination.page } });
      setOrders(res.data.orders);
      setPagination(res.data.pagination);
    } catch { toast.error('Siparişler yüklenemedi'); }
    finally { setLoading(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.post('/orders/sync');
      toast.success(res.data.message);
      fetchOrders();
    } catch { toast.error('Senkronizasyon hatası'); }
    finally { setSyncing(false); }
  };

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>Sipariş Yönetimi</h1><p>Tüm pazaryerlerinden gelen siparişlerinizi takip edin</p></div>
        <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
          <RefreshCw size={16} className={syncing ? 'spinning' : ''} /> {syncing ? 'Çekiliyor...' : 'Siparişleri Çek'}
        </button>
      </div>

      <div className="table-container">
        <div className="table-header">
          <h3>Siparişler ({pagination.total})</h3>
        </div>

        {loading ? (
          <div className="loading-spinner"><div className="spinner"></div></div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <ShoppingCart size={48} className="empty-icon" />
            <h3>Henüz sipariş yok</h3>
            <p>Pazaryeri bağlantılarınızı kurup siparişleri çekmeye başlayın</p>
          </div>
        ) : (
          <>
            <table>
              <thead>
                <tr><th>Sipariş No</th><th>Pazaryeri</th><th>Müşteri</th><th>Tutar</th><th>Durum</th><th>Tarih</th></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setSelectedOrder(o)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ fontFamily: 'monospace', fontWeight: 500 }}>{o.orderNumber}</td>
                    <td><span className="badge badge-primary">{o.connection?.marketplaceType || 'Manuel'}</span></td>
                    <td>{o.customerName || '-'}</td>
                    <td style={{ fontWeight: 600 }}>₺{o.totalAmount?.toLocaleString('tr-TR')}</td>
                    <td><span className={`badge ${statusColors[o.status] || 'badge-info'}`}>{statusLabels[o.status] || o.status}</span></td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{new Date(o.orderDate).toLocaleDateString('tr-TR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pagination.totalPages > 1 && (
              <div className="pagination">
                <button disabled={pagination.page <= 1} onClick={() => setPagination(p => ({...p, page: p.page - 1}))}>Önceki</button>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{pagination.page} / {pagination.totalPages}</span>
                <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(p => ({...p, page: p.page + 1}))}>Sonraki</button>
              </div>
            )}
          </>
        )}
      </div>

      <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
    </div>
  );
}
