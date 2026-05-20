import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Search, Trash2, Edit, Package, CheckSquare, Square,
  TrendingUp, TrendingDown, Layers,
  X, AlertTriangle, ChevronDown, FileCode2, Eye, RefreshCw,
  History, Sparkles, ArrowUp, ArrowDown
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const BULK_ACTIONS = [
  { group: 'Pazaryeri', icon: <Package size={15} />, actions: [
    { key: 'sync_marketplaces', label: 'Trendyol Fiyat/Stok Güncelle', color: 'var(--accent-primary)', needsValue: false },
  ]},
];

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [form, setForm] = useState({ sku: '', title: '', price: '', stock: '', brand: '', category: '', barcode: '', description: '' });
  const [activeTab, setActiveTab] = useState('modified'); // 'xml' or 'modified'
  const [detailProduct, setDetailProduct] = useState(null);

  // Bulk ops state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [syncingStatus, setSyncingStatus] = useState(false);
  const [syncResult, setSyncResult] = useState(null); // log modal data
  const [openGroup, setOpenGroup] = useState(null);
  const [selectAllMode, setSelectAllMode] = useState(false); // true = all products selected (across pages)
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [productLogs, setProductLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  
  // Filters
  const [filterXmlSource, setFilterXmlSource] = useState('');
  const [filterConnection, setFilterConnection] = useState('');
  const [filterMarketplaceStatus, setFilterMarketplaceStatus] = useState('');
  const [xmlSources, setXmlSources] = useState([]);
  const [connections, setConnections] = useState([]);
  const [pricingRules, setPricingRules] = useState([]);
  const [mpStats, setMpStats] = useState(null);
  const [trendyolProducts, setTrendyolProducts] = useState([]);
  const [trendyolLoading, setTrendyolLoading] = useState(false);
  const [trendyolPagination, setTrendyolPagination] = useState({ page: 0, total: 0, totalPages: 1 });

  useEffect(() => {
    fetchOptions();
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [pagination.page, search, filterXmlSource, filterConnection, filterMarketplaceStatus]);

  useEffect(() => {
    if (filterConnection) fetchMpStats();
    else setMpStats(null);
  }, [filterConnection, filterXmlSource]);

  // Trendyol sekme seçilince Trendyol'dan çek
  const isTrendyolTab = filterConnection && filterMarketplaceStatus && filterMarketplaceStatus !== 'not_sent';
  useEffect(() => {
    const conn = connections.find(c => c.id === filterConnection);
    if (isTrendyolTab && conn?.marketplaceType === 'trendyol') {
      fetchTrendyolProducts(0);
    } else {
      setTrendyolProducts([]);
    }
  }, [filterConnection, filterMarketplaceStatus, connections]);

  const fetchOptions = async () => {
    try {
      const [xmlRes, connRes, pricingRes] = await Promise.all([
        api.get('/xml-sources'),
        api.get('/marketplace/connections'),
        api.get('/pricing')
      ]);
      setXmlSources(xmlRes.data);
      setConnections(connRes.data);
      setPricingRules(pricingRes.data);
    } catch (err) {
      console.error('Filtre seçenekleri yüklenemedi');
    }
  };

  const fetchMpStats = async () => {
    try {
      const params = { connectionId: filterConnection };
      if (filterXmlSource) params.xmlSourceId = filterXmlSource;
      const res = await api.get('/products/stats', { params });
      setMpStats(res.data);
    } catch {}
  };

  const fetchTrendyolProducts = async (page = 0) => {
    setTrendyolLoading(true);
    try {
      const res = await api.get(`/marketplace/connections/${filterConnection}/trendyol-products`, {
        params: { status: filterMarketplaceStatus, page, size: 50 }
      });
      const data = res.data;
      setTrendyolProducts(data.content || []);
      setTrendyolPagination({
        page,
        total: data.totalElements || 0,
        totalPages: data.totalPages || 1,
      });
    } catch { toast.error('Trendyol ürünleri yüklenemedi'); }
    finally { setTrendyolLoading(false); }
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const params = { page: pagination.page, search };
      if (filterXmlSource) params.xmlSourceId = filterXmlSource;
      if (filterConnection) params.connectionId = filterConnection;
      if (filterMarketplaceStatus && filterMarketplaceStatus !== 'not_sent') params.marketplaceStatus = filterMarketplaceStatus;
      // "Gönderilmemiş": connectionId ile eşleşen MP kaydı olmayan ürünler
      if (filterMarketplaceStatus === 'not_sent') { delete params.connectionId; params.notSentConnectionId = filterConnection; }
      
      const res = await api.get('/products', { params });
      setProducts(res.data.products);
      setPagination(res.data.pagination);
    } catch { toast.error('Ürünler yüklenemedi'); }
    finally { setLoading(false); }
  };

  const priceRangeRules = useMemo(() =>
    pricingRules.filter(r => r.isActive && r.applyTo === 'price_range' && r.conditions),
  [pricingRules]);

  const pricingLookup = useCallback((connectionId) => {
    const lookup = {};
    for (const r of pricingRules) {
      if (!r.conditions || !r.isActive || r.applyTo === 'price_range') continue;
      try {
        const conds = JSON.parse(r.conditions);
        if (conds.xmlSourceId && (!connectionId || conds.connectionId === connectionId)) {
          if (!lookup[conds.xmlSourceId]) lookup[conds.xmlSourceId] = r;
        }
      } catch(e) {}
    }
    return lookup;
  }, [pricingRules]);

  const getMarketplacePrice = useCallback((p, connectionId) => {
    const lookup = pricingLookup(connectionId);
    const rule = lookup[p.xmlSourceId];
    if (rule) {
      let finalPrice = p.price;
      if (rule.type === 'percentage') finalPrice = finalPrice * (1 + rule.value / 100);
      if (rule.type === 'fixed') finalPrice = finalPrice + rule.value;
      return Math.round(Math.max(0, finalPrice) * 100) / 100;
    }
    // Price range rule: use xmlPrice as purchase price
    const xmlPrice = p.xmlPrice || p.price;
    if (!xmlPrice || xmlPrice <= 0) return null;
    for (const r of priceRangeRules) {
      try {
        const c = JSON.parse(r.conditions);
        if (c.connectionId && connectionId && c.connectionId !== connectionId) continue;
        if (c.xmlSourceId && c.xmlSourceId !== p.xmlSourceId) continue;
        const min = c.minPurchasePrice ?? null;
        const max = c.maxPurchasePrice ?? null;
        if (min === null && max === null) continue;
        if (min !== null && xmlPrice < min) continue;
        if (max !== null && xmlPrice > max) continue;
        const shipping = parseFloat(c.shippingCost) || 0;
        const commission = parseFloat(c.commissionPct) || 0;
        const vat = parseFloat(c.vatRate) || 0;
        const totalCost = xmlPrice + shipping;
        const profitTarget = xmlPrice * (r.value / 100);
        const factor = commission > 0 ? 1 - commission / 100 : 1;
        return Math.round(Math.max(0, (totalCost + profitTarget) / factor * (1 + vat / 100)) * 100) / 100;
      } catch(e) {}
    }
    return null;
  }, [pricingLookup, priceRangeRules]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const data = { ...form, price: parseFloat(form.price) || 0, stock: parseInt(form.stock) || 0 };
      if (editProduct) {
        await api.put(`/products/${editProduct.id}`, data);
        toast.success('Ürün güncellendi');
      } else {
        await api.post('/products', data);
        toast.success('Ürün eklendi');
      }
      setShowModal(false);
      setEditProduct(null);
      setForm({ sku: '', title: '', price: '', stock: '', brand: '', category: '', barcode: '', description: '' });
      fetchProducts();
    } catch (err) { toast.error(err.response?.data?.error || 'Hata oluştu'); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const id = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await api.delete(`/products/${id}`);
      toast.success('Ürün silindi');
      fetchProducts();
    } catch { toast.error('Silme hatası'); }
  };

  const openHistory = async (p) => {
    setHistoryProduct(p);
    setProductLogs([]);
    setLogsLoading(true);
    try {
      const res = await api.get(`/products/${p.id}/logs`);
      setProductLogs(res.data);
    } catch { toast.error('Geçmiş yüklenemedi'); }
    finally { setLogsLoading(false); }
  };

  const openEdit = (p) => {
    setEditProduct(p);
    setForm({ sku: p.sku, title: p.title, price: p.price, stock: p.stock, brand: p.brand || '', category: p.category || '', barcode: p.barcode || '', description: p.description || '' });
    setShowModal(true);
  };

  // Selection helpers
  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSelectAllMode(false);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
      setSelectAllMode(false);
    } else {
      setSelectedIds(new Set(products.map(p => p.id)));
    }
  }, [products, selectedIds.size]);

  const selectAllProducts = async () => {
    try {
      const res = await api.get('/products/ids', { params: { search: search || undefined } });
      setSelectedIds(new Set(res.data.ids));
      setSelectAllMode(true);
    } catch { toast.error('Tüm ürünler yüklenemedi'); }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectAllMode(false);
    setShowBulkPanel(false);
    setBulkAction('');
    setBulkValue('');
    setOpenGroup(null);
  };

  // Find the action config
  const getActionConfig = (key) => {
    for (const g of BULK_ACTIONS) {
      const a = g.actions.find(a => a.key === key);
      if (a) return a;
    }
    return null;
  };

  const executeBulkAction = async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    const cfg = getActionConfig(bulkAction);
    if (cfg?.needsValue && !bulkValue.trim()) {
      toast.error('Lütfen bir değer girin');
      return;
    }
    setBulkLoading(true);
    try {
      const res = await api.post('/products/bulk-action', {
        action: bulkAction,
        productIds: Array.from(selectedIds),
        value: bulkValue || undefined
      });
      toast.success(res.data.message);
      clearSelection();
      setShowConfirm(false);
      fetchProducts();
    } catch (err) {
      toast.error(err.response?.data?.error || 'İşlem başarısız');
    } finally {
      setBulkLoading(false);
    }
  };

  const syncMarketplaceStatus = async () => {
    setSyncingStatus(true);
    try {
      const connsRes = await api.get('/marketplace/connections');
      const trendyolConns = connsRes.data.filter(c => c.marketplaceType === 'trendyol');

      const aggregate = { updated: 0, activated: 0, rejected: 0, discovered: 0, batchChecked: 0, fallbackChecked: 0, errors: [], connections: [] };

      for (const conn of trendyolConns) {
        const res = await api.post(`/marketplace/connections/${conn.id}/sync-status`);
        const d = res.data;
        aggregate.updated    += d.updated    || 0;
        aggregate.activated  += d.activated  || 0;
        aggregate.rejected   += d.rejected   || 0;
        aggregate.discovered += d.discovered || 0;
        aggregate.batchChecked   += d.batchChecked   || 0;
        aggregate.fallbackChecked += d.fallbackChecked || 0;
        aggregate.errors.push(...(d.errors || []));
        aggregate.connections.push({ name: conn.supplierName || conn.marketplaceType, ...d });
      }

      aggregate.passived = aggregate.connections.reduce((s, c) => s + (c.passived || 0), 0);
      aggregate.syncedAt = new Date().toLocaleString('tr-TR');
      setSyncResult(aggregate);
      fetchProducts();
    } catch (err) {
      toast.error('Durumlar sorgulanırken hata oluştu');
    } finally {
      setSyncingStatus(false);
    }
  };

  const handleBulkSubmit = () => {
    const cfg = getActionConfig(bulkAction);
    if (cfg?.dangerous) {
      setShowConfirm(true);
    } else {
      executeBulkAction();
    }
  };

  const allSelected = products.length > 0 && selectedIds.size === products.length;
  const someSelected = selectedIds.size > 0;

  const getFirstImage = (p) => {
    if (p.images) {
      try {
        const imgs = JSON.parse(p.images);
        if (Array.isArray(imgs) && imgs[0]) return imgs[0];
        if (typeof imgs === 'string' && imgs.startsWith('http')) return imgs;
      } catch {
        if (typeof p.images === 'string' && p.images.startsWith('http')) return p.images;
      }
    }
    if (p.rawXmlData) {
      try {
        const raw = JSON.parse(p.rawXmlData);
        if (Array.isArray(raw.images) && raw.images[0]) return raw.images[0];
        if (typeof raw.images === 'string' && raw.images.startsWith('http')) return raw.images;
      } catch {}
    }
    return null;
  };

  const ProductThumb = ({ p, title }) => {
    const img = getFirstImage(p);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 6, flexShrink: 0,
          background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
        }}>
          {img ? (
            <>
              <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                referrerPolicy="no-referrer"
                onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }} />
              <div style={{ display: 'none', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                <Package size={15} color="var(--text-muted)" />
              </div>
            </>
          ) : (
            <Package size={15} color="var(--text-muted)" />
          )}
        </div>
        <span style={{ fontWeight: 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
      </div>
    );
  };

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>Ürün Yönetimi</h1><p>XML verileri ve düzenlenmiş ürünlerinizi karşılaştırın</p></div>
        <div style={{ display: 'flex', gap: 10 }}>
          {products.length > 0 && (
            <button
              className={`btn ${showBulkPanel ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setShowBulkPanel(!showBulkPanel); if (showBulkPanel) clearSelection(); }}
              style={{ position: 'relative' }}
            >
              <Layers size={16} /> Toplu İşlem
              {someSelected && (
                <span style={{
                  position: 'absolute', top: -6, right: -6,
                  background: 'var(--accent-primary)', color: '#fff',
                  fontSize: 11, fontWeight: 700, borderRadius: 10,
                  padding: '1px 7px', minWidth: 18, textAlign: 'center'
                }}>{selectedIds.size}</span>
              )}
            </button>
          )}
            <button className="btn btn-secondary" onClick={syncMarketplaceStatus} disabled={syncingStatus}>
              <RefreshCw size={16} className={syncingStatus ? 'spinning' : ''} />
              {syncingStatus ? 'Sorgulanıyor...' : 'Durumları Sorgula'}
            </button>
            <button className="btn btn-primary" onClick={() => { setEditProduct(null); setForm({ sku: '', title: '', price: '', stock: '', brand: '', category: '', barcode: '', description: '' }); setShowModal(true); }}>
              <Plus size={16} /> Yeni Ürün
            </button>
          </div>
        </div>

      {/* Bulk Operations Panel */}
      {showBulkPanel && (
        <div className="bulk-panel" style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius)', padding: 20, marginBottom: 20,
          animation: 'slideUp 0.3s ease'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                background: 'var(--accent-gradient)', borderRadius: 'var(--radius-sm)',
                padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6
              }}>
                <Layers size={16} color="#fff" />
                <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>Toplu İşlemler</span>
              </div>
              {someSelected && (
                <span className="badge badge-primary" style={{ fontSize: 13 }}>
                  {selectedIds.size} ürün seçili
                </span>
              )}
            </div>
            <button onClick={clearSelection} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>

          {!someSelected ? (
            <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-secondary)', fontSize: 14 }}>
              <CheckSquare size={20} style={{ marginBottom: 6, opacity: 0.5 }} />
              <p>İşlem yapmak için tablodan ürün seçin</p>
            </div>
          ) : (
            <div>
              {/* Action groups */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {BULK_ACTIONS.map(g => (
                  <div key={g.group} style={{ position: 'relative' }}>
                    <button
                      onClick={() => setOpenGroup(openGroup === g.group ? null : g.group)}
                      className="btn btn-secondary btn-sm"
                      style={{
                        borderColor: openGroup === g.group ? 'var(--accent-primary)' : undefined,
                        color: openGroup === g.group ? 'var(--accent-primary)' : undefined
                      }}
                    >
                      {g.icon} {g.group} <ChevronDown size={13} />
                    </button>
                    {openGroup === g.group && (
                      <div style={{
                        position: 'absolute', top: '110%', left: 0, zIndex: 50,
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)', minWidth: 200, padding: 4,
                        boxShadow: '0 8px 30px rgba(0,0,0,0.4)', animation: 'fadeIn 0.15s ease'
                      }}>
                        {g.actions.map(a => (
                          <button key={a.key} onClick={() => { setBulkAction(a.key); setBulkValue(''); setOpenGroup(null); }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              width: '100%', padding: '9px 12px', background: bulkAction === a.key ? 'rgba(59,130,246,0.1)' : 'none',
                              border: 'none', borderRadius: 6, color: a.color || 'var(--text-primary)',
                              fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left',
                              fontFamily: 'inherit', transition: 'background 0.15s'
                            }}
                            onMouseEnter={e => { if (bulkAction !== a.key) e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                            onMouseLeave={e => { if (bulkAction !== a.key) e.currentTarget.style.background = 'none'; }}
                          >{a.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Selected action form */}
              {bulkAction && (() => {
                const cfg = getActionConfig(bulkAction);
                if (!cfg) return null;
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: 14,
                    background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)'
                  }}>
                    <span className={`badge ${cfg.dangerous ? 'badge-danger' : 'badge-primary'}`} style={{ fontSize: 13, padding: '5px 12px' }}>
                      {cfg.label}
                    </span>
                    {cfg.needsValue && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 220 }}>
                        <input
                          type={cfg.placeholder === 'Kategori adı' || cfg.placeholder === 'Marka adı' ? 'text' : 'number'}
                          className="form-input"
                          placeholder={cfg.placeholder}
                          value={bulkValue}
                          onChange={e => setBulkValue(e.target.value)}
                          style={{ padding: '7px 12px', fontSize: 13 }}
                          autoFocus
                        />
                        {cfg.suffix && <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>{cfg.suffix}</span>}
                      </div>
                    )}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setBulkAction(''); setBulkValue(''); }}>İptal</button>
                      <button
                        className={`btn ${cfg.dangerous ? 'btn-danger' : 'btn-primary'} btn-sm`}
                        onClick={handleBulkSubmit}
                        disabled={bulkLoading || (cfg.needsValue && !bulkValue.trim())}
                        style={{ minWidth: 100 }}
                      >
                        {bulkLoading ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : 'Uygula'}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      <div className="table-container">
        <div className="table-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <h3>Ürünler ({pagination.total})</h3>
            <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
              <button className={`tab ${activeTab === 'modified' ? 'active' : ''}`} onClick={() => setActiveTab('modified')}>
                <Edit size={14} style={{ marginRight: 4 }} /> Düzenlenmiş Ürünler
              </button>
              <button className={`tab ${activeTab === 'xml' ? 'active' : ''}`} onClick={() => setActiveTab('xml')}>
                <FileCode2 size={14} style={{ marginRight: 4 }} /> XML Ham Verileri
              </button>
            </div>
          </div>
          <div className="header-search" style={{ width: 250 }}>
            <Search size={14} className="search-icon" />
            <input type="text" placeholder="Ürün ara..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        
        {/* Filtreler */}
        <div style={{ display: 'flex', gap: 12, padding: '12px 20px', borderBottom: filterConnection ? 'none' : '1px solid var(--border-color)', background: 'var(--bg-tertiary)', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Filtrele:</div>
          <select className="form-select" style={{ width: 200, padding: '6px 12px', fontSize: 13 }} value={filterXmlSource} onChange={e => setFilterXmlSource(e.target.value)}>
            <option value="">Tüm Tedarikçiler (XML)</option>
            {xmlSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <select className="form-select" style={{ width: 200, padding: '6px 12px', fontSize: 13 }} value={filterConnection} onChange={e => { setFilterConnection(e.target.value); setFilterMarketplaceStatus(''); }}>
            <option value="">Tüm Pazaryerleri</option>
            {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.marketplaceType}</option>)}
          </select>
        </div>

        {/* Marketplace durum sekmeleri */}
        {filterConnection && (() => {
          const s = mpStats?.mpStatus;
          const tabs = [
            { key: '', label: 'Tümü', count: mpStats?.total ?? null, color: 'var(--text-primary)' },
            { key: 'active', label: 'Satışta', count: s?.active ?? null, color: 'var(--success)' },
            { key: 'pending', label: 'Onay Bekliyor', count: s?.pending ?? null, color: 'var(--warning)' },
            { key: 'rejected', label: 'Reddedildi', count: s?.rejected ?? null, color: 'var(--danger)' },
            { key: 'passive', label: 'Satıştan Kaldırıldı', count: s?.passive ?? null, color: '#f97316' },
            { key: 'not_sent', label: 'Gönderilmemiş', count: s?.not_sent ?? null, color: 'var(--text-muted)' },
          ];
          return (
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card)', paddingLeft: 20, overflowX: 'auto' }}>
              {tabs.map(t => {
                const active = filterMarketplaceStatus === t.key;
                return (
                  <button key={t.key} onClick={() => { setFilterMarketplaceStatus(t.key); setPagination(p => ({ ...p, page: 1 })); }}
                    style={{
                      padding: '10px 18px', fontSize: 13, fontWeight: active ? 700 : 500,
                      color: active ? t.color : 'var(--text-secondary)',
                      background: 'none', border: 'none', borderBottom: active ? `2px solid ${t.color}` : '2px solid transparent',
                      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 7
                    }}
                  >
                    {t.label}
                    {t.count !== null && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
                        background: active ? t.color : 'var(--bg-tertiary)',
                        color: active ? '#fff' : 'var(--text-muted)'
                      }}>{t.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* ===== TRENDYOL CANLI VERİ TABLOSU ===== */}
        {isTrendyolTab && connections.find(c => c.id === filterConnection)?.marketplaceType === 'trendyol' ? (
          trendyolLoading ? (
            <div className="loading-spinner"><div className="spinner"></div></div>
          ) : trendyolProducts.length === 0 ? (
            <div className="empty-state">
              <Package size={48} className="empty-icon" />
              <h3>Bu kategoride ürün bulunamadı</h3>
              <p>Trendyol'dan veri çekildi, eşleşen ürün yok.</p>
            </div>
          ) : (
            <>
              <div style={{ padding: '8px 20px', background: 'rgba(249,115,22,0.05)', borderBottom: '1px solid var(--border-color)', fontSize: 12, color: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Trendyol'dan canlı çekilen veri — {trendyolPagination.total} ürün</span>
                <button onClick={() => fetchTrendyolProducts(trendyolPagination.page)} style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <RefreshCw size={12} /> Yenile
                </button>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Görsel</th>
                    <th>Barkod</th>
                    <th>Ürün Adı</th>
                    <th>SKU</th>
                    <th>Stok</th>
                    <th>Liste Fiyatı</th>
                    <th>Satış Fiyatı</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {trendyolProducts.map((tp, i) => {
                    const img = tp.images?.[0]?.url;
                    const isActive = tp.approved && tp.onSale;
                    const isRejected = tp.rejected;
                    const isPassive = tp.archived;
                    const statusLabel = isActive ? 'Satışta' : isRejected ? 'Reddedildi' : isPassive ? 'Kaldırıldı' : 'Onay Bekliyor';
                    const statusColor = isActive ? 'var(--success)' : isRejected ? 'var(--danger)' : isPassive ? '#f97316' : 'var(--warning)';
                    return (
                      <tr key={tp.barcode || i}>
                        <td>
                          <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <Package size={14} color="var(--text-muted)" />}
                          </div>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{tp.barcode}</td>
                        <td style={{ maxWidth: 260 }}>
                          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tp.title}</div>
                          {tp.rejectionReasonDetails?.length > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>{tp.rejectionReasonDetails[0]?.reason}</div>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tp.stockCode}</td>
                        <td>{tp.quantity ?? '—'}</td>
                        <td>{tp.listPrice != null ? `₺${tp.listPrice.toLocaleString('tr-TR')}` : '—'}</td>
                        <td style={{ fontWeight: 600 }}>{tp.salePrice != null ? `₺${tp.salePrice.toLocaleString('tr-TR')}` : '—'}</td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: `${statusColor}18`, color: statusColor }}>
                            {statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {trendyolPagination.totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 16 }}>
                  <button className="btn btn-secondary btn-sm" disabled={trendyolPagination.page === 0} onClick={() => fetchTrendyolProducts(trendyolPagination.page - 1)}>← Önceki</button>
                  <span style={{ lineHeight: '32px', fontSize: 13 }}>{trendyolPagination.page + 1} / {trendyolPagination.totalPages}</span>
                  <button className="btn btn-secondary btn-sm" disabled={trendyolPagination.page + 1 >= trendyolPagination.totalPages} onClick={() => fetchTrendyolProducts(trendyolPagination.page + 1)}>Sonraki →</button>
                </div>
              )}
            </>
          )
        ) : loading ? (
          <div className="loading-spinner"><div className="spinner"></div></div>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <Package size={48} className="empty-icon" />
            <h3>Henüz ürün yok</h3>
            <p>XML kaynağı ekleyerek veya manuel olarak ürün ekleyebilirsiniz</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Ürün Ekle</button>
          </div>
        ) : activeTab === 'xml' ? (
          /* ===== XML RAW DATA TAB ===== */
          <>
            <div style={{ padding: '10px 16px', background: 'rgba(6,182,212,0.06)', borderBottom: '1px solid var(--border-color)', fontSize: 13, color: 'var(--info)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileCode2 size={14} /> XML'den gelen orijinal veriler — bu değerler hiçbir zaman değiştirilmez
            </div>
            <table>
              <thead>
                <tr>
                  <th>SKU</th><th>Ürün Adı</th><th>XML Fiyat</th><th>XML Stok</th><th>XML Marka</th><th>XML Kategori</th><th>XML Barkod</th><th>Karşılaştır</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const raw = p.rawXmlData ? JSON.parse(p.rawXmlData) : null;
                  const xmlD = raw || { price: p.xmlPrice, stock: p.stock, brand: p.brand, category: p.category, barcode: p.barcode, title: p.title, sku: p.sku };
                  const priceChanged = xmlD.price !== p.price;
                  const stockChanged = xmlD.stock !== p.stock;
                  return (
                    <tr key={p.id}>
                      {p.xmlSource?.globalProviderId ? (
                        <>
                          <td style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)' }}>{p.sku}</td>
                          <td><ProductThumb p={p} title={p.title} /></td>
                          <td colSpan="5" style={{ textAlign: 'center', color: 'var(--accent-primary)', fontSize: 13, fontStyle: 'italic', padding: '12px' }}>
                            ✨ Tedarikçi Havuzundan Eklendi (Orijinal veriler gizlidir)
                          </td>
                          <td>
                            <button className="btn btn-secondary btn-sm" disabled title="Bu özellik havuz ürünlerinde kullanılamaz">
                              <Eye size={14} /> Fark
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)' }}>{xmlD.sku || p.sku}</td>
                          <td><ProductThumb p={p} title={xmlD.title || p.title} /></td>
                          <td style={{ fontWeight: 600 }}>₺{(xmlD.price || 0).toLocaleString('tr-TR')}</td>
                          <td>{xmlD.stock ?? p.stock}</td>
                          <td>{xmlD.brand || p.brand || '-'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{xmlD.category || p.category || '-'}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{xmlD.barcode || p.barcode || '-'}</td>
                          <td>
                            <button className="btn btn-secondary btn-sm" onClick={() => setDetailProduct(p)}>
                              <Eye size={14} /> Fark
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pagination.totalPages > 1 && (
              <div className="pagination">
                <button disabled={pagination.page <= 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>Önceki</button>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{pagination.page} / {pagination.totalPages}</span>
                <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>Sonraki</button>
              </div>
            )}
          </>
        ) : (
          /* ===== MODIFIED PRODUCTS TAB ===== */
          <>
            {/* Select All Banner */}
            {showBulkPanel && allSelected && !selectAllMode && pagination.total > products.length && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 16px', background: 'rgba(59,130,246,0.08)',
                borderBottom: '1px solid var(--border-color)', fontSize: 13, color: 'var(--text-secondary)'
              }}>
                Bu sayfadaki <strong style={{ color: 'var(--text-primary)' }}>{products.length}</strong> ürün seçili.
                <button onClick={selectAllProducts} style={{
                  background: 'none', border: 'none', color: 'var(--accent-primary)',
                  cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
                  textDecoration: 'underline', padding: 0
                }}>Tüm {pagination.total} ürünü seç</button>
              </div>
            )}
            {showBulkPanel && selectAllMode && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 16px', background: 'rgba(16,185,129,0.08)',
                borderBottom: '1px solid var(--border-color)', fontSize: 13, color: 'var(--success)'
              }}>
                ✓ Tüm <strong>{selectedIds.size}</strong> ürün seçili.
                <button onClick={() => { setSelectAllMode(false); setSelectedIds(new Set(products.map(p => p.id))); }} style={{
                  background: 'none', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontWeight: 500, fontSize: 13, fontFamily: 'inherit',
                  textDecoration: 'underline', padding: 0
                }}>Seçimi temizle</button>
              </div>
            )}
            <table>
              <thead>
                <tr>
                  {showBulkPanel && (
                    <th style={{ width: 40, textAlign: 'center' }}>
                      <button onClick={toggleAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: allSelected ? 'var(--accent-primary)' : 'var(--text-muted)', padding: 0 }}>
                        {allSelected ? <CheckSquare size={17} /> : <Square size={17} />}
                      </button>
                    </th>
                  )}
                  <th>SKU</th><th>Ürün Adı</th><th>XML Fiyat</th><th>{filterConnection ? 'Hesaplanan Fiyat' : 'Satış Fiyatı'}</th><th>Fark</th><th>Stok</th><th>Marka</th><th>Pazaryeri</th><th>Durum</th><th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const isSelected = selectedIds.has(p.id);
                  const xmlPrice = p.xmlPrice || 0;
                  const basePrice = p.price || 0;
                  const calculatedMpPrice = getMarketplacePrice(p, filterConnection);
                  const salePrice = calculatedMpPrice !== null ? calculatedMpPrice : basePrice;
                  const hasMissingRule = filterConnection && calculatedMpPrice === null;
                  
                  const diff = salePrice - xmlPrice;
                  const diffPct = xmlPrice > 0 ? ((diff / xmlPrice) * 100).toFixed(1) : 0;
                  return (
                    <tr key={p.id} style={isSelected ? { background: 'rgba(59,130,246,0.08)' } : undefined}>
                      {showBulkPanel && (
                        <td style={{ textAlign: 'center' }}>
                          <button onClick={() => toggleSelect(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)', padding: 0 }}>
                            {isSelected ? <CheckSquare size={17} /> : <Square size={17} />}
                          </button>
                        </td>
                      )}
                      <td style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)' }}>{p.sku}</td>
                      <td><ProductThumb p={p} title={p.title} /></td>
                      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {xmlPrice > 0 ? `₺${xmlPrice.toLocaleString('tr-TR')}` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ fontWeight: 600, color: filterConnection ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                        {hasMissingRule ? (
                           <span className="badge badge-error" style={{ fontSize: 10 }}>Kural Eksik</span>
                        ) : (
                           `₺${salePrice.toLocaleString('tr-TR')}`
                        )}
                      </td>
                      <td>
                        {xmlPrice > 0 && diff !== 0 ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                            background: diff > 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                            color: diff > 0 ? 'var(--success)' : 'var(--danger)'
                          }}>
                            {diff > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            {diff > 0 ? '+' : ''}₺{diff.toLocaleString('tr-TR')} ({diffPct}%)
                          </span>
                        ) : xmlPrice > 0 ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Manuel</span>
                        )}
                      </td>
                      <td><span className={`badge ${p.stock > 10 ? 'badge-success' : p.stock > 0 ? 'badge-warning' : 'badge-danger'}`}>{p.stock}</span></td>
                      <td>{p.brand || '-'}</td>
                      <td>
                        {p.marketplaceProducts && p.marketplaceProducts.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {p.marketplaceProducts.map(mp => (
                              <span key={mp.id}
                                className={`badge badge-${mp.status === 'active' ? 'success' : mp.status === 'rejected' ? 'danger' : mp.status === 'passive' ? 'error' : 'warning'}`}
                                title={mp.errorMessage || 'Durum: ' + mp.status}
                                style={mp.status === 'passive' ? { background: 'rgba(249,115,22,0.12)', color: '#f97316', borderColor: 'rgba(249,115,22,0.3)' } : undefined}
                              >
                                {mp.connection.marketplaceType === 'trendyol' ? 'Trendyol' : mp.connection.marketplaceType}:{' '}
                                {mp.status === 'pending' ? 'Bekliyor' : mp.status === 'active' ? 'Aktif' : mp.status === 'rejected' ? 'Reddedildi' : mp.status === 'passive' ? 'Kaldırıldı' : mp.status}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Yok</span>
                        )}
                      </td>
                      <td><span className={`badge ${p.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{p.status === 'active' ? 'Aktif' : 'Pasif'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => openHistory(p)} title="Güncelleme Geçmişi"><History size={14} /></button>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}><Edit size={14} /></button>
                          <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(p.id)}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pagination.totalPages > 1 && (
              <div className="pagination">
                <button disabled={pagination.page <= 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>Önceki</button>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{pagination.page} / {pagination.totalPages}</span>
                <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>Sonraki</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sync Status Result Modal */}
      {syncResult && (
        <div className="modal-overlay" onClick={() => setSyncResult(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <RefreshCw size={18} style={{ color: 'var(--accent-primary)' }} />
                Durum Sorgulama Sonucu
              </h3>
              <button className="modal-close" onClick={() => setSyncResult(null)}>×</button>
            </div>
            <div className="modal-body" style={{ padding: '20px 24px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                🕐 {syncResult.syncedAt}
              </div>

              {/* Ana istatistikler */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
                {[
                  { label: 'Güncellenen', value: syncResult.updated, color: 'var(--accent-primary)', icon: '↺' },
                  { label: 'Aktifleşti', value: syncResult.activated, color: 'var(--success)', icon: '✓' },
                  { label: 'Reddedildi', value: syncResult.rejected, color: 'var(--danger)', icon: '✕' },
                  { label: 'Trendyol\'da Bulundu', value: syncResult.discovered, color: 'var(--warning)', icon: '⊕' },
                  { label: 'Satıştan Kaldırıldı', value: syncResult.passived || 0, color: '#f97316', icon: '⊘' },
                ].map(stat => (
                  <div key={stat.label} style={{
                    padding: '14px 16px', borderRadius: 10,
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                    display: 'flex', alignItems: 'center', gap: 12
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: `color-mix(in srgb, ${stat.color} 12%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${stat.color} 30%, transparent)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, color: stat.color, fontWeight: 700
                    }}>{stat.icon}</div>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: stat.value > 0 ? stat.color : 'var(--text-muted)', lineHeight: 1 }}>{stat.value}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{stat.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Yöntem detayı */}
              <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', marginBottom: syncResult.errors.length > 0 ? 16 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Sorgulama Detayı</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>📦 Batch isteği ile kontrol</span>
                    <span style={{ fontWeight: 600 }}>{syncResult.batchChecked} ürün</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>🔍 Barkod ile eşleştirme</span>
                    <span style={{ fontWeight: 600 }}>{syncResult.fallbackChecked} ürün</span>
                  </div>
                  {syncResult.connections.length > 1 && syncResult.connections.map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                      <span>└ {c.name}</span>
                      <span>{c.updated || 0} güncelleme</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hatalar */}
              {syncResult.errors.length > 0 && (
                <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', marginTop: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', marginBottom: 8 }}>⚠ Hatalar ({syncResult.errors.length})</div>
                  {syncResult.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>• {e}</div>
                  ))}
                </div>
              )}

              {syncResult.updated === 0 && syncResult.discovered === 0 && !syncResult.passived && (
                <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 13, color: 'var(--text-muted)' }}>
                  Tüm durumlar güncel, değişen ürün yok.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSyncResult(null)}>Kapat</button>
            </div>
          </div>
        </div>
      )}

      {/* Product Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editProduct ? 'Ürün Düzenle' : 'Yeni Ürün Ekle'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="grid grid-2">
                  <div className="form-group"><label className="form-label">SKU *</label><input className="form-input" value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} required /></div>
                  <div className="form-group"><label className="form-label">Barkod</label><input className="form-input" value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} /></div>
                </div>
                <div className="form-group"><label className="form-label">Ürün Adı *</label><input className="form-input" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required /></div>
                <div className="grid grid-2">
                  <div className="form-group"><label className="form-label">Fiyat (₺)</label><input type="number" className="form-input" value={form.price} onChange={e => setForm({...form, price: e.target.value})} /></div>
                  <div className="form-group"><label className="form-label">Stok</label><input type="number" className="form-input" value={form.stock} onChange={e => setForm({...form, stock: e.target.value})} /></div>
                </div>
                <div className="grid grid-2">
                  <div className="form-group"><label className="form-label">Marka</label><input className="form-input" value={form.brand} onChange={e => setForm({...form, brand: e.target.value})} /></div>
                  <div className="form-group"><label className="form-label">Kategori</label><input className="form-input" value={form.category} onChange={e => setForm({...form, category: e.target.value})} /></div>
                </div>
                <div className="form-group"><label className="form-label">Açıklama</label><textarea className="form-textarea" value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>İptal</button>
                <button type="submit" className="btn btn-primary">{editProduct ? 'Güncelle' : 'Kaydet'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3 style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={20} /> Dikkat
              </h3>
              <button className="modal-close" onClick={() => setShowConfirm(false)}>×</button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 15, marginBottom: 8 }}>
                <strong>{selectedIds.size}</strong> ürünü silmek istediğinize emin misiniz?
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Bu işlem geri alınamaz.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowConfirm(false)}>Vazgeç</button>
              <button className="btn btn-danger" onClick={executeBulkAction} disabled={bulkLoading}>
                {bulkLoading ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : 'Evet, Sil'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Product Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>Ürünü Sil</h3>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Bu ürünü silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>İptal</button>
              <button className="btn btn-danger" onClick={handleDelete}>Evet, Sil</button>
            </div>
          </div>
        </div>
      )}

      {/* Product History Modal */}
      {historyProduct && (
        <div className="modal-overlay" onClick={() => setHistoryProduct(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <History size={18} style={{ color: 'var(--accent-primary)' }} />
                Güncelleme Geçmişi
              </h3>
              <button className="modal-close" onClick={() => setHistoryProduct(null)}>×</button>
            </div>
            <div className="modal-body" style={{ padding: '16px 24px' }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{historyProduct.title}</strong>
                <span style={{ marginLeft: 8, fontFamily: 'monospace', color: 'var(--text-muted)' }}>#{historyProduct.sku}</span>
              </div>
              {logsLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                  <div className="spinner" />
                </div>
              ) : productLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                  <History size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                  <p style={{ fontSize: 13 }}>Henüz geçmiş kaydı yok.<br />Bir sonraki XML senkronizasyonunda değişiklikler burada görünecek.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {productLogs.map((log, i) => {
                    const isCreate = log.type === 'created';
                    const priceUp = log.newPrice != null && log.oldPrice != null && log.newPrice > log.oldPrice;
                    const priceDown = log.newPrice != null && log.oldPrice != null && log.newPrice < log.oldPrice;
                    const stockUp = log.newStock != null && log.oldStock != null && log.newStock > log.oldStock;
                    const stockDown = log.newStock != null && log.oldStock != null && log.newStock < log.oldStock;
                    return (
                      <div key={log.id} style={{ display: 'flex', gap: 12, paddingBottom: 16, position: 'relative' }}>
                        {/* Timeline line */}
                        {i < productLogs.length - 1 && (
                          <div style={{ position: 'absolute', left: 15, top: 32, bottom: 0, width: 2, background: 'var(--border-color)' }} />
                        )}
                        {/* Dot */}
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: isCreate ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.1)',
                          border: `2px solid ${isCreate ? 'var(--success)' : 'var(--accent-primary)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1
                        }}>
                          {isCreate
                            ? <Sparkles size={14} style={{ color: 'var(--success)' }} />
                            : <RefreshCw size={13} style={{ color: 'var(--accent-primary)' }} />}
                        </div>
                        {/* Content */}
                        <div style={{ flex: 1, paddingTop: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span style={{
                              fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                              background: isCreate ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.08)',
                              color: isCreate ? 'var(--success)' : 'var(--accent-primary)'
                            }}>
                              {isCreate ? '✨ Ürün Eklendi' : '🔄 Senkronize Edildi'}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {new Date(log.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            {log.newPrice != null && log.oldPrice == null && (
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                Fiyat: <strong style={{ color: 'var(--text-primary)' }}>₺{log.newPrice?.toLocaleString('tr-TR')}</strong>
                              </div>
                            )}
                            {log.newPrice != null && log.oldPrice != null && (
                              <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ color: 'var(--text-muted)' }}>₺{log.oldPrice?.toLocaleString('tr-TR')}</span>
                                <span style={{ color: 'var(--text-muted)' }}>→</span>
                                <span style={{ fontWeight: 700, color: priceUp ? 'var(--danger)' : priceDown ? 'var(--success)' : 'var(--text-primary)' }}>
                                  ₺{log.newPrice?.toLocaleString('tr-TR')}
                                </span>
                                {priceUp && <ArrowUp size={12} style={{ color: 'var(--danger)' }} />}
                                {priceDown && <ArrowDown size={12} style={{ color: 'var(--success)' }} />}
                              </div>
                            )}
                            {log.newStock != null && log.oldStock == null && (
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                Stok: <strong style={{ color: 'var(--text-primary)' }}>{log.newStock}</strong>
                              </div>
                            )}
                            {log.newStock != null && log.oldStock != null && (
                              <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ color: 'var(--text-muted)' }}>{log.oldStock}</span>
                                <span style={{ color: 'var(--text-muted)' }}>→</span>
                                <span style={{ fontWeight: 700, color: stockUp ? 'var(--success)' : stockDown ? 'var(--danger)' : 'var(--text-primary)' }}>
                                  {log.newStock}
                                </span>
                                {stockUp && <ArrowUp size={12} style={{ color: 'var(--success)' }} />}
                                {stockDown && <ArrowDown size={12} style={{ color: 'var(--danger)' }} />}
                              </div>
                            )}
                          </div>
                          {log.notes && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{log.notes}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setHistoryProduct(null)}>Kapat</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Comparison Modal */}
      {detailProduct && (() => {
        const p = detailProduct;
        const raw = p.rawXmlData ? JSON.parse(p.rawXmlData) : null;
        const xml = raw || { price: p.xmlPrice, stock: p.stock, brand: p.brand, category: p.category, barcode: p.barcode, title: p.title, sku: p.sku };
        const rows = [
          { label: 'SKU', xml: xml.sku, modified: p.sku },
          { label: 'Barkod', xml: xml.barcode, modified: p.barcode },
          { label: 'Ürün Adı', xml: xml.title, modified: p.title },
          { label: 'Fiyat', xml: `₺${(xml.price || 0).toLocaleString('tr-TR')}`, modified: `₺${(p.price || 0).toLocaleString('tr-TR')}` },
          { label: 'Stok', xml: xml.stock, modified: p.stock },
          { label: 'Marka', xml: xml.brand, modified: p.brand },
          { label: 'Kategori', xml: xml.category, modified: p.category },
          { label: 'Liste Fiyat', xml: xml.listPrice != null ? `₺${xml.listPrice}` : '-', modified: `₺${p.listPrice || 0}` },
        ];
        return (
          <div className="modal-overlay" onClick={() => setDetailProduct(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
              <div className="modal-header">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Eye size={18} style={{ color: 'var(--accent-primary)' }} /> XML vs Düzenlenmiş Karşılaştırma
                </h3>
                <button className="modal-close" onClick={() => setDetailProduct(null)}>×</button>
              </div>
              <div className="modal-body" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr><th>Alan</th><th>XML (Orijinal)</th><th>Düzenlenmiş</th><th>Durum</th></tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const changed = String(r.xml || '') !== String(r.modified || '');
                      return (
                        <tr key={r.label}>
                          <td style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</td>
                          <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{r.xml || '-'}</td>
                          <td style={{ fontSize: 13, fontWeight: changed ? 600 : 400, color: changed ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>{r.modified || '-'}</td>
                          <td>
                            {changed ? (
                              <span className="badge badge-success" style={{ fontSize: 11 }}>Değişti</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Aynı</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setDetailProduct(null)}>Kapat</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
