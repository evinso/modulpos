import { useState, useEffect, useMemo } from 'react';
import { Send, Search, CheckSquare, Square, RefreshCw, X, Check, Clock, Ban, ArrowLeftRight, Package } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import LoadingOverlay from '../../components/LoadingOverlay';

const MP_STATUS = {
  active:   { label: 'Aktif',      color: 'var(--success)', bg: 'rgba(16,185,129,0.1)', icon: <Check size={11} /> },
  pending:  { label: 'Bekliyor',   color: 'var(--warning)', bg: 'rgba(245,158,11,0.1)', icon: <Clock size={11} /> },
  rejected: { label: 'Reddedildi', color: 'var(--danger)',  bg: 'rgba(239,68,68,0.1)',  icon: <X size={11} /> },
  passive:  { label: 'Kaldırıldı', color: '#f97316',        bg: 'rgba(249,115,22,0.1)', icon: <Ban size={11} /> },
};

export default function PazaramaSendPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showModal, setShowModal] = useState(null); // 'send' | 'sync'
  const [minStock, setMinStock] = useState(0);
  const [pricingRuleId, setPricingRuleId] = useState('');
  const [pricingRules, setPricingRules] = useState([]);
  const [filterMpStatus, setFilterMpStatus] = useState('all');
  const [xmlSources, setXmlSources] = useState([]);
  const [filterXmlSource, setFilterXmlSource] = useState('');
  const [sendResult, setSendResult] = useState(null);

  useEffect(() => { fetchConnections(); fetchPricingRules(); fetchXmlSources(); }, []);
  useEffect(() => { if (selectedConn) fetchProducts(); }, [selectedConn, pagination.page, search, filterXmlSource]);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const pz = res.data.filter(c => c.marketplaceType === 'pazarama');
      setConnections(pz);
      if (pz.length > 0) setSelectedConn(pz[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const fetchPricingRules = async () => {
    try { const res = await api.get('/pricing'); setPricingRules(res.data.filter(r => r.isActive)); } catch {}
  };

  const fetchXmlSources = async () => {
    try { const res = await api.get('/xml-sources'); setXmlSources(res.data); } catch {}
  };

  const fetchProducts = async () => {
    try {
      const params = { page: pagination.page, limit: 20, search };
      if (filterXmlSource) params.xmlSourceId = filterXmlSource;
      const res = await api.get('/products', { params });
      // enrich with MP data
      const mps = await api.get('/products/marketplace-status', { params: { connectionId: selectedConn.id } }).catch(() => ({ data: [] }));
      const mpMap = {};
      (mps.data || []).forEach(m => mpMap[m.productId] = m);
      setProducts((res.data.products || []).map(p => ({ ...p, mpData: mpMap[p.id] || null })));
      setPagination(prev => ({ ...prev, total: res.data.pagination?.total || 0, totalPages: res.data.pagination?.totalPages || 1 }));
    } catch { toast.error('Ürünler yüklenemedi'); }
  };

  const filteredProducts = useMemo(() => {
    if (filterMpStatus === 'all') return products;
    if (filterMpStatus === 'not_sent') return products.filter(p => !p.mpData);
    return products.filter(p => p.mpData?.status === filterMpStatus);
  }, [products, filterMpStatus]);

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (selectedIds.size === filteredProducts.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredProducts.map(p => p.id)));
  };

  const handleSend = async () => {
    setSending(true);
    setShowModal(null);
    try {
      const ids = selectedIds.size > 0 ? [...selectedIds] : filteredProducts.map(p => p.id);
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/pazarama-send`, {
        productIds: ids, minStock: parseInt(minStock) || 0, pricingRuleId: pricingRuleId || undefined,
      });
      setSendResult(res.data);
      toast.success(`${res.data.sent} ürün Pazarama'ya gönderildi`);
      setSelectedIds(new Set());
      fetchProducts();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Gönderim başarısız');
    } finally { setSending(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    setShowModal(null);
    try {
      const ids = selectedIds.size > 0 ? [...selectedIds] : [];
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/pazarama-sync`, {
        productIds: ids.length ? ids : undefined, pricingRuleId: pricingRuleId || undefined,
      });
      toast.success(`${res.data.updated} ürün güncellendi`);
      setSelectedIds(new Set());
      fetchProducts();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Güncelleme başarısız');
    } finally { setSyncing(false); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  if (connections.length === 0) return (
    <div className="page-title">
      <h1>Pazarama — Ürün Gönder / Güncelle</h1>
      <div className="card" style={{ marginTop: 24, padding: 40, textAlign: 'center' }}>
        <Package size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
        <h3>Pazarama bağlantısı bulunamadı</h3>
        <p style={{ color: 'var(--text-muted)' }}>Pazaryerlerim sayfasından Pazarama hesabınızı ekleyin.</p>
      </div>
    </div>
  );

  return (
    <div>
      {(sending || syncing) && <LoadingOverlay message={sending ? 'Pazarama\'ya gönderiliyor...' : 'Fiyat/Stok güncelleniyor...'} />}

      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Pazarama — Ürün Gönder / Güncelle</h1>
          <p>{pagination.total} ürün · {selectedIds.size > 0 ? `${selectedIds.size} seçili` : 'Tümü'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {connections.length > 1 && (
            <select className="form-select" style={{ width: 'auto' }} value={selectedConn?.id} onChange={e => setSelectedConn(connections.find(c => c.id === e.target.value))}>
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.id}</option>)}
            </select>
          )}
          <button className="btn btn-secondary" onClick={() => setShowModal('sync')} disabled={syncing}>
            <ArrowLeftRight size={15} /> Fiyat/Stok Güncelle
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal('send')} disabled={sending}>
            <Send size={15} /> Pazarama'ya Gönder
          </button>
        </div>
      </div>

      {sendResult && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 16, background: 'rgba(16,185,129,0.08)', borderLeft: '3px solid var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
            ✓ {sendResult.sent} ürün gönderildi {sendResult.batchRequestId ? `· Batch ID: ${sendResult.batchRequestId}` : ''}
          </span>
          <button onClick={() => setSendResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={14} /></button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" style={{ paddingLeft: 32 }} placeholder="Ürün ara..." value={search}
            onChange={e => { setSearch(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} />
        </div>
        <select className="form-select" style={{ width: 160 }} value={filterMpStatus} onChange={e => setFilterMpStatus(e.target.value)}>
          <option value="all">Tüm Durum</option>
          <option value="not_sent">Gönderilmemiş</option>
          <option value="active">Aktif</option>
          <option value="pending">Bekliyor</option>
          <option value="rejected">Reddedildi</option>
        </select>
        {xmlSources.length > 0 && (
          <select className="form-select" style={{ width: 160 }} value={filterXmlSource} onChange={e => setFilterXmlSource(e.target.value)}>
            <option value="">Tüm XML</option>
            {xmlSources.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
      </div>

      {/* Product Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', width: 40 }}>
                <button onClick={toggleAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                  {selectedIds.size === filteredProducts.length && filteredProducts.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>
              </th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Ürün</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Barkod</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}>Stok</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}>Fiyat</th>
              <th style={{ padding: '10px 14px', textAlign: 'center' }}>Pazarama</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Ürün bulunamadı</td></tr>
            ) : filteredProducts.map(p => {
              const st = p.mpData?.status;
              const mpInfo = st ? MP_STATUS[st] : null;
              return (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)', background: selectedIds.has(p.id) ? 'rgba(99,102,241,0.04)' : 'transparent', cursor: 'pointer' }}
                  onClick={() => toggleSelect(p.id)}>
                  <td style={{ padding: '10px 14px' }}>
                    <button onClick={e => { e.stopPropagation(); toggleSelect(p.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: selectedIds.has(p.id) ? 'var(--accent-primary)' : 'var(--text-muted)', display: 'flex' }}>
                      {selectedIds.has(p.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />}
                      <div style={{ fontWeight: 500, lineHeight: 1.3 }}>{p.name}</div>
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{p.barcode || p.sku || '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>{p.stock ?? '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>{p.price ? `${parseFloat(p.price).toFixed(2)}₺` : '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    {mpInfo ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: mpInfo.bg, color: mpInfo.color }}>
                        {mpInfo.icon} {mpInfo.label}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {pagination.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 16, borderTop: '1px solid var(--border-color)' }}>
            <button className="btn btn-secondary btn-sm" disabled={pagination.page === 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>‹</button>
            <span style={{ lineHeight: '32px', fontSize: 13, color: 'var(--text-muted)' }}>{pagination.page} / {pagination.totalPages}</span>
            <button className="btn btn-secondary btn-sm" disabled={pagination.page === pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>›</button>
          </div>
        )}
      </div>

      {/* Send Modal */}
      {showModal === 'send' && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Pazarama'ya Gönder</h3>
              <button onClick={() => setShowModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                {selectedIds.size > 0 ? <><strong>{selectedIds.size}</strong> seçili ürün</> : <><strong>{filteredProducts.length}</strong> ürünün tamamı</>} Pazarama'ya gönderilecek.
              </p>
              <div>
                <label className="form-label">Min. Stok Eşiği</label>
                <input type="number" className="form-input" value={minStock} onChange={e => setMinStock(e.target.value)} min={0} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Bu değerin altında stoklu ürünler atlanır</div>
              </div>
              <div>
                <label className="form-label">Fiyatlandırma Kuralı</label>
                <select className="form-select" value={pricingRuleId} onChange={e => setPricingRuleId(e.target.value)}>
                  <option value="">Kural yok (XML fiyatı)</option>
                  {pricingRules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={() => setShowModal(null)}>İptal</button>
                <button className="btn btn-primary" onClick={handleSend}>
                  <Send size={14} /> Gönder
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sync Modal */}
      {showModal === 'sync' && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Fiyat / Stok Güncelle</h3>
              <button onClick={() => setShowModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                {selectedIds.size > 0 ? <><strong>{selectedIds.size}</strong> seçili ürünün</> : <>Pazarama'ya gönderilmiş <strong>tüm ürünlerin</ strong></>} fiyat ve stoğu güncellenir.
              </p>
              <div>
                <label className="form-label">Fiyatlandırma Kuralı</label>
                <select className="form-select" value={pricingRuleId} onChange={e => setPricingRuleId(e.target.value)}>
                  <option value="">Kural yok (XML fiyatı)</option>
                  {pricingRules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={() => setShowModal(null)}>İptal</button>
                <button className="btn btn-primary" onClick={handleSync}>
                  <RefreshCw size={14} /> Güncelle
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
