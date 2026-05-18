import { useState, useEffect, useMemo } from 'react';
import { Send, Search, CheckSquare, Square, Package, RefreshCw, AlertCircle, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function HepsiburadaCreatePage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [mappings, setMappings] = useState([]);
  const [minStock, setMinStock] = useState(0);
  const [filterStatus, setFilterStatus] = useState('all');
  const [sendResult, setSendResult] = useState(null);
  const [trackingId, setTrackingId] = useState(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingResult, setTrackingResult] = useState(null);

  useEffect(() => { fetchConnections(); }, []);
  useEffect(() => { if (selectedConn) { fetchProducts(); fetchMappings(); } }, [selectedConn, pagination.page, search]);

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

  const fetchMappings = async () => {
    if (!selectedConn) return;
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/category-mappings`);
      setMappings(res.data);
    } catch {}
  };

  const mappedLookup = useMemo(() => {
    const acc = {};
    for (const m of mappings) acc[m.localCategory?.toLowerCase().trim()] = m;
    return acc;
  }, [mappings]);

  const getProductStatus = (p) => {
    const hasCat = !!mappedLookup[p.category?.toLowerCase().trim()];
    const hasBarcode = !!(p.barcode || p.sku);
    const hasPrice = !!(p.price && Number(p.price) > 0);
    const hasBrand = !!p.brand;
    if (hasCat && hasBarcode && hasPrice && hasBrand) return 'ready';
    return 'missing';
  };

  const getMissingReasons = (p) => {
    const reasons = [];
    if (!mappedLookup[p.category?.toLowerCase().trim()]) reasons.push('Kategori eşlemesi yok');
    if (!p.barcode && !p.sku) reasons.push('Barkod/SKU eksik');
    if (!p.price || Number(p.price) <= 0) reasons.push('Fiyat eksik');
    if (!p.brand) reasons.push('Marka eksik');
    return reasons;
  };

  const filteredProducts = filterStatus === 'all' ? products : products.filter(p => getProductStatus(p) === filterStatus);
  const readyCount = products.filter(p => getProductStatus(p) === 'ready').length;
  const missingCount = products.filter(p => getProductStatus(p) === 'missing').length;

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const readyIds = filteredProducts.filter(p => getProductStatus(p) === 'ready').map(p => p.id);
    const allSelected = readyIds.length > 0 && readyIds.every(id => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(readyIds));
  };

  const handleCreate = async () => {
    if (!selectedConn || selectedIds.size === 0) return;
    setSending(true);
    setSendResult(null);
    setTrackingId(null);
    setTrackingResult(null);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/hepsiburada-create`, {
        productIds: Array.from(selectedIds),
        minStock,
      });
      setSendResult(res.data);
      if (res.data.trackingId) setTrackingId(res.data.trackingId);
      if (res.data.sent > 0) toast.success(`${res.data.sent} ürün Hepsiburada'ya gönderildi`);
      else toast.error('Hiçbir ürün gönderilemedi');
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(err.response?.data?.error || 'Gönderme hatası');
    } finally { setSending(false); }
  };

  const checkTracking = async () => {
    if (!trackingId || !selectedConn) return;
    setTrackingLoading(true);
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/hepsiburada-import-status/${trackingId}`);
      setTrackingResult(res.data);
    } catch (err) {
      toast.error('Durum sorgulanamadı: ' + (err.response?.data?.error || err.message));
    } finally { setTrackingLoading(false); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Hepsiburada — Yeni Ürün Listele</h1></div>
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

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Hepsiburada — Yeni Ürün Listele</h1>
          <p>Ürünleri Hepsiburada kataloguna yeni listeleme olarak gönderin</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {connections.length > 1 && (
            <select className="form-select" style={{ width: 200 }} value={selectedConn?.id || ''}
              onChange={e => { setSelectedConn(connections.find(c => c.id === e.target.value)); setSelectedIds(new Set()); }}>
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
            </select>
          )}
          <button className="btn btn-primary" onClick={handleCreate} disabled={sending || selectedIds.size === 0}>
            {sending ? <><RefreshCw size={16} className="spinning" /> Gönderiliyor...</> : <><Send size={16} /> {selectedIds.size} Ürünü Listele</>}
          </button>
        </div>
      </div>

      {/* Info box */}
      <div style={{ background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <AlertCircle size={16} style={{ color: '#ff6000', flexShrink: 0, marginTop: 1 }} />
        <span>Bu sayfa <strong>yeni ürün</strong> listelemeleri oluşturur. Her ürünün barkodu, markası ve <a href="/hepsiburada-mapping" style={{ color: '#ff6000' }}>kategori eşlemesi</a> olması gerekir.</span>
      </div>

      {/* Stats */}
      <div className="grid grid-3" style={{ marginBottom: 16, gap: 12 }}>
        <div className="card" style={{ padding: 16, cursor: 'pointer', border: filterStatus === 'all' ? '2px solid var(--accent-primary)' : undefined }} onClick={() => setFilterStatus('all')}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Toplam</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{pagination.total}</div>
        </div>
        <div className="card" style={{ padding: 16, cursor: 'pointer', border: filterStatus === 'ready' ? '2px solid var(--success)' : undefined }} onClick={() => setFilterStatus('ready')}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Gönderilebilir</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{readyCount}</div>
        </div>
        <div className="card" style={{ padding: 16, cursor: 'pointer', border: filterStatus === 'missing' ? '2px solid var(--warning)' : undefined }} onClick={() => setFilterStatus('missing')}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Eksik Bilgi</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--warning)' }}>{missingCount}</div>
        </div>
      </div>

      {/* Min stock + send result */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <label style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Min. Stok Tamponu:</label>
          <input type="number" min={0} className="form-input" style={{ width: 80 }} value={minStock}
            onChange={e => setMinStock(Math.max(0, parseInt(e.target.value) || 0))} />
        </div>

        {trackingId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', borderRadius: 6, fontSize: 12 }}>
            <ExternalLink size={13} style={{ color: '#ff6000' }} />
            <span>Takip ID: <strong>{trackingId}</strong></span>
            <button className="btn btn-secondary btn-sm" onClick={checkTracking} disabled={trackingLoading}>
              {trackingLoading ? <RefreshCw size={12} className="spinning" /> : 'Durumu Sorgula'}
            </button>
          </div>
        )}
      </div>

      {/* Send result */}
      {sendResult && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: sendResult.skipped?.length ? 12 : 0 }}>
            <span style={{ color: 'var(--success)', fontWeight: 600 }}><CheckCircle size={14} style={{ marginRight: 4 }} />{sendResult.sent} Gönderildi</span>
            {sendResult.skipped?.length > 0 && <span style={{ color: 'var(--warning)', fontWeight: 600 }}><AlertCircle size={14} style={{ marginRight: 4 }} />{sendResult.skipped.length} Atlandı</span>}
          </div>
          {sendResult.skipped?.map((s, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '3px 0', borderBottom: '1px solid var(--border-color)' }}>
              ID: {s.id} — {s.reason}
            </div>
          ))}
          {trackingResult && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 12 }}>
              <strong>API Yanıtı:</strong>
              <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--text-secondary)' }}>
                {JSON.stringify(trackingResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Search + toggle all */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button type="button" onClick={toggleAll}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
            {filteredProducts.filter(p => getProductStatus(p) === 'ready').every(p => selectedIds.has(p.id)) && filteredProducts.some(p => getProductStatus(p) === 'ready')
              ? <CheckSquare size={16} /> : <Square size={16} />}
            Hazırları Seç
          </button>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
            <input className="form-input" style={{ paddingLeft: 32 }} placeholder="Ürün ara..."
              value={search} onChange={e => { setSearch(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} />
          </div>
        </div>
      </div>

      {/* Product table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
              <th style={{ width: 40, padding: '10px 12px' }}></th>
              <th style={{ padding: '10px 12px', textAlign: 'left' }}>Ürün</th>
              <th style={{ padding: '10px 12px', textAlign: 'left' }}>Kategori</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Fiyat</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Stok</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Durum</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map(p => {
              const status = getProductStatus(p);
              const isReady = status === 'ready';
              const reasons = isReady ? [] : getMissingReasons(p);
              return (
                <tr
                  key={p.id}
                  onClick={() => { if (isReady) toggleSelect(p.id); }}
                  style={{ borderBottom: '1px solid var(--border-color)', cursor: isReady ? 'pointer' : 'default', background: selectedIds.has(p.id) ? 'rgba(255,96,0,0.06)' : 'transparent', opacity: isReady ? 1 : 0.65 }}
                >
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {isReady
                      ? selectedIds.has(p.id) ? <CheckSquare size={16} style={{ color: '#ff6000' }} /> : <Square size={16} style={{ color: 'var(--text-muted)' }} />
                      : <Square size={16} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 500 }}>{p.title || p.name || 'İsimsiz'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {p.sku ? `SKU: ${p.sku}` : ''}{p.barcode ? ` | Barkod: ${p.barcode}` : ''}{p.brand ? ` | ${p.brand}` : ''}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12 }}>
                    {p.category ? (
                      mappedLookup[p.category?.toLowerCase().trim()]
                        ? <span style={{ color: '#ff6000' }}>{mappedLookup[p.category?.toLowerCase().trim()].marketplaceCategoryName || p.category}</span>
                        : <span style={{ color: 'var(--warning)' }}>{p.category}</span>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {p.price ? `${Number(p.price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.stock ?? '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {isReady
                      ? <span style={{ color: 'var(--success)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><CheckCircle size={12} /> Hazır</span>
                      : <span style={{ color: 'var(--warning)', fontSize: 11 }} title={reasons.join(', ')}>
                          <XCircle size={12} style={{ marginRight: 2 }} />{reasons[0]}
                        </span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredProducts.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Package size={32} style={{ marginBottom: 8 }} /><div>Ürün bulunamadı</div>
          </div>
        )}
      </div>

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
