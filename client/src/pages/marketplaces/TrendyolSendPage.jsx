import { useState, useEffect, useMemo } from 'react';
import { Send, Search, CheckSquare, Square, Package, AlertCircle, RefreshCw, ChevronDown, Filter, Eye } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function TrendyolSendPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [showSendAllModal, setShowSendAllModal] = useState(false);
  const [showSendSelectedModal, setShowSendSelectedModal] = useState(false);
  const [minStock, setMinStock] = useState(0);
  const [sendAllResult, setSendAllResult] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all'); // all, ready, missing
  const [xmlSources, setXmlSources] = useState([]);
  const [filterXmlSource, setFilterXmlSource] = useState('');
  const [pricingRules, setPricingRules] = useState([]);
  const [filterCategories, setFilterCategories] = useState(new Set());

  useEffect(() => { fetchConnections(); fetchXmlSources(); fetchPricingRules(); }, []);
  useEffect(() => { if (selectedConn) { fetchProducts(); fetchMappings(); } }, [selectedConn, pagination.page, search, filterXmlSource]);

  const fetchPricingRules = async () => {
    try {
      const res = await api.get('/pricing');
      setPricingRules(res.data);
    } catch {}
  };

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      // For now, only show trendyol since it's the only one implemented for sending,
      // but let's prepare the UI for multiple marketplaces.
      // If we keep all connections, we can still use them.
      setConnections(res.data);
      if (res.data.length > 0) setSelectedConn(res.data[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const fetchXmlSources = async () => {
    try {
      const res = await api.get('/xml-sources');
      setXmlSources(res.data);
    } catch {}
  };

  const fetchProducts = async () => {
    try {
      const params = { page: pagination.page, limit: 20, search };
      if (filterXmlSource) params.xmlSourceId = filterXmlSource;
      const res = await api.get('/products', { params });
      setProducts(res.data.products);
      setPagination(p => ({ ...p, total: res.data.pagination.total, totalPages: res.data.pagination.totalPages }));
    } catch { toast.error('Ürünler yüklenemedi'); }
  };

  const fetchMappings = async () => {
    if (!selectedConn) return;
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/category-mappings`);
      console.log('[CategoryMappings] loaded:', res.data.length, res.data.map(m => m.localCategory));
      setMappings(res.data);
    } catch {}
  };

  // Case-insensitive + trimmed lookup for robustness
  const mappedCategories = useMemo(() => {
    const acc = {};
    for (const m of mappings) {
      acc[m.localCategory.toLowerCase().trim()] = m;
    }
    return acc;
  }, [mappings]);

  // Finds a mapping for a category that may be pipe-separated (e.g. "Kadın|Bayan Bileklik|")
  const findCatMapping = (category) => {
    if (!category) return null;
    const key = category.toLowerCase().trim();
    if (mappedCategories[key]) return mappedCategories[key];
    if (key.includes('|')) {
      const parts = key.split('|').map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (mappedCategories[part]) return mappedCategories[part];
      }
    }
    return null;
  };

  const { pricingLookup, priceRangeRules } = useMemo(() => {
    if (!selectedConn) return { pricingLookup: {}, priceRangeRules: [] };
    const lookup = {};
    const rangeRules = [];
    for (const r of pricingRules) {
      if (!r.isActive) continue;
      if (r.applyTo === 'price_range') {
        rangeRules.push(r);
        continue;
      }
      if (!r.conditions) continue;
      try {
        const conds = JSON.parse(r.conditions);
        if (conds.connectionId === selectedConn.id && conds.xmlSourceId) {
          lookup[conds.xmlSourceId] = r;
        }
      } catch(e) {}
    }
    return { pricingLookup: lookup, priceRangeRules: rangeRules };
  }, [pricingRules, selectedConn]);

  const matchesPriceRangeRule = (xmlPrice, xmlSourceId) => {
    if (!xmlPrice || xmlPrice <= 0) return false;
    for (const r of priceRangeRules) {
      if (!r.conditions) continue;
      try {
        const c = JSON.parse(r.conditions);
        if (c.connectionId && c.connectionId !== selectedConn?.id) continue;
        if (c.xmlSourceId && c.xmlSourceId !== xmlSourceId) continue;
        const min = c.minPurchasePrice ?? null;
        const max = c.maxPurchasePrice ?? null;
        if (min === null && max === null) continue;
        if (min !== null && xmlPrice < min) continue;
        if (max !== null && xmlPrice > max) continue;
        return true;
      } catch(e) {}
    }
    return false;
  };

  const getCalculatedPrice = (p) => {
    const rule = pricingLookup[p.xmlSourceId];
    if (rule) {
      let finalPrice = p.price;
      if (rule.type === 'percentage') finalPrice = finalPrice * (1 + rule.value / 100);
      if (rule.type === 'fixed') finalPrice = finalPrice + rule.value;
      return Math.round(Math.max(0, finalPrice) * 100) / 100;
    }
    const xmlPrice = p.xmlPrice || p.price;
    for (const r of priceRangeRules) {
      if (!r.conditions) continue;
      try {
        const c = JSON.parse(r.conditions);
        if (c.connectionId && c.connectionId !== selectedConn?.id) continue;
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
    return p.price;
  };

  const getProductStatus = (p) => {
    const hasCategoryMapping = !!findCatMapping(p.category);
    const hasBarcode = !!p.barcode;
    const hasPricingRule = !!pricingLookup[p.xmlSourceId] || matchesPriceRangeRule(p.xmlPrice || p.price, p.xmlSourceId);
    if (hasCategoryMapping && hasBarcode && hasPricingRule) return 'ready';
    return 'missing';
  };

  const toggleCategoryFilter = (localCategory) => {
    setFilterCategories(prev => {
      const next = new Set(prev);
      next.has(localCategory) ? next.delete(localCategory) : next.add(localCategory);
      return next;
    });
  };

  const filteredProducts = products.filter(p => {
    if (filterStatus !== 'all' && getProductStatus(p) !== filterStatus) return false;
    if (filterCategories.size > 0) {
      const cat = p.category?.toLowerCase().trim() || '';
      const matched = [...filterCategories].some(fc => {
        const fck = fc.toLowerCase().trim();
        if (cat === fck) return true;
        if (cat.includes('|')) return cat.split('|').map(s => s.trim()).includes(fck);
        return false;
      });
      if (!matched) return false;
    }
    return true;
  });

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const readyIds = filteredProducts.filter(p => getProductStatus(p) === 'ready').map(p => p.id);
    const allSelected = readyIds.every(id => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(readyIds));
  };

  const handleSendAll = async () => {
    if (!selectedConn) return;
    setSendingAll(true);
    setShowSendAllModal(false);
    setSendAllResult(null);
    try {
      const body = { minStock };
      if (filterXmlSource) body.xmlSourceId = filterXmlSource;
      if (filterCategories.size > 0) body.localCategories = [...filterCategories];
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/send-all-ready`, body);
      setSendAllResult(res.data);
      toast.success(`${res.data.sent} ürün ${res.data.batches} parti halinde gönderildi`);
    } catch (err) {
      const errData = err.response?.data;
      toast.error(errData?.error || errData?.message || 'Toplu gönderme hatası', { duration: 8000 });
    } finally { setSendingAll(false); }
  };

  const handleSendToMarketplace = async () => {
    if (!selectedConn || selectedIds.size === 0) return;
    setShowSendSelectedModal(false);
    setSending(true);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/send-products`, {
        productIds: Array.from(selectedIds),
        minStock,
      });
      toast.success(res.data.message || `${selectedIds.size} ürün pazaryerine gönderildi`);
      setSelectedIds(new Set());
    } catch (err) {
      const errData = err.response?.data;
      const errorMsg = errData?.message || errData?.error || 'Gönderme hatası';
      toast.error(errorMsg, { duration: 8000 });
      if (errData?.details) {
        console.error('[Marketplace Send Error Details]', errData.details);
      }
    } finally { setSending(false); }
  };

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

  const unmappedCategories = useMemo(() => {
    const cats = new Set();
    for (const p of products) {
      if (p.category && !findCatMapping(p.category)) {
        cats.add(p.category);
      }
    }
    return [...cats].sort();
  }, [products, mappedCategories]);

  // Products with missing price rule: show their xmlPrice for diagnosis
  const priceMissingInfo = useMemo(() => {
    const seen = new Set();
    const rows = [];
    for (const p of products) {
      if (!!pricingLookup[p.xmlSourceId] || matchesPriceRangeRule(p.xmlPrice || p.price, p.xmlSourceId)) continue;
      const key = `${p.xmlSourceId}|${p.xmlPrice}|${p.price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const src = xmlSources.find(s => s.id === p.xmlSourceId);
      rows.push({ xmlSourceId: p.xmlSourceId, srcName: src?.name || p.xmlSourceId, xmlPrice: p.xmlPrice, price: p.price });
    }
    return rows.slice(0, 5);
  }, [products, pricingLookup, priceRangeRules, selectedConn, xmlSources]);

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Pazaryerine Gönder</h1><p>Ürünlerinizi pazaryerlerine gönderin</p></div>
        <div className="card">
          <div className="empty-state">
            <AlertCircle size={48} className="empty-icon" />
            <h3>Pazaryeri bağlantısı bulunamadı</h3>
            <p>Önce Pazaryerleri sayfasından bir bağlantı oluşturun</p>
          </div>
        </div>
      </div>
    );
  }

  const readyCount = products.filter(p => getProductStatus(p) === 'ready').length;
  const missingCount = products.filter(p => getProductStatus(p) === 'missing').length;

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Pazaryerine Gönder</h1>
          <p>Düzenlenmiş ürünlerinizi pazaryeri mağazanıza gönderin</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {connections.length > 0 && (
            <select className="form-select" style={{ width: 200 }}
              value={selectedConn?.id || ''}
              onChange={e => { setSelectedConn(connections.find(c => c.id === e.target.value)); setSelectedIds(new Set()); }}
            >
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.marketplaceType} ({c.marketplaceType})</option>)}
            </select>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => setShowSendAllModal(true)}
            disabled={sendingAll || sending}
            style={{ padding: '10px 24px' }}
          >
            <Send size={16} />
            {sendingAll ? 'Gönderiliyor...' : 'Tümünü Hazır Gönder'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowSendSelectedModal(true)}
            disabled={sending || selectedIds.size === 0}
            style={{ padding: '10px 24px' }}
          >
            <Send size={16} />
            {sending ? 'Gönderiliyor...' : 'Pazaryerine Gönder'} ({selectedIds.size})
          </button>
        </div>
      </div>

      {/* Status summary cards */}
      <div className="grid grid-3" style={{ marginBottom: 20, gap: 12 }}>
        <div className="card" style={{ padding: 16, cursor: 'pointer', border: filterStatus === 'all' ? '2px solid var(--accent-primary)' : undefined }} onClick={() => setFilterStatus('all')}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Toplam Ürün</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{pagination.total}</div>
        </div>
        <div className="card" style={{ padding: 16, cursor: 'pointer', border: filterStatus === 'ready' ? '2px solid var(--success)' : undefined }} onClick={() => setFilterStatus('ready')}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Gönderilebilir</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{readyCount}</div>
        </div>
        <div className="card" style={{ padding: 16, cursor: 'pointer', border: filterStatus === 'missing' ? '2px solid var(--warning)' : undefined }} onClick={() => setFilterStatus('missing')}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Eksik Bilgi</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--warning)' }}>{missingCount}</div>
        </div>
      </div>

      {/* Category mapping status */}
      {(unmappedCategories.length > 0 || mappings.length > 0) && (
        <div style={{ background: unmappedCategories.length > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.06)', border: `1px solid ${unmappedCategories.length > 0 ? 'var(--warning)' : 'var(--success)'}`, borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 8 }}>
                Yüklenen Eşlemeler ({mappings.length})
                {filterCategories.size > 0 && (
                  <button
                    onClick={() => setFilterCategories(new Set())}
                    style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-primary)', background: 'rgba(99,102,241,0.1)', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
                  >
                    {filterCategories.size} seçili — temizle ✕
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {mappings.length === 0
                  ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Hiç eşleme bulunamadı</span>
                  : mappings.slice(0, 20).map(m => {
                    const selected = filterCategories.has(m.localCategory);
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleCategoryFilter(m.localCategory)}
                        style={{
                          background: selected ? 'rgba(99,102,241,0.2)' : 'rgba(34,197,94,0.12)',
                          color: selected ? 'var(--accent-primary)' : 'var(--success)',
                          border: selected ? '1px solid var(--accent-primary)' : '1px solid transparent',
                          borderRadius: 4, padding: '2px 8px', fontSize: 11,
                          fontFamily: 'monospace', cursor: 'pointer',
                          fontWeight: selected ? 700 : 400,
                        }}
                      >
                        {m.localCategory}
                      </button>
                    );
                  })}
              </div>
              {mappings.length > 0 && (
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  Kategoriye tıklayarak ürün listesini filtrele
                </p>
              )}
            </div>
            {unmappedCategories.length > 0 && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Eşleşmeyen Ürün Kategorileri ({unmappedCategories.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                  {unmappedCategories.map(cat => (
                    <span key={cat} style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--warning)', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}>
                      {cat}
                    </span>
                  ))}
                </div>
                <a href="/category-mapping" style={{ fontSize: 12, color: 'var(--accent-primary)', textDecoration: 'underline' }}>
                  Kategori Eşleştirme sayfasına git →
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pricing rule debug panel */}
      {priceMissingInfo.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid var(--danger)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Fiyat Kuralı Eşleşmeyen Ürünler — XML Fiyat Değerleri
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {priceMissingInfo.map((row, i) => (
              <span key={i} style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', borderRadius: 4, padding: '3px 10px', fontSize: 11, fontFamily: 'monospace' }}>
                {row.srcName}: xmlFiyat={row.xmlPrice ?? 'null'} / satışFiyatı={row.price}
              </span>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
            Fiyat aralığı kuralınızın min/max değerleri bu XML fiyatlarını kapsıyor mu? "XML Fiyat" 0 veya null ise XML kaynağını yeniden senkronize edin.
          </p>
        </div>
      )}

      {/* Products table */}
      <div className="table-container">
        <div className="table-header">
          <h3>Ürünler</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select className="form-select form-select-sm" style={{ width: 180, fontSize: 13, padding: '6px 10px' }} value={filterXmlSource} onChange={e => setFilterXmlSource(e.target.value)}>
              <option value="">Tüm Tedarikçiler (XML)</option>
              {xmlSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="header-search" style={{ width: 220 }}>
              <Search size={14} className="search-icon" />
              <input type="text" placeholder="Ürün ara..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={toggleAll}>
              {filteredProducts.filter(p => getProductStatus(p) === 'ready').every(p => selectedIds.has(p.id)) && readyCount > 0
                ? <><CheckSquare size={14} /> Seçimi Kaldır</>
                : <><Square size={14} /> Hazır Olanları Seç</>
              }
            </button>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>SKU</th>
              <th>Ürün Adı</th>
              <th>Fiyat</th>
              <th>Barkod</th>
              <th>Kategori</th>
              <th>Trendyol Kat.</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map(p => {
              const status = getProductStatus(p);
              const isSelected = selectedIds.has(p.id);
              const catMapping = findCatMapping(p.category);
              const thumbImg = getFirstImage(p);
              const hasPricingRule = !!pricingLookup[p.xmlSourceId] || matchesPriceRangeRule(p.xmlPrice || p.price, p.xmlSourceId);
              const issues = [];
              if (!p.barcode) issues.push('Barkod yok');
              if (!hasPricingRule) issues.push('Fiyat kuralı yok');
              if (!catMapping) issues.push('Kategori eşleştirilmemiş');

              return (
                <tr key={p.id} style={{ background: isSelected ? 'rgba(59,130,246,0.08)' : undefined, opacity: status === 'missing' ? 0.7 : 1 }}>
                  <td style={{ textAlign: 'center' }}>
                    {status === 'ready' ? (
                      <button onClick={() => toggleSelect(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)', padding: 0 }}>
                        {isSelected ? <CheckSquare size={17} /> : <Square size={17} />}
                      </button>
                    ) : (
                      <AlertCircle size={15} style={{ color: 'var(--warning)' }} />
                    )}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)' }}>{p.sku}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
                      }}>
                        {thumbImg ? (
                          <>
                            <img src={thumbImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }}
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
                      <span style={{ fontWeight: 500, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.title}
                      </span>
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>₺{(getCalculatedPrice(p) || 0).toLocaleString('tr-TR')}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: p.barcode ? 'var(--text-secondary)' : 'var(--danger)' }}>
                    {p.barcode || '⚠ Eksik'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.category || '-'}</td>
                  <td>
                    {catMapping ? (
                      <span className="badge badge-success" style={{ fontSize: 11 }}>{catMapping.marketplaceCategoryName?.split(' > ').pop() || catMapping.marketplaceCategoryId}</span>
                    ) : p.category ? (
                      <span className="badge badge-warning" style={{ fontSize: 11 }}>Eşleştirilmemiş</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    {status === 'ready' ? (
                      <span className="badge badge-success">Gönderime Hazır</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {!findCatMapping(p.category) && <span className="badge badge-error" style={{ fontSize: 10 }}>Kategori Eksik</span>}
                        {!p.barcode && <span className="badge badge-error" style={{ fontSize: 10 }}>Barkod Eksik</span>}
                        {!hasPricingRule && <span className="badge badge-error" style={{ fontSize: 10 }}>Fiyat Eksik</span>}
                      </div>
                    )}
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
      </div>

      {/* Send-all result banner */}
      {sendAllResult && (
        <div style={{ marginTop: 16, background: 'rgba(34,197,94,0.08)', border: '1px solid var(--success)', borderRadius: 8, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontWeight: 600, color: 'var(--success)', marginRight: 16 }}>Toplu Gönderim Tamamlandı</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {sendAllResult.sent} ürün gönderildi &bull; {sendAllResult.batches} parti &bull; {sendAllResult.skipped} atlandı
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setSendAllResult(null)} style={{ fontSize: 12 }}>Kapat</button>
        </div>
      )}

      {/* Send settings modal — shared layout */}
      {(showSendAllModal || showSendSelectedModal) && (() => {
        const isSendAll = showSendAllModal;
        const close = () => isSendAll ? setShowSendAllModal(false) : setShowSendSelectedModal(false);
        const confirm = isSendAll ? handleSendAll : handleSendToMarketplace;
        const lowStockCount = isSendAll
          ? products.filter(p => getProductStatus(p) === 'ready' && minStock > 0 && (p.stock ?? 0) < minStock).length
          : [...selectedIds].filter(id => {
              const p = products.find(x => x.id === id);
              return p && minStock > 0 && (p.stock ?? 0) < minStock;
            }).length;

        return (
          <div className="modal-overlay" onClick={close}>
            <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{isSendAll ? 'Tüm Hazır Ürünleri Gönder' : `${selectedIds.size} Ürün Gönder`}</h3>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
                  {isSendAll
                    ? <>Seçili bağlantıdaki <strong>tüm gönderime hazır ürünler</strong> Trendyol'a toplu olarak gönderilecek.</>
                    : <><strong>{selectedIds.size} seçili ürün</strong> Trendyol'a gönderilecek.</>
                  }
                </p>

                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '14px 16px', border: '1px solid var(--border-color)' }}>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
                    Minimum Stok Eşiği
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input
                      type="number"
                      min="0"
                      className="form-input"
                      style={{ width: 100 }}
                      value={minStock}
                      onChange={e => setMinStock(Math.max(0, parseInt(e.target.value) || 0))}
                    />
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {minStock > 0
                        ? `${minStock} adet altındaki ürünler gönderilmeyecek`
                        : 'Stok sınırı yok — tüm stoklar gönderilir'}
                    </span>
                  </div>
                  {lowStockCount > 0 && (
                    <div style={{ marginTop: 10, fontSize: 13, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={14} />
                      <span><strong>{lowStockCount} ürün</strong> düşük stok nedeniyle atlanacak</span>
                    </div>
                  )}
                </div>

                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>
                  Ürünler 100'lük partiler halinde gönderilir. Kategori, barkod veya fiyat kuralı eksik ürünler otomatik atlanır.
                </p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={close}>İptal</button>
                <button className="btn btn-primary" onClick={confirm}>Gönder</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
