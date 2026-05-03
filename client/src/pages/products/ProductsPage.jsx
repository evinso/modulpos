import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, Trash2, Edit, Package, CheckSquare, Square,
  TrendingUp, TrendingDown, Tag, Layers, ToggleLeft, ToggleRight,
  DollarSign, Box, Percent, X, AlertTriangle, ChevronDown, FileCode2, Eye
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const BULK_ACTIONS = [
  { group: 'Durum', icon: <ToggleRight size={15} />, actions: [
    { key: 'activate', label: 'Aktif Yap', color: 'var(--success)', needsValue: false },
    { key: 'deactivate', label: 'Pasif Yap', color: 'var(--warning)', needsValue: false },
  ]},
  { group: 'Fiyat', icon: <DollarSign size={15} />, actions: [
    { key: 'price_increase_percent', label: 'Fiyat Artır (%)', needsValue: true, placeholder: 'Yüzde', suffix: '%' },
    { key: 'price_decrease_percent', label: 'Fiyat Düşür (%)', needsValue: true, placeholder: 'Yüzde', suffix: '%' },
    { key: 'price_increase_fixed', label: 'Fiyat Artır (₺)', needsValue: true, placeholder: 'Tutar', suffix: '₺' },
    { key: 'price_decrease_fixed', label: 'Fiyat Düşür (₺)', needsValue: true, placeholder: 'Tutar', suffix: '₺' },
  ]},
  { group: 'Stok', icon: <Box size={15} />, actions: [
    { key: 'set_stock', label: 'Stok Belirle', needsValue: true, placeholder: 'Adet' },
    { key: 'stock_increase', label: 'Stok Artır', needsValue: true, placeholder: 'Adet' },
    { key: 'stock_decrease', label: 'Stok Düşür', needsValue: true, placeholder: 'Adet' },
  ]},
  { group: 'Bilgi', icon: <Tag size={15} />, actions: [
    { key: 'set_category', label: 'Kategori Ata', needsValue: true, placeholder: 'Kategori adı' },
    { key: 'set_brand', label: 'Marka Ata', needsValue: true, placeholder: 'Marka adı' },
    { key: 'set_vat_rate', label: 'KDV Oranı', needsValue: true, placeholder: 'Oran', suffix: '%' },
  ]},
  { group: 'Pazaryeri', icon: <Package size={15} />, actions: [
    { key: 'sync_marketplaces', label: 'Pazaryeri Fiyat/Stok Güncelle', color: 'var(--accent-primary)', needsValue: false },
  ]},
  { group: 'Tehlikeli', icon: <AlertTriangle size={15} />, actions: [
    { key: 'delete', label: 'Seçilenleri Sil', color: 'var(--danger)', needsValue: false, dangerous: true },
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
  const [openGroup, setOpenGroup] = useState(null);
  const [selectAllMode, setSelectAllMode] = useState(false); // true = all products selected (across pages)

  useEffect(() => { fetchProducts(); }, [pagination.page, search]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/products', { params: { page: pagination.page, search } });
      setProducts(res.data.products);
      setPagination(res.data.pagination);
    } catch { toast.error('Ürünler yüklenemedi'); }
    finally { setLoading(false); }
  };

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

  const handleDelete = async (id) => {
    if (!confirm('Bu ürünü silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/products/${id}`);
      toast.success('Ürün silindi');
      fetchProducts();
    } catch { toast.error('Silme hatası'); }
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

        {loading ? (
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
                      <td style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)' }}>{xmlD.sku || p.sku}</td>
                      <td style={{ fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{xmlD.title || p.title}</td>
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
                  <th>SKU</th><th>Ürün Adı</th><th>XML Fiyat</th><th>Satış Fiyatı</th><th>Fark</th><th>Stok</th><th>Marka</th><th>Pazaryeri</th><th>Durum</th><th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const isSelected = selectedIds.has(p.id);
                  const xmlPrice = p.xmlPrice || 0;
                  const salePrice = p.price || 0;
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
                      <td style={{ fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</td>
                      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {xmlPrice > 0 ? `₺${xmlPrice.toLocaleString('tr-TR')}` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>₺{salePrice.toLocaleString('tr-TR')}</td>
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
                              <span key={mp.id} className={`badge badge-${mp.status === 'active' ? 'success' : mp.status === 'rejected' ? 'danger' : 'warning'}`} title={mp.errorMessage || 'Durum: ' + mp.status}>
                                {mp.connection.marketplaceType === 'trendyol' ? 'Trendyol' : mp.connection.marketplaceType}: {mp.status === 'pending' ? 'Bekliyor' : mp.status === 'active' ? 'Aktif' : mp.status === 'rejected' ? 'Hata' : mp.status}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Yok</span>
                        )}
                      </td>
                      <td><span className={`badge ${p.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{p.status === 'active' ? 'Aktif' : 'Pasif'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}><Edit size={14} /></button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id)}><Trash2 size={14} /></button>
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
