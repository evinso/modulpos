import { useState, useEffect } from 'react';
import { Send, Search, CheckSquare, Square, Package, RefreshCw, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function HepsiburadaSendPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState(null);

  useEffect(() => { fetchConnections(); }, []);
  useEffect(() => { if (selectedConn) fetchProducts(); }, [selectedConn, pagination.page, search]);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const hb = res.data.filter(c => c.marketplaceType === 'hepsiburada');
      setConnections(hb);
      if (hb.length > 0) setSelectedConn(hb[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const fetchProducts = async () => {
    try {
      const res = await api.get('/products', { params: { page: pagination.page, limit: 20, search } });
      setProducts(res.data.products);
      setPagination(p => ({ ...p, total: res.data.pagination.total, totalPages: res.data.pagination.totalPages }));
    } catch { toast.error('Ürünler yüklenemedi'); }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === products.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(products.map(p => p.id)));
  };

  const handleSync = async () => {
    if (!selectedConn || selectedIds.size === 0) return;
    const toSync = products.filter(p => selectedIds.has(p.id));
    const payload = toSync.map(p => ({
      sku: p.sku || p.barcode,
      price: p.price ?? 0,
      stock: p.stock ?? 0,
    })).filter(p => p.sku);

    if (payload.length === 0) {
      toast.error('Seçili ürünlerde SKU/Barkod bulunamadı');
      return;
    }

    setSyncing(true);
    setSyncResults(null);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/hepsiburada-sync`, { products: payload });
      setSyncResults(res.data);
      if (res.data.failed === 0) toast.success(`${res.data.sent} ürün başarıyla senkronize edildi`);
      else toast.error(`${res.data.sent} başarılı, ${res.data.failed} başarısız`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Senkronizasyon hatası');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Hepsiburada — Ürün Senkronizasyonu</h1></div>
        <div className="card">
          <div className="empty-state">
            <Package size={48} className="empty-icon" />
            <h3>Hepsiburada bağlantısı bulunamadı</h3>
            <p>Lütfen önce <a href="/marketplace" style={{ color: 'var(--accent-primary)' }}>Pazaryeri Bağlantıları</a> sayfasından Hepsiburada hesabınızı ekleyin.</p>
          </div>
        </div>
      </div>
    );
  }

  const resultMap = syncResults ? Object.fromEntries(syncResults.results.map(r => [r.sku, r])) : {};

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Hepsiburada — Ürün Senkronizasyonu</h1>
          <p>Fiyat ve stok bilgilerini Hepsiburada listelerinizle senkronize edin</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleSync}
          disabled={syncing || selectedIds.size === 0}
        >
          {syncing ? <><RefreshCw size={16} className="spinning" /> Gönderiliyor...</> : <><Send size={16} /> {selectedIds.size} Ürünü Senkronize Et</>}
        </button>
      </div>

      {/* Connection selector */}
      {connections.length > 1 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label className="form-label">Hepsiburada Hesabı</label>
          <select className="form-select" value={selectedConn?.id || ''} onChange={e => setSelectedConn(connections.find(c => c.id === e.target.value))}>
            {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
          </select>
        </div>
      )}

      {/* Info box */}
      <div style={{ background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <AlertCircle size={16} style={{ color: '#ff6000', flexShrink: 0, marginTop: 1 }} />
        <span>Bu sayfa mevcut Hepsiburada listelerinizin <strong>fiyat ve stok</strong> bilgilerini günceller. Yeni ürün oluşturmaz. Ürünün Hepsiburada'da listelenmesi için SKU/barkod eşleşmesi gerekir.</span>
      </div>

      {/* Sync results */}
      {syncResults && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <span style={{ color: 'var(--success)', fontWeight: 600 }}><CheckCircle size={14} style={{ marginRight: 4 }} />{syncResults.sent} Başarılı</span>
            {syncResults.failed > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}><XCircle size={14} style={{ marginRight: 4 }} />{syncResults.failed} Başarısız</span>}
          </div>
          {syncResults.results.filter(r => !r.success).map(r => (
            <div key={r.sku} style={{ fontSize: 12, color: 'var(--danger)', padding: '4px 0', borderBottom: '1px solid var(--border-color)' }}>
              <strong>{r.sku}</strong>: {r.error}
            </div>
          ))}
        </div>
      )}

      {/* Search + select all */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button type="button" onClick={toggleAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            {selectedIds.size === products.length && products.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
            Tümünü Seç
          </button>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
            <input
              className="form-input"
              style={{ paddingLeft: 32 }}
              placeholder="Ürün ara..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
            />
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pagination.total} ürün</span>
        </div>
      </div>

      {/* Product list */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
              <th style={{ width: 40, padding: '10px 12px' }}></th>
              <th style={{ padding: '10px 12px', textAlign: 'left' }}>Ürün</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Fiyat</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Stok</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Durum</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => {
              const sku = p.sku || p.barcode;
              const result = resultMap[sku];
              return (
                <tr
                  key={p.id}
                  onClick={() => toggleSelect(p.id)}
                  style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', background: selectedIds.has(p.id) ? 'rgba(99,102,241,0.06)' : 'transparent' }}
                >
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {selectedIds.has(p.id) ? <CheckSquare size={16} style={{ color: 'var(--accent-primary)' }} /> : <Square size={16} style={{ color: 'var(--text-muted)' }} />}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 500 }}>{p.title || p.name || 'İsimsiz'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>SKU: {sku || '—'}</div>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.price ? `${Number(p.price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.stock ?? '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {result ? (
                      result.success
                        ? <span style={{ color: 'var(--success)', fontSize: 11, fontWeight: 600 }}><CheckCircle size={12} /> OK</span>
                        : <span style={{ color: 'var(--danger)', fontSize: 11, fontWeight: 600 }} title={result.error}><XCircle size={12} /> Hata</span>
                    ) : !sku ? (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>SKU yok</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {products.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Package size={32} style={{ marginBottom: 8 }} />
            <div>Ürün bulunamadı</div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" disabled={pagination.page <= 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>Önceki</button>
          <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>{pagination.page} / {pagination.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>Sonraki</button>
        </div>
      )}
    </div>
  );
}
