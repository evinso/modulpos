import { useState, useEffect, useMemo } from 'react';
import { Send, Search, CheckSquare, Square, Package, RefreshCw, AlertCircle, CheckCircle, XCircle, ExternalLink, Clock, History, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

// HepsiBurada product status labels and colors (English API values)
const STATUS_MAP = {
  'WAITING':             { label: 'İncelenecek',           color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  'IN_EXTERNAL_PROGRESS':{ label: 'Katalog Sürecinde',     color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
  'PRE_MATCHED':         { label: 'Eşleşen ⚠ Onay Gerekli', color: '#ff6000', bg: 'rgba(255,96,0,0.1)' },
  'MATCHED':             { label: 'Satışa Hazır',          color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  'REJECTED':            { label: 'Reddedildi',            color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
};

function StatusBadge({ status }) {
  if (!status) return null;
  const s = STATUS_MAP[status] || { label: status, color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: s.color, background: s.bg, borderRadius: 4, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

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

  // Tracking
  const [trackingId, setTrackingId] = useState('');
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingResult, setTrackingResult] = useState(null);

  // Tracking history
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Store products (by status)
  const [storeTab, setStoreTab] = useState('');
  const [storeProducts, setStoreProducts] = useState([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({});

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

  const fetchHistory = async () => {
    if (!selectedConn) return;
    setHistoryLoading(true);
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/hepsiburada-tracking-history`);
      const items = res.data?.data || res.data?.trackingIds || res.data?.items || (Array.isArray(res.data) ? res.data : []);
      setHistory(items);
    } catch (err) {
      toast.error('Geçmiş yüklenemedi: ' + (err.response?.data?.error || err.message));
    } finally { setHistoryLoading(false); }
  };

  const fetchStoreProducts = async (status) => {
    if (!selectedConn || !status) return;
    setStoreLoading(true);
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/hepsiburada-products`, { params: { status } });
      const items = res.data?.data || res.data?.products || res.data?.items || (Array.isArray(res.data) ? res.data : []);
      setStoreProducts(items);
    } catch (err) {
      toast.error('Ürünler yüklenemedi: ' + (err.response?.data?.error || err.message));
    } finally { setStoreLoading(false); }
  };

  const handleStoreTabChange = (status) => {
    setStoreTab(status);
    setStoreProducts([]);
    if (status) fetchStoreProducts(status);
  };

  const doProductAction = async (key, fn, successMsg) => {
    setActionLoading(prev => ({ ...prev, [key]: true }));
    try {
      await fn();
      toast.success(successMsg);
      if (storeTab) fetchStoreProducts(storeTab);
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: false }));
    }
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
    return (hasCat && hasBarcode && hasPrice && hasBrand) ? 'ready' : 'missing';
  };

  const getMissingReasons = (p) => {
    const r = [];
    if (!mappedLookup[p.category?.toLowerCase().trim()]) r.push('Kategori eşlemesi yok');
    if (!p.barcode && !p.sku) r.push('Barkod/SKU eksik');
    if (!p.price || Number(p.price) <= 0) r.push('Fiyat eksik');
    if (!p.brand) r.push('Marka eksik');
    return r;
  };

  const filteredProducts = filterStatus === 'all' ? products : products.filter(p => getProductStatus(p) === filterStatus);
  const readyCount = products.filter(p => getProductStatus(p) === 'ready').length;
  const missingCount = products.filter(p => getProductStatus(p) === 'missing').length;

  const toggleSelect = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    const readyIds = filteredProducts.filter(p => getProductStatus(p) === 'ready').map(p => p.id);
    const allSelected = readyIds.length > 0 && readyIds.every(id => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(readyIds));
  };

  const handleCreate = async () => {
    if (!selectedConn || selectedIds.size === 0) return;
    setSending(true);
    setSendResult(null);
    setTrackingResult(null);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/hepsiburada-create`, {
        productIds: Array.from(selectedIds),
        minStock,
      });
      setSendResult(res.data);
      if (res.data.trackingId) setTrackingId(res.data.trackingId);
      toast.success(res.data.sent > 0 ? `${res.data.sent} ürün gönderildi` : 'Hiçbir ürün gönderilemedi');
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(err.response?.data?.error || 'Gönderme hatası');
    } finally { setSending(false); }
  };

  const checkTracking = async () => {
    if (!trackingId?.trim() || !selectedConn) return;
    setTrackingLoading(true);
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/hepsiburada-import-status/${trackingId.trim()}`);
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
        <div className="card"><div className="empty-state"><Package size={48} className="empty-icon" /><h3>Hepsiburada bağlantısı bulunamadı</h3></div></div>
      </div>
    );
  }

  // Normalize tracking result items
  const trackingItems = trackingResult
    ? (trackingResult.data || trackingResult.items || trackingResult.products || (Array.isArray(trackingResult) ? trackingResult : []))
    : [];

  const STORE_STATUSES = ['WAITING', 'IN_EXTERNAL_PROGRESS', 'PRE_MATCHED', 'MATCHED', 'REJECTED'];

  return (
    <div>
      {/* Header */}
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Hepsiburada — Yeni Ürün Listele</h1>
          <p>Ürünleri Hepsiburada kataloguna yeni listeleme olarak gönderin</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {connections.length > 1 && (
            <select className="form-select" style={{ width: 200 }} value={selectedConn?.id || ''}
              onChange={e => setSelectedConn(connections.find(c => c.id === e.target.value))}>
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
            </select>
          )}
          <button className="btn btn-primary" onClick={handleCreate} disabled={sending || selectedIds.size === 0}>
            {sending ? <><RefreshCw size={16} className="spinning" /> Gönderiliyor...</> : <><Send size={16} /> {selectedIds.size} Ürünü Listele</>}
          </button>
        </div>
      </div>

      {/* Info */}
      <div style={{ background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
        <AlertCircle size={15} style={{ color: '#ff6000', flexShrink: 0, marginTop: 1 }} />
        <span>Her ürünün barkodu, markası ve <a href="/hepsiburada-mapping" style={{ color: '#ff6000' }}>kategori eşlemesi</a> olması gerekir. MerchantSku otomatik büyük harfe çevrilir.</span>
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

      {/* Min stock + tracking */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <label style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Min. Stok Tamponu:</label>
          <input type="number" min={0} className="form-input" style={{ width: 80 }} value={minStock}
            onChange={e => setMinStock(Math.max(0, parseInt(e.target.value) || 0))} />
        </div>

        {/* Tracking sorgu alanı */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 280 }}>
          <input className="form-input" placeholder="Takip ID girin..." value={trackingId}
            onChange={e => setTrackingId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && checkTracking()}
            style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={checkTracking} disabled={trackingLoading || !trackingId.trim()}>
            {trackingLoading ? <RefreshCw size={14} className="spinning" /> : <ExternalLink size={14} />}
            {trackingLoading ? ' Sorgulanıyor...' : ' Sorgula'}
          </button>
          <button className="btn btn-secondary" onClick={() => { setHistoryOpen(o => !o); if (!historyOpen) fetchHistory(); }} title="Takip Geçmişi">
            <History size={14} />
            {historyOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Tracking history panel */}
      {historyOpen && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>Takip Geçmişi</div>
          {historyLoading ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Yükleniyor...</div>
            : history.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Geçmiş bulunamadı</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {history.map((item, i) => {
                  const tid = item.trackingId || item.id || item;
                  const date = item.createdDate || item.createdAt || '';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
                      <Clock size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{tid}</span>
                      {date && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{new Date(date).toLocaleString('tr-TR')}</span>}
                      <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 11 }}
                        onClick={() => { setTrackingId(String(tid)); setHistoryOpen(false); }}>
                        Seç
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      )}

      {/* Send result */}
      {sendResult && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: sendResult.skipped?.length ? 10 : 0 }}>
            <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 13 }}><CheckCircle size={14} style={{ marginRight: 4 }} />{sendResult.sent} Gönderildi</span>
            {sendResult.skipped?.length > 0 && <span style={{ color: 'var(--warning)', fontWeight: 600, fontSize: 13 }}><AlertCircle size={14} style={{ marginRight: 4 }} />{sendResult.skipped.length} Atlandı</span>}
            {sendResult.trackingId && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Takip ID: <strong>{sendResult.trackingId}</strong></span>}
          </div>
          {sendResult.skipped?.map((s, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--warning)', padding: '2px 0' }}>ID {s.id}: {s.reason}</div>
          ))}
        </div>
      )}

      {/* Tracking result */}
      {trackingResult && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ExternalLink size={14} style={{ color: '#ff6000' }} />
            Sorgulama Sonucu
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>Takip ID: {trackingId}</span>
          </div>
          {trackingItems.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {trackingItems.map((item, i) => {
                const status = item.productStatus || item.status || item.importStatus || '';
                const name = item.productName || item.merchantSku || item.sku || `Ürün ${i + 1}`;
                const errors = item.validationResults || item.errors || [];
                return (
                  <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: errors.length ? 6 : 0 }}>
                      <span style={{ flex: 1, fontWeight: 500 }}>{name}</span>
                      <StatusBadge status={status} />
                    </div>
                    {errors.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--warning)' }}>
                        {(Array.isArray(errors) ? errors : [errors]).map((e, j) => (
                          <div key={j}>{typeof e === 'string' ? e : (e.message || JSON.stringify(e))}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <pre style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', margin: 0 }}>
              {JSON.stringify(trackingResult, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Store products by status */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>Hepsiburada'daki Ürünlerim</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: storeTab ? 12 : 0 }}>
          {STORE_STATUSES.map(s => {
            const info = STATUS_MAP[s] || {};
            return (
              <button key={s} onClick={() => handleStoreTabChange(storeTab === s ? '' : s)}
                style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${storeTab === s ? info.color || '#ff6000' : 'var(--border-color)'}`,
                  background: storeTab === s ? (info.bg || 'rgba(255,96,0,0.1)') : 'transparent',
                  color: storeTab === s ? (info.color || '#ff6000') : 'var(--text-secondary)' }}>
                {info.label || s}
              </button>
            );
          })}
        </div>

        {storeTab && (
          storeLoading ? <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>Yükleniyor...</div>
          : storeProducts.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>Bu durumda ürün bulunmuyor</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {storeProducts.map((p, i) => {
                const pid = p.id || p.productId || i;
                const name = p.productName || p.name || p.merchantSku || `Ürün ${i + 1}`;
                const status = p.productStatus || p.status || storeTab;
                const isPrematch = status === 'PRE_MATCHED';
                const msku = p.merchantSku || p.merchantSKU || '';
                return (
                  <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 13 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{name}</div>
                      {msku && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{msku}</div>}
                    </div>
                    <StatusBadge status={status} />
                    {isPrematch && msku && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm"
                          style={{ fontSize: 11, color: 'var(--success)', borderColor: 'var(--success)', padding: '3px 10px' }}
                          disabled={!!actionLoading[`approve_${msku}`]}
                          onClick={() => doProductAction(`approve_${msku}`,
                            () => api.post(`/marketplace/connections/${selectedConn.id}/hepsiburada-approve-prematch`, { merchantSkuList: [msku] }),
                            'Ürün onaylandı')}>
                          <ThumbsUp size={12} /> {actionLoading[`approve_${msku}`] ? '...' : 'Onayla'}
                        </button>
                        <button className="btn btn-secondary btn-sm"
                          style={{ fontSize: 11, color: '#ef4444', borderColor: '#ef4444', padding: '3px 10px' }}
                          disabled={!!actionLoading[`reject_${msku}`]}
                          onClick={() => doProductAction(`reject_${msku}`,
                            () => api.post(`/marketplace/connections/${selectedConn.id}/hepsiburada-reject-prematch`, { merchantSkuList: [msku] }),
                            'Ürün reddedildi')}>
                          <ThumbsDown size={12} /> {actionLoading[`reject_${msku}`] ? '...' : 'Reddet'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

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
                <tr key={p.id} onClick={() => { if (isReady) toggleSelect(p.id); }}
                  style={{ borderBottom: '1px solid var(--border-color)', cursor: isReady ? 'pointer' : 'default', background: selectedIds.has(p.id) ? 'rgba(255,96,0,0.06)' : 'transparent', opacity: isReady ? 1 : 0.65 }}>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {isReady
                      ? selectedIds.has(p.id) ? <CheckSquare size={16} style={{ color: '#ff6000' }} /> : <Square size={16} style={{ color: 'var(--text-muted)' }} />
                      : <Square size={16} style={{ opacity: 0.3 }} />}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 500 }}>{p.title || p.name || 'İsimsiz'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {p.sku ? `SKU: ${p.sku.toUpperCase()}` : ''}{p.barcode ? ` | Barkod: ${p.barcode}` : ''}{p.brand ? ` | ${p.brand}` : ''}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12 }}>
                    {p.category
                      ? mappedLookup[p.category?.toLowerCase().trim()]
                        ? <span style={{ color: '#ff6000' }}>{mappedLookup[p.category?.toLowerCase().trim()].marketplaceCategoryName || p.category}</span>
                        : <span style={{ color: 'var(--warning)' }}>{p.category}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {p.price ? `${Number(p.price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.stock ?? '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {isReady
                      ? <span style={{ color: 'var(--success)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><CheckCircle size={12} /> Hazır</span>
                      : <span style={{ color: 'var(--warning)', fontSize: 11 }} title={reasons.join(', ')}><XCircle size={12} style={{ marginRight: 2 }} />{reasons[0]}</span>}
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
