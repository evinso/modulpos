import { useState, useEffect } from 'react';
import { RefreshCw, ShoppingCart } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const statusLabels = { new: 'Yeni', processing: 'Hazırlanıyor', shipped: 'Kargoda', delivered: 'Teslim Edildi', cancelled: 'İptal', returned: 'İade' };
const statusColors = { new: 'badge-info', processing: 'badge-warning', shipped: 'badge-primary', delivered: 'badge-success', cancelled: 'badge-danger', returned: 'badge-danger' };

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });

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
                  <tr key={o.id}>
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
    </div>
  );
}
