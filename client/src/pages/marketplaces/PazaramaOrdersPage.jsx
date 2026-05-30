import { useState, useEffect } from 'react';
import { ShoppingCart, RefreshCw, Search, Package } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const ORDER_STATUS_LABELS = {
  0: { label: 'Yeni',              color: 'var(--accent-primary)', bg: 'rgba(99,102,241,0.1)' },
  1: { label: 'Onaylandı',         color: '#3b82f6',               bg: 'rgba(59,130,246,0.1)' },
  2: { label: 'Hazırlanıyor',      color: 'var(--warning)',        bg: 'rgba(245,158,11,0.1)' },
  3: { label: 'Kargoya Verildi',   color: '#8b5cf6',               bg: 'rgba(139,92,246,0.1)' },
  4: { label: 'Teslim Edildi',     color: 'var(--success)',        bg: 'rgba(16,185,129,0.1)' },
  5: { label: 'İptal',             color: 'var(--danger)',         bg: 'rgba(239,68,68,0.1)'  },
  6: { label: 'İade Talep',        color: '#f97316',               bg: 'rgba(249,115,22,0.1)' },
  7: { label: 'İade Tamamlandı',   color: '#94a3b8',               bg: 'rgba(148,163,184,0.1)' },
};

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function PazaramaOrdersPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedOrder, setExpandedOrder] = useState(null);

  useEffect(() => { fetchConnections(); }, []);
  useEffect(() => { if (selectedConn) fetchOrders(); }, [selectedConn, page]);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const pz = res.data.filter(c => c.marketplaceType === 'pazarama');
      setConnections(pz);
      if (pz.length > 0) setSelectedConn(pz[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const fetchOrders = async () => {
    if (!selectedConn) return;
    setFetching(true);
    try {
      const params = { page, size: 50 };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/pazarama-orders`, { params });
      const data = res.data;
      setOrders(Array.isArray(data) ? data : (data.data || data.orders || data.items || []));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Siparişler yüklenemedi');
    } finally { setFetching(false); }
  };

  const filteredOrders = orders.filter(o => {
    if (!search) return true;
    const s = search.toLowerCase();
    return String(o.orderNumber || o.id || '').toLowerCase().includes(s)
      || (o.customerName || o.customerFullName || '').toLowerCase().includes(s);
  });

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  if (connections.length === 0) return (
    <div className="page-title">
      <h1>Pazarama — Siparişler</h1>
      <div className="card" style={{ marginTop: 24, padding: 40, textAlign: 'center' }}>
        <Package size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
        <h3>Pazarama bağlantısı bulunamadı</h3>
        <p style={{ color: 'var(--text-muted)' }}>Pazaryerlerim sayfasından Pazarama hesabınızı ekleyin.</p>
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Pazarama — Siparişler</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{filteredOrders.length} sipariş listeleniyor</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {connections.length > 1 && (
            <select className="form-select" style={{ width: 'auto' }} value={selectedConn?.id}
              onChange={e => setSelectedConn(connections.find(c => c.id === e.target.value))}>
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
            </select>
          )}
          <button className="btn btn-secondary" onClick={() => { setPage(1); fetchOrders(); }} disabled={fetching}>
            <RefreshCw size={15} /> Yenile
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" style={{ paddingLeft: 32 }} placeholder="Sipariş no veya müşteri ara..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <input type="date" className="form-input" style={{ width: 160 }} value={startDate}
          onChange={e => setStartDate(e.target.value)} placeholder="Başlangıç" />
        <input type="date" className="form-input" style={{ width: 160 }} value={endDate}
          onChange={e => setEndDate(e.target.value)} placeholder="Bitiş" />
        <button className="btn btn-secondary" onClick={() => { setPage(1); fetchOrders(); }}>Filtrele</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Sipariş No</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Müşteri</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}>Tutar</th>
              <th style={{ padding: '10px 14px', textAlign: 'center' }}>Durum</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Sipariş Tarihi</th>
              <th style={{ padding: '10px 14px', textAlign: 'center' }}>Ürünler</th>
            </tr>
          </thead>
          <tbody>
            {fetching ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
            ) : filteredOrders.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Sipariş bulunamadı</td></tr>
            ) : filteredOrders.map((o, i) => {
              const statusKey = o.status ?? o.statusId ?? o.orderStatus;
              const st = ORDER_STATUS_LABELS[statusKey];
              const isExpanded = expandedOrder === (o.orderNumber || o.id || i);
              const lines = o.orderLines || o.items || o.products || [];
              return (
                <>
                  <tr key={o.orderNumber || o.id || i}
                    style={{ borderBottom: '1px solid var(--border-color)', cursor: lines.length ? 'pointer' : 'default' }}
                    onClick={() => setExpandedOrder(isExpanded ? null : (o.orderNumber || o.id || i))}>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>{o.orderNumber || o.id || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>{o.customerName || o.customerFullName || o.buyer?.fullName || '—'}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>
                      {o.totalPrice != null ? `${parseFloat(o.totalPrice).toFixed(2)}₺` : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      {st ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                      ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{statusKey ?? '—'}</span>}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 12 }}>{fmt(o.orderDate || o.createdAt)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                      {lines.length > 0 ? `${lines.length} kalem` : '—'}
                    </td>
                  </tr>
                  {isExpanded && lines.length > 0 && (
                    <tr key={`exp-${o.orderNumber || i}`}>
                      <td colSpan={6} style={{ padding: '0 14px 12px 28px', background: 'var(--bg-secondary)' }}>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ color: 'var(--text-muted)' }}>
                              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500 }}>Ürün</th>
                              <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 500 }}>Adet</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>Birim Fiyat</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((l, li) => (
                              <tr key={li} style={{ borderTop: '1px solid var(--border-color)' }}>
                                <td style={{ padding: '6px 8px' }}>{l.productName || l.name || l.sku || '—'}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'center' }}>{l.quantity || l.count || 1}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                  {l.salePrice != null ? `${parseFloat(l.salePrice).toFixed(2)}₺` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12, borderTop: '1px solid var(--border-color)' }}>
          <button className="btn btn-secondary btn-sm" disabled={page === 1 || fetching} onClick={() => setPage(p => p - 1)}>‹ Önceki</button>
          <span style={{ lineHeight: '32px', fontSize: 13, color: 'var(--text-muted)' }}>Sayfa {page}</span>
          <button className="btn btn-secondary btn-sm" disabled={orders.length < 50 || fetching} onClick={() => setPage(p => p + 1)}>Sonraki ›</button>
        </div>
      </div>
    </div>
  );
}
