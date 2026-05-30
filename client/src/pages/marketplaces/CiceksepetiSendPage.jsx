import { useState, useEffect } from 'react';
import { RefreshCw, Search, ArrowLeftRight, Package, ShoppingCart, Check, X, Clock } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import LoadingOverlay from '../../components/LoadingOverlay';

const ORDER_STATUS = {
  1: { label: 'Yeni',             color: 'var(--accent-primary)', bg: 'rgba(99,102,241,0.1)' },
  2: { label: 'Hazırlanıyor',     color: 'var(--warning)',        bg: 'rgba(245,158,11,0.1)' },
  3: { label: 'Kargoya Verildi',  color: '#3b82f6',               bg: 'rgba(59,130,246,0.1)' },
  4: { label: 'Teslim Edildi',    color: 'var(--success)',        bg: 'rgba(16,185,129,0.1)' },
  5: { label: 'İptal',            color: 'var(--danger)',         bg: 'rgba(239,68,68,0.1)'  },
  6: { label: 'İade',             color: '#f97316',               bg: 'rgba(249,115,22,0.1)' },
};

export default function CiceksepetiSendPage() {
  const [tab, setTab] = useState('listings'); // 'listings' | 'orders'
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [listings, setListings] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Active');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [orderPage, setOrderPage] = useState(0);

  useEffect(() => { fetchConnections(); }, []);
  useEffect(() => { if (selectedConn && tab === 'listings') fetchListings(); }, [selectedConn, statusFilter, page]);
  useEffect(() => { if (selectedConn && tab === 'orders') fetchOrders(); }, [selectedConn, orderStatusFilter, orderPage]);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const cs = res.data.filter(c => c.marketplaceType === 'ciceksepeti');
      setConnections(cs);
      if (cs.length > 0) setSelectedConn(cs[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const fetchListings = async () => {
    if (!selectedConn) return;
    setSyncing(true);
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/ciceksepeti-products`, {
        params: { status: statusFilter, page, pageSize: 50 },
      });
      setListings(Array.isArray(res.data) ? res.data : (res.data.products || res.data.items || []));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Listeler yüklenemedi');
    } finally { setSyncing(false); }
  };

  const fetchOrders = async () => {
    if (!selectedConn) return;
    setSyncing(true);
    try {
      const params = { page: orderPage, pageSize: 50 };
      if (orderStatusFilter) params.statusId = orderStatusFilter;
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/ciceksepeti-orders`, { params });
      setOrders(Array.isArray(res.data) ? res.data : (res.data.orders || res.data.items || []));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Siparişler yüklenemedi');
    } finally { setSyncing(false); }
  };

  const filteredListings = listings.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (p.name || p.productName || '').toLowerCase().includes(s)
      || (p.productCode || p.sku || '').toLowerCase().includes(s);
  });

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  if (connections.length === 0) return (
    <div className="page-title">
      <h1>Çiçeksepeti</h1>
      <div className="card" style={{ marginTop: 24, padding: 40, textAlign: 'center' }}>
        <Package size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
        <h3>Çiçeksepeti bağlantısı bulunamadı</h3>
        <p style={{ color: 'var(--text-muted)' }}>Pazaryerlerim sayfasından Çiçeksepeti hesabınızı ekleyin.</p>
      </div>
    </div>
  );

  return (
    <div>
      {syncing && <LoadingOverlay message="Çiçeksepeti'nden veriler alınıyor..." />}

      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Çiçeksepeti</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Ürün listeleri ve sipariş yönetimi</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {connections.length > 1 && (
            <select className="form-select" style={{ width: 'auto' }} value={selectedConn?.id}
              onChange={e => setSelectedConn(connections.find(c => c.id === e.target.value))}>
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
            </select>
          )}
          <button className="btn btn-secondary" onClick={tab === 'listings' ? fetchListings : fetchOrders} disabled={syncing}>
            <RefreshCw size={15} /> Yenile
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-color)', paddingBottom: 0 }}>
        {[
          { key: 'listings', label: 'Ürün Listeleri', icon: Package },
          { key: 'orders', label: 'Siparişler', icon: ShoppingCart },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', border: 'none',
            background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
            color: tab === t.key ? 'var(--accent-primary)' : 'var(--text-muted)',
            borderBottom: tab === t.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
            marginBottom: -1,
          }}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* Listings Tab */}
      {tab === 'listings' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-input" style={{ paddingLeft: 32 }} placeholder="Ürün adı veya kod ara..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: 160 }} value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(0); }}>
              <option value="Active">Aktif</option>
              <option value="Passive">Pasif</option>
              <option value="WaitingForApproval">Onay Bekliyor</option>
            </select>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Ürün</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Ürün Kodu</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Stok</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Satış Fiyatı</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Liste Fiyatı</th>
                </tr>
              </thead>
              <tbody>
                {filteredListings.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    {syncing ? 'Yükleniyor...' : 'Ürün bulunamadı'}
                  </td></tr>
                ) : filteredListings.map((p, i) => (
                  <tr key={p.productCode || p.id || i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {(p.imageUrl || p.mainImage) && (
                          <img src={p.imageUrl || p.mainImage} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                        )}
                        <div style={{ fontWeight: 500, lineHeight: 1.3 }}>{p.name || p.productName || '—'}</div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                      {p.productCode || p.merchantSku || '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{p.quantity ?? p.stock ?? '—'}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>
                      {p.salePrice != null ? `${parseFloat(p.salePrice).toFixed(2)}₺` : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {p.listPrice != null ? `${parseFloat(p.listPrice).toFixed(2)}₺` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12, borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Önceki</button>
              <span style={{ lineHeight: '32px', fontSize: 13, color: 'var(--text-muted)' }}>Sayfa {page + 1}</span>
              <button className="btn btn-secondary btn-sm" disabled={filteredListings.length < 50} onClick={() => setPage(p => p + 1)}>Sonraki ›</button>
            </div>
          </div>
        </>
      )}

      {/* Orders Tab */}
      {tab === 'orders' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <select className="form-select" style={{ width: 200 }} value={orderStatusFilter}
              onChange={e => { setOrderStatusFilter(e.target.value); setOrderPage(0); }}>
              <option value="">Tüm Siparişler</option>
              <option value="1">Yeni</option>
              <option value="2">Hazırlanıyor</option>
              <option value="3">Kargoya Verildi</option>
              <option value="4">Teslim Edildi</option>
              <option value="5">İptal</option>
              <option value="6">İade</option>
            </select>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Sipariş No</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Müşteri</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Tutar</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Durum</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Tarih</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    {syncing ? 'Yükleniyor...' : 'Sipariş bulunamadı'}
                  </td></tr>
                ) : orders.map((o, i) => {
                  const st = ORDER_STATUS[o.statusId || o.status];
                  const date = o.orderDate || o.createdAt;
                  return (
                    <tr key={o.orderNumber || o.id || i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>{o.orderNumber || o.id || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        {o.customerName || o.customer?.name || (o.customer ? `${o.customer.firstName || ''} ${o.customer.lastName || ''}`.trim() : '—')}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>
                        {o.totalPrice != null ? `${parseFloat(o.totalPrice).toFixed(2)}₺` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        {st ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: st.bg, color: st.color }}>
                            {st.label}
                          </span>
                        ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{o.statusId || o.status || '—'}</span>}
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 12 }}>
                        {date ? new Date(date).toLocaleDateString('tr-TR') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12, borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-secondary btn-sm" disabled={orderPage === 0} onClick={() => setOrderPage(p => p - 1)}>‹ Önceki</button>
              <span style={{ lineHeight: '32px', fontSize: 13, color: 'var(--text-muted)' }}>Sayfa {orderPage + 1}</span>
              <button className="btn btn-secondary btn-sm" disabled={orders.length < 50} onClick={() => setOrderPage(p => p + 1)}>Sonraki ›</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
