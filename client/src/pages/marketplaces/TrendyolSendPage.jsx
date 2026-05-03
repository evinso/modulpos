import { useState, useEffect } from 'react';
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
  const [mappings, setMappings] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all'); // all, ready, missing
  const [xmlSources, setXmlSources] = useState([]);
  const [filterXmlSource, setFilterXmlSource] = useState('');

  useEffect(() => { fetchConnections(); fetchXmlSources(); }, []);
  useEffect(() => { if (selectedConn) { fetchProducts(); fetchMappings(); } }, [selectedConn, pagination.page, search, filterXmlSource]);

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
      setMappings(res.data);
    } catch {}
  };

  const mappedCategories = mappings.reduce((acc, m) => { acc[m.localCategory] = m; return acc; }, {});

  const getProductStatus = (p) => {
    const hasCategoryMapping = p.category && mappedCategories[p.category];
    const hasBarcode = !!p.barcode;
    const hasPrice = p.price > 0;
    if (hasCategoryMapping && hasBarcode && hasPrice) return 'ready';
    return 'missing';
  };

  const filteredProducts = filterStatus === 'all'
    ? products
    : products.filter(p => getProductStatus(p) === filterStatus);

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

  const handleSendToMarketplace = async () => {
    if (!selectedConn || selectedIds.size === 0) return;
    setSending(true);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/send-products`, {
        productIds: Array.from(selectedIds)
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
            className="btn btn-primary"
            onClick={handleSendToMarketplace}
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
              const catMapping = p.category ? mappedCategories[p.category] : null;
              const issues = [];
              if (!p.barcode) issues.push('Barkod yok');
              if (!p.price || p.price <= 0) issues.push('Fiyat yok');
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
                  <td style={{ fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</td>
                  <td style={{ fontWeight: 600 }}>₺{(p.price || 0).toLocaleString('tr-TR')}</td>
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
                      <span className="badge badge-success" style={{ fontSize: 11 }}>✓ Hazır</span>
                    ) : (
                      <span className="badge badge-warning" style={{ fontSize: 11 }} title={issues.join(', ')}>
                        {issues.length} eksik
                      </span>
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
    </div>
  );
}
