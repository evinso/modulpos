import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Search, Trash2, Edit, Package, CheckSquare, Square, X, AlertTriangle, RefreshCw,
  ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Eye, Send, Power, CheckCircle2, Pencil,
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Thumb, Pill, StockPill, StatusPill, MpPills, MP_STATUS, ISSUE_LABELS, parseImages, moneyShort } from './productsUi';
import ProductDetailDrawer from './ProductDetailDrawer';
import ProductFormModal from './ProductFormModal';
import TrendyolLiveView from './TrendyolLiveView';
import SourceGate from './SourceGate';
import PriceModal from './PriceModal';
import { pushToMarketplace, errorText } from './priceActions';

const SORTS = [
  { key: 'createdAt:desc', label: 'En yeni eklenen' },
  { key: 'createdAt:asc', label: 'En eski eklenen' },
  { key: 'updatedAt:desc', label: 'Son güncellenen' },
  { key: 'title:asc', label: 'Ürün adı (A–Z)' },
  { key: 'title:desc', label: 'Ürün adı (Z–A)' },
  { key: 'xmlPrice:asc', label: 'Alış fiyatı (düşükten yükseğe)' },
  { key: 'xmlPrice:desc', label: 'Alış fiyatı (yüksekten düşüğe)' },
  { key: 'stock:asc', label: 'Stok (azdan çoğa)' },
  { key: 'stock:desc', label: 'Stok (çoktan aza)' },
];

const EMPTY_FILTERS = { search: '', xmlSourceId: '', category: '', brand: '', status: '', stockFilter: '', noImage: '', noBarcode: '', mpStatus: '' };

const selectStyle = { width: '100%', padding: '7px 10px', fontSize: 13 };

export default function ProductsPage() {
  const [view, setView] = useState('products'); // products | trendyol

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState('createdAt:desc');
  const [limit, setLimit] = useState(20);
  const [page, setPage] = useState(1);

  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1, page: 1, limit: 20 });
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState(null);
  const [facets, setFacets] = useState({ categories: [], brands: [] });
  const [xmlSources, setXmlSources] = useState([]);
  const [connections, setConnections] = useState([]);
  const [gate, setGate] = useState({ connId: '', xmlId: '' }); // chosen marketplace and XML source: nothing is loaded before both are chosen
  const [optionsReady, setOptionsReady] = useState(false);
  const [priceTarget, setPriceTarget] = useState(null);       // product whose sale price is being edited
  const [pushingId, setPushingId] = useState(null);
  const [mpStats, setMpStats] = useState(null);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [allPagesSelected, setAllPagesSelected] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [formProduct, setFormProduct] = useState(undefined); // undefined = closed, null = new, object = edit
  const [deleteTarget, setDeleteTarget] = useState(null);   // product | 'bulk'
  const [bulkBusy, setBulkBusy] = useState(false);
  const [syncingStatus, setSyncingStatus] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const reqSeq = useRef(0);

  const priceConn = gate.connId;                                                                 // '' = no marketplace (only when none is connected yet)
  const gateReady = optionsReady && (connections.length === 0 || !!gate.connId) && !!gate.xmlId;

  // ───────────── options
  useEffect(() => {
    (async () => {
      try {
        const [x, c] = await Promise.all([api.get('/xml-sources'), api.get('/marketplace/connections')]);
        setXmlSources(x.data); setConnections(c.data);
      } catch { toast.error('Pazaryerleri ve XML kaynakları yüklenemedi'); }
      finally { setOptionsReady(true); }
    })();
  }, []);

  // search is debounced
  useEffect(() => {
    const t = setTimeout(() => { setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput })); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const refreshSummary = useCallback(async () => {
    if (!gateReady) return;
    try {
      const params = { xmlSourceId: gate.xmlId };
      const [s, f] = await Promise.all([api.get('/products/summary', { params }), api.get('/products/facets', { params })]);
      setSummary(s.data); setFacets(f.data);
    } catch { /* cards are optional */ }
  }, [gateReady, gate.xmlId]);
  useEffect(() => { refreshSummary(); }, [refreshSummary]);

  const refreshMpStats = useCallback(async () => {
    if (!gateReady || !priceConn) { setMpStats(null); return; }
    try {
      const params = { connectionId: priceConn, xmlSourceId: gate.xmlId };
      setMpStats((await api.get('/products/stats', { params })).data);
    } catch { /* tabs work without counts */ }
  }, [gateReady, priceConn, gate.xmlId]);
  useEffect(() => { refreshMpStats(); }, [refreshMpStats]);

  // ───────────── list
  const buildParams = useCallback(() => {
    const [sortBy, sortOrder] = sort.split(':');
    const p = { page, limit, sortBy, sortOrder };
    for (const k of ['search', 'category', 'brand', 'status', 'stockFilter', 'noImage', 'noBarcode']) if (filters[k]) p[k] = filters[k];
    if (gate.xmlId) p.xmlSourceId = gate.xmlId;
    if (priceConn) {
      p.priceFor = priceConn;
      if (filters.mpStatus === 'not_sent') p.notSentConnectionId = priceConn;
      else if (filters.mpStatus) { p.connectionId = priceConn; p.marketplaceStatus = filters.mpStatus; }
    }
    return p;
  }, [filters, sort, limit, page, priceConn, gate.xmlId]);

  const fetchProducts = useCallback(async () => {
    if (!gateReady) return; // nothing is loaded before a marketplace and an XML source are chosen
    const my = ++reqSeq.current;
    setLoading(true);
    try {
      const res = await api.get('/products', { params: buildParams() });
      if (my !== reqSeq.current) return;
      setProducts(res.data.products); setPagination(res.data.pagination);
    } catch { if (my === reqSeq.current) toast.error('Ürünler yüklenemedi'); }
    finally { if (my === reqSeq.current) setLoading(false); }
  }, [buildParams, gateReady]);
  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const refreshAll = () => { fetchProducts(); refreshSummary(); refreshMpStats(); };

  const changeFilters = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1); setSelectedIds(new Set()); setAllPagesSelected(false);
  };
  const clearFilters = () => { setSearchInput(''); changeFilters({ ...EMPTY_FILTERS }); };

  // choosing another marketplace / XML source starts the list from scratch
  const resetView = () => { setFilters(EMPTY_FILTERS); setSearchInput(''); setPage(1); setSelectedIds(new Set()); setAllPagesSelected(false); setProducts([]); setSummary(null); setMpStats(null); };
  const pickConn = (id) => { setGate({ connId: id, xmlId: '' }); resetView(); };
  const pickXml = (id) => { setGate((g) => ({ ...g, xmlId: id })); resetView(); };
  const gateXmlName = gate.xmlId === 'none' ? 'Elle eklenen ürünler' : (xmlSources.find((x) => x.id === gate.xmlId)?.name || '');
  const priceConnection = connections.find((c) => c.id === priceConn) || null;

  // send one product's current price to the marketplace (row shortcut)
  const quickPush = async (prod, listing) => {
    setPushingId(prod.id);
    try {
      const r = await pushToMarketplace(prod.id, priceConnection, listing);
      if (r.kind === 'update' || r.kind === 'create') toast.success(r.message); else toast(r.message, { icon: 'ℹ️', duration: 6000 });
      refreshAll();
    } catch (e) { toast.error(errorText(e, 'Gönderilemedi'), { duration: 8000 }); }
    finally { setPushingId(null); }
  };

  const activeChips = useMemo(() => {
    const chips = [];
    if (filters.search) chips.push({ k: 'search', label: `Arama: “${filters.search}”`, clear: () => { setSearchInput(''); } });
    if (filters.category) chips.push({ k: 'category', label: `Kategori: ${filters.category}` });
    if (filters.brand) chips.push({ k: 'brand', label: `Marka: ${filters.brand}` });
    if (filters.status) chips.push({ k: 'status', label: filters.status === 'active' ? 'Yalnızca aktif' : 'Yalnızca pasif' });
    if (filters.stockFilter) chips.push({ k: 'stockFilter', label: { out: 'Stokta yok', low: 'Düşük stok', in: 'Stokta var' }[filters.stockFilter] });
    if (filters.noImage) chips.push({ k: 'noImage', label: 'Görseli olmayanlar' });
    if (filters.noBarcode) chips.push({ k: 'noBarcode', label: 'Barkodu olmayanlar' });
    if (filters.mpStatus) chips.push({ k: 'mpStatus', label: `Pazaryeri: ${filters.mpStatus === 'not_sent' ? 'Gönderilmemiş' : MP_STATUS[filters.mpStatus]?.label}` });
    return chips;
  }, [filters]);

  // ───────────── selection
  const pageIds = products.map((p) => p.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const toggleOne = (id) => setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); setAllPagesSelected(false); return n; });
  const toggleAllOnPage = () => { setAllPagesSelected(false); setSelectedIds((prev) => { const n = new Set(prev); if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; }); };
  const selectEveryMatch = async () => {
    try {
      const p = buildParams(); delete p.page; delete p.limit; delete p.sortBy; delete p.sortOrder; delete p.priceFor;
      const res = await api.get('/products/ids', { params: p });
      setSelectedIds(new Set(res.data.ids)); setAllPagesSelected(true);
    } catch { toast.error('Tüm ürünler seçilemedi'); }
  };
  const clearSelection = () => { setSelectedIds(new Set()); setAllPagesSelected(false); };

  const bulk = async (action) => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await api.post('/products/bulk-action', { action, productIds: [...selectedIds] });
      toast.success(res.data.message || 'İşlem tamamlandı');
      clearSelection(); setDeleteTarget(null); refreshAll();
    } catch (err) { toast.error(err.response?.data?.error || 'İşlem başarısız'); }
    finally { setBulkBusy(false); }
  };

  const confirmDelete = async () => {
    if (deleteTarget === 'bulk') return bulk('delete');
    try {
      await api.delete(`/products/${deleteTarget.id}`);
      toast.success('Ürün silindi'); setDeleteTarget(null); setDetailId(null); refreshAll();
    } catch { toast.error('Silinemedi'); }
  };

  const syncStatuses = async () => {
    setSyncingStatus(true);
    try {
      const trendyol = connections.filter((c) => c.marketplaceType === 'trendyol');
      const agg = { updated: 0, activated: 0, rejected: 0, discovered: 0, passived: 0, revivedPending: 0, batchChecked: 0, fallbackChecked: 0, errors: [], connections: [] };
      for (const conn of trendyol) {
        const d = (await api.post(`/marketplace/connections/${conn.id}/sync-status`)).data;
        for (const k of ['updated', 'activated', 'rejected', 'discovered', 'passived', 'revivedPending', 'batchChecked', 'fallbackChecked']) agg[k] += d[k] || 0;
        agg.errors.push(...(d.errors || [])); agg.connections.push({ name: conn.supplierName || conn.marketplaceType, ...d });
      }
      agg.syncedAt = new Date().toLocaleString('tr-TR');
      setSyncResult(agg); refreshAll();
    } catch { toast.error('Durumlar sorgulanırken hata oluştu'); }
    finally { setSyncingStatus(false); }
  };

  const toggleSort = (field) => {
    const [cur, dir] = sort.split(':');
    setSort(cur === field ? `${field}:${dir === 'asc' ? 'desc' : 'asc'}` : `${field}:asc`);
    setPage(1);
  };
  // plain function (not a component) so it is not re-created on every render
  const sortMark = (field) => {
    const [cur, dir] = sort.split(':');
    if (cur !== field) return null;
    return dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  // The list leaves out the long description, so fetch the full product before editing (saving must never blank it)
  const openEdit = async (prod) => {
    if (prod && 'description' in prod) { setFormProduct(prod); return; }
    try { setFormProduct((await api.get(`/products/${prod.id}`)).data); }
    catch { toast.error('Ürün yüklenemedi'); }
  };

  const connName = connections.find((c) => c.id === priceConn)?.supplierName || connections.find((c) => c.id === priceConn)?.marketplaceType || '';
  const hasPrice = !!priceConn;
  const colCount = hasPrice ? 10 : 8;

  // ───────────── cards
  const cards = summary ? [
    { label: 'Toplam ürün', value: summary.total, color: 'var(--text-primary)', on: () => clearFilters(), active: activeChips.length === 0 },
    { label: 'Aktif', value: summary.active, color: 'var(--success)', on: () => changeFilters({ status: filters.status === 'active' ? '' : 'active' }), active: filters.status === 'active' },
    { label: 'Pasif', value: summary.passive, color: 'var(--text-muted)', on: () => changeFilters({ status: filters.status === 'passive' ? '' : 'passive' }), active: filters.status === 'passive' },
    { label: 'Stokta yok', value: summary.outOfStock, color: 'var(--danger)', on: () => changeFilters({ stockFilter: filters.stockFilter === 'out' ? '' : 'out' }), active: filters.stockFilter === 'out' },
    { label: `Düşük stok (1–${summary.lowStockMax})`, value: summary.lowStock, color: 'var(--warning)', on: () => changeFilters({ stockFilter: filters.stockFilter === 'low' ? '' : 'low' }), active: filters.stockFilter === 'low' },
    { label: 'Görseli yok', value: summary.noImage, color: 'var(--warning)', on: () => changeFilters({ noImage: filters.noImage ? '' : 'true' }), active: !!filters.noImage },
    { label: 'Barkodu yok', value: summary.noBarcode, color: 'var(--warning)', on: () => changeFilters({ noBarcode: filters.noBarcode ? '' : 'true' }), active: !!filters.noBarcode },
  ] : [];

  const mpTabs = [
    { key: '', label: 'Hepsi', count: mpStats?.total, color: 'var(--text-primary)' },
    { key: 'active', label: 'Satışta', count: mpStats?.mpStatus?.active, color: MP_STATUS.active.color },
    { key: 'pending', label: 'Onay bekliyor', count: mpStats?.mpStatus?.pending, color: MP_STATUS.pending.color },
    { key: 'rejected', label: 'Reddedildi', count: mpStats?.mpStatus?.rejected, color: MP_STATUS.rejected.color },
    { key: 'passive', label: 'Kaldırıldı', count: mpStats?.mpStatus?.passive, color: MP_STATUS.passive.color },
    { key: 'not_sent', label: 'Gönderilmemiş', count: mpStats?.mpStatus?.not_sent, color: 'var(--text-muted)' },
  ];

  const from = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const to = Math.min(pagination.total, pagination.page * pagination.limit);
  const pageWindow = (() => {
    const total = pagination.totalPages, cur = pagination.page, set = new Set([1, total, cur, cur - 1, cur + 1, cur - 2, cur + 2]);
    return [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  })();

  return (
    <div>
      {/* ───────────── header */}
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Ürünler</h1>
          <p>Ürünlerinizi arayın, filtreleyin, fiyatını ve pazaryeri durumunu görün. Bir ürüne tıklayınca tüm detayları açılır.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={syncStatuses} disabled={syncingStatus}>
            <RefreshCw size={16} className={syncingStatus ? 'spinning' : ''} /> {syncingStatus ? 'Sorgulanıyor…' : 'Pazaryeri durumlarını sorgula'}
          </button>
          <button className="btn btn-primary" onClick={() => setFormProduct(null)}><Plus size={16} /> Yeni ürün</button>
        </div>
      </div>

      {/* view switch */}
      <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', borderRadius: 10, padding: 3, marginBottom: 16 }}>
        {[['products', 'Ürünlerim'], ['trendyol', 'Trendyol’daki canlı liste']].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} style={{
            padding: '7px 16px', fontSize: 13, borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: view === k ? 700 : 500,
            background: view === k ? 'var(--bg-card)' : 'transparent', color: view === k ? 'var(--text-primary)' : 'var(--text-secondary)',
            boxShadow: view === k ? '0 1px 4px rgba(0,0,0,0.25)' : 'none',
          }}>{label}</button>
        ))}
      </div>

      {view === 'trendyol' ? <TrendyolLiveView connections={connections} /> : !optionsReady ? (
        <div className="loading-spinner" style={{ padding: 60 }}><div className="spinner"></div></div>
      ) : !gateReady ? (
        <SourceGate connections={connections} xmlSources={xmlSources} connId={gate.connId} xmlId={gate.xmlId} onPickConn={pickConn} onPickXml={pickXml} />
      ) : (
        <>
          {/* ───────────── what this screen is showing */}
          <div className="card" data-testid="context-bar" style={{ padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            {connections.length > 0 && (
              <span>Pazaryeri: <strong>{connName}</strong>{' '}
                <button type="button" data-testid="change-conn" onClick={() => setGate({ connId: '', xmlId: '' })} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 12 }}>Değiştir</button>
              </span>
            )}
            <span>XML: <strong>{gateXmlName}</strong>{' '}
              <button type="button" data-testid="change-xml" onClick={() => setGate((g) => ({ ...g, xmlId: '' }))} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 12 }}>Değiştir</button>
            </span>
          </div>

          {/* ───────────── summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
            {cards.map((c) => (
              <button key={c.label} onClick={c.on} className="card" style={{
                textAlign: 'left', padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit',
                border: c.active ? `2px solid ${c.color}` : undefined, color: 'inherit',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: c.value > 0 ? c.color : 'var(--text-muted)' }}>{c.value}</div>
              </button>
            ))}
          </div>

          {/* ───────────── filters */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.6fr) repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
              <div>
                <label className="form-label" style={{ fontSize: 11 }}>Ara</label>
                <div className="header-search" style={{ width: '100%' }}>
                  <Search size={14} className="search-icon" />
                  <input type="text" placeholder="Ürün adı, SKU veya barkod…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
                </div>
              </div>
              <div><label className="form-label" style={{ fontSize: 11 }}>Kategori</label>
                <select className="form-select" style={selectStyle} value={filters.category} onChange={(e) => changeFilters({ category: e.target.value })}>
                  <option value="">Hepsi</option>
                  {filters.category && !facets.categories.some((c) => c.name === filters.category) && <option value={filters.category}>{filters.category}</option>}
                  {facets.categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
                </select></div>
              <div><label className="form-label" style={{ fontSize: 11 }}>Marka</label>
                <select className="form-select" style={selectStyle} value={filters.brand} onChange={(e) => changeFilters({ brand: e.target.value })}>
                  <option value="">Hepsi</option>
                  {filters.brand && !facets.brands.some((b) => b.name === filters.brand) && <option value={filters.brand}>{filters.brand}</option>}
                  {facets.brands.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.count})</option>)}
                </select></div>
              <div><label className="form-label" style={{ fontSize: 11 }}>Stok</label>
                <select className="form-select" style={selectStyle} value={filters.stockFilter} onChange={(e) => changeFilters({ stockFilter: e.target.value })}>
                  <option value="">Hepsi</option><option value="in">Stokta var (6+)</option><option value="low">Düşük stok (1–5)</option><option value="out">Stokta yok</option>
                </select></div>
              <div><label className="form-label" style={{ fontSize: 11 }}>Durum</label>
                <select className="form-select" style={selectStyle} value={filters.status} onChange={(e) => changeFilters({ status: e.target.value })}>
                  <option value="">Hepsi</option><option value="active">Aktif</option><option value="passive">Pasif</option>
                </select></div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                <label className="form-label" style={{ fontSize: 12, margin: 0 }}>Sırala:</label>
                <select className="form-select" style={{ ...selectStyle, width: 230 }} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {activeChips.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Uygulanan filtreler:</span>
                {activeChips.map((c) => (
                  <button key={c.k} onClick={() => (c.clear ? c.clear() : changeFilters({ [c.k]: '' }))} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 14, fontSize: 12, cursor: 'pointer',
                    background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: 'var(--accent-primary)',
                  }}>{c.label} <X size={11} /></button>
                ))}
                <button onClick={clearFilters} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>Hepsini temizle</button>
              </div>
            )}
          </div>

          {/* ───────────── table */}
          <div className="table-container">
            {hasPrice && (
              <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--border-color)', paddingLeft: 12 }}>
                {mpTabs.map((t) => {
                  const active = filters.mpStatus === t.key;
                  return (
                    <button key={t.key} onClick={() => changeFilters({ mpStatus: t.key })} style={{
                      padding: '10px 14px', fontSize: 13, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap', cursor: 'pointer', background: 'none', border: 'none',
                      color: active ? t.color : 'var(--text-secondary)', borderBottom: active ? `2px solid ${t.color}` : '2px solid transparent',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      {t.label}
                      {t.count != null && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: active ? t.color : 'var(--bg-tertiary)', color: active ? '#fff' : 'var(--text-muted)' }}>{t.count}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* selection notice */}
            {allOnPage && !allPagesSelected && pagination.total > products.length && (
              <div style={{ padding: '9px 16px', textAlign: 'center', fontSize: 13, background: 'rgba(59,130,246,0.08)', borderBottom: '1px solid var(--border-color)' }}>
                Bu sayfadaki <strong>{products.length}</strong> ürün seçili. <button onClick={selectEveryMatch} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>Filtreye uyan tüm {pagination.total} ürünü seç</button>
              </div>
            )}
            {allPagesSelected && (
              <div style={{ padding: '9px 16px', textAlign: 'center', fontSize: 13, background: 'rgba(16,185,129,0.08)', color: 'var(--success)', borderBottom: '1px solid var(--border-color)' }}>
                ✓ Filtreye uyan tüm <strong>{selectedIds.size}</strong> ürün seçili.
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40, textAlign: 'center' }}>
                      <button onClick={toggleAllOnPage} aria-label="Sayfadakilerin hepsini seç" style={{ background: 'none', border: 'none', cursor: 'pointer', color: allOnPage ? 'var(--accent-primary)' : 'var(--text-muted)', padding: 0 }}>
                        {allOnPage ? <CheckSquare size={17} /> : <Square size={17} />}
                      </button>
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('title')}>Ürün {sortMark('title')}</th>
                    <th>Kategori / marka</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('xmlPrice')}>Alış {sortMark('xmlPrice')}</th>
                    {hasPrice && <th title={`${connName} için hesaplanan satış fiyatı ve net kazanç`}>Satış / kâr</th>}
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('stock')}>Stok {sortMark('stock')}</th>
                    <th>Pazaryeri</th>
                    {hasPrice && <th title="Pazaryerine gönderilmeye hazır mı?">Hazırlık</th>}
                    <th>Durum</th>
                    <th style={{ width: 110 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={colCount}><div className="loading-spinner" style={{ padding: 40 }}><div className="spinner"></div></div></td></tr>
                  ) : products.length === 0 ? (
                    <tr><td colSpan={colCount}>
                      <div className="empty-state" style={{ padding: '40px 0' }}>
                        <Package size={44} className="empty-icon" />
                        {activeChips.length ? (<><h3>Bu filtrelere uyan ürün yok</h3><button className="btn btn-secondary" onClick={clearFilters}>Filtreleri temizle</button></>)
                          : (<><h3>Henüz ürün yok</h3><p>Bir XML kaynağı ekleyip ürünleri çekin ya da elle ürün ekleyin.</p><button className="btn btn-primary" onClick={() => setFormProduct(null)}><Plus size={16} /> Ürün ekle</button></>)}
                      </div>
                    </td></tr>
                  ) : products.map((p) => {
                    const sel = selectedIds.has(p.id);
                    const pr = p.pricing;
                    const img = parseImages(p.images)[0];
                    return (
                      <tr key={p.id} style={{ cursor: 'pointer', background: sel ? 'rgba(59,130,246,0.08)' : undefined }}
                        onClick={(e) => { if (!e.target.closest('button, a, input')) setDetailId(p.id); }}>
                        <td style={{ textAlign: 'center' }}>
                          <button onClick={() => toggleOne(p.id)} aria-label="Seç" style={{ background: 'none', border: 'none', cursor: 'pointer', color: sel ? 'var(--accent-primary)' : 'var(--text-muted)', padding: 0 }}>
                            {sel ? <CheckSquare size={17} /> : <Square size={17} />}
                          </button>
                        </td>
                        <td style={{ minWidth: 260, maxWidth: 360 }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <Thumb src={img} size={42} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.title}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>
                                {p.sku}{p.barcode && p.barcode !== p.sku ? ` · ${p.barcode}` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ maxWidth: 190 }}>
                          <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.category || ''}>{p.category ? p.category.split('|').filter(Boolean).pop() : <span style={{ color: 'var(--warning)' }}>Kategori yok</span>}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.brand || 'Marka yok'}</div>
                        </td>
                        <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                          {p.xmlPrice > 0 ? `₺${moneyShort(p.xmlPrice)}` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          {p.xmlSource && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.xmlSource.name}</div>}
                        </td>
                        {hasPrice && (() => {
                          const listing = (p.marketplaceProducts || []).find((m) => m.connectionId === priceConn) || null;
                          const differs = !!(listing && listing.status === 'active' && listing.marketplacePrice != null && pr?.salePrice != null && Math.abs(listing.marketplacePrice - pr.salePrice) > 0.005);
                          return (
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {pr?.salePrice != null ? (
                                <>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent-primary)' }}>₺{moneyShort(pr.salePrice)}</span>
                                    {pr.manual && <Pill color="var(--warning)" title={`Elle girildi. Şablon fiyatı: ${pr.templatePrice != null ? '₺' + moneyShort(pr.templatePrice) : 'yok'}`}>Elle</Pill>}
                                    <button type="button" className="btn btn-secondary btn-sm" data-testid={`edit-price-${p.id}`} title="Satış fiyatını değiştir" aria-label="Satış fiyatını değiştir" onClick={() => setPriceTarget(p)} style={{ padding: '2px 6px' }}><Pencil size={12} /></button>
                                  </div>
                                  {pr.profit != null && <div style={{ fontSize: 11, color: pr.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{pr.profit >= 0 ? '+' : ''}₺{moneyShort(pr.profit)} kâr</div>}
                                  {differs && (
                                    <div style={{ fontSize: 11, color: 'var(--warning)', display: 'flex', gap: 6, alignItems: 'center' }}>
                                      {connName}’da ₺{moneyShort(listing.marketplacePrice)}
                                      <button type="button" className="btn btn-secondary btn-sm" data-testid={`push-price-${p.id}`} disabled={pushingId === p.id} onClick={() => quickPush(p, listing)} title="Bu fiyatı pazaryerine gönder" style={{ padding: '1px 6px', fontSize: 11 }}>
                                        <Send size={10} /> {pushingId === p.id ? '…' : 'Gönder'}
                                      </button>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Pill color="var(--danger)" title="Bu ürüne uyan fiyat şablonu yok">Şablon yok</Pill>
                                  <button type="button" className="btn btn-secondary btn-sm" data-testid={`edit-price-${p.id}`} title="Satış fiyatını elle gir" aria-label="Satış fiyatını elle gir" onClick={() => setPriceTarget(p)} style={{ padding: '2px 6px' }}><Pencil size={12} /></button>
                                </div>
                              )}
                            </td>
                          );
                        })()}
                        <td><StockPill stock={p.stock} /></td>
                        <td style={{ maxWidth: 200 }}><MpPills list={p.marketplaceProducts} /></td>
                        {hasPrice && (
                          <td>
                            {pr?.ready ? <Pill color="var(--success)"><CheckCircle2 size={11} /> Hazır</Pill> : pr ? (
                              <Pill color="var(--danger)" title={pr.issues.map((i) => ISSUE_LABELS[i.code] || i.message).join('\n')}>
                                <AlertTriangle size={11} /> {pr.issues.length} sorun
                              </Pill>
                            ) : '—'}
                          </td>
                        )}
                        <td><StatusPill status={p.status} /></td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-secondary btn-sm" title="Detay" onClick={() => setDetailId(p.id)}><Eye size={14} /></button>
                            <button className="btn btn-secondary btn-sm" title="Düzenle" onClick={() => openEdit(p)}><Edit size={14} /></button>
                            <button className="btn btn-danger btn-sm" title="Sil" onClick={() => setDeleteTarget(p)}><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* pagination */}
            {pagination.total > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {from}–{to} / <strong>{pagination.total}</strong> ürün
                  <select className="form-select" style={{ width: 110, padding: '4px 8px', fontSize: 12, marginLeft: 12, display: 'inline-block' }} value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>
                    {[20, 50, 100].map((n) => <option key={n} value={n}>{n} / sayfa</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button className="btn btn-secondary btn-sm" disabled={pagination.page <= 1} onClick={() => setPage(pagination.page - 1)}><ChevronLeft size={14} /></button>
                  {pageWindow.map((n, i) => (
                    <span key={n} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      {i > 0 && n - pageWindow[i - 1] > 1 && <span style={{ color: 'var(--text-muted)' }}>…</span>}
                      <button className={`btn btn-sm ${n === pagination.page ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPage(n)} style={{ minWidth: 32 }}>{n}</button>
                    </span>
                  ))}
                  <button className="btn btn-secondary btn-sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(pagination.page + 1)}><ChevronRight size={14} /></button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ───────────── selection bar */}
      {selectedIds.size > 0 && view === 'products' && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 900, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          background: 'var(--bg-card)', border: '1px solid var(--accent-primary)', borderRadius: 14, padding: '10px 16px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', maxWidth: '95vw',
        }}>
          <strong style={{ fontSize: 14 }}>{selectedIds.size} ürün seçili</strong>
          <button className="btn btn-secondary btn-sm" disabled={bulkBusy} onClick={() => bulk('activate')}><Power size={14} /> Aktif yap</button>
          <button className="btn btn-secondary btn-sm" disabled={bulkBusy} onClick={() => bulk('deactivate')}><Power size={14} /> Pasif yap</button>
          {connections.some((c) => c.marketplaceType === 'trendyol') && (
            <button className="btn btn-secondary btn-sm" disabled={bulkBusy} onClick={() => bulk('sync_marketplaces')} title="Seçili ürünlerin fiyat ve stoğunu, daha önce gönderildikleri pazaryerlerinde günceller">
              <Send size={14} /> Pazaryerinde fiyat/stok güncelle
            </button>
          )}
          <button className="btn btn-danger btn-sm" disabled={bulkBusy} onClick={() => setDeleteTarget('bulk')}><Trash2 size={14} /> Sil</button>
          <button onClick={clearSelection} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>Seçimi temizle</button>
        </div>
      )}

      {/* ───────────── panels & dialogs */}
      {detailId && (
        <ProductDetailDrawer
          productId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(prod) => openEdit(prod)}
          onDelete={(prod) => setDeleteTarget(prod)}
        />
      )}

      {priceTarget && priceConnection && (
        <PriceModal product={priceTarget} connection={priceConnection} onClose={() => setPriceTarget(null)} onDone={() => { setPriceTarget(null); refreshAll(); }} />
      )}

      {formProduct !== undefined && (
        <ProductFormModal product={formProduct} onClose={() => setFormProduct(undefined)} onSaved={() => { setFormProduct(undefined); refreshAll(); if (detailId) { const id = detailId; setDetailId(null); setTimeout(() => setDetailId(id), 0); } }} />
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)} style={{ zIndex: 1100 }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3 style={{ color: 'var(--danger)', display: 'flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={20} /> Silme onayı</h3>
              <button className="modal-close" onClick={() => setDeleteTarget(null)}>×</button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 15 }}>{deleteTarget === 'bulk' ? <><strong>{selectedIds.size}</strong> ürün silinecek.</> : <><strong>{deleteTarget.title}</strong> silinecek.</>}</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Bu işlem geri alınamaz. XML’den gelen ürünler bir sonraki senkronda yeniden eklenebilir.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Vazgeç</button>
              <button className="btn btn-danger" onClick={confirmDelete} disabled={bulkBusy}>Evet, sil</button>
            </div>
          </div>
        </div>
      )}

      {syncResult && (
        <div className="modal-overlay" onClick={() => setSyncResult(null)} style={{ zIndex: 1100 }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><RefreshCw size={18} style={{ color: 'var(--accent-primary)' }} /> Durum sorgulama sonucu</h3>
              <button className="modal-close" onClick={() => setSyncResult(null)}>×</button>
            </div>
            <div className="modal-body" style={{ padding: '18px 22px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>🕐 {syncResult.syncedAt}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
                {[
                  ['Güncellenen', syncResult.updated, 'var(--accent-primary)'], ['Satışa geçen', syncResult.activated, 'var(--success)'],
                  ['Reddedilen', syncResult.rejected, 'var(--danger)'], ['Trendyol’da bulunan', syncResult.discovered, 'var(--warning)'],
                  ['Kaldırılan', syncResult.passived || 0, '#f97316'], ['Onay bekliyor', syncResult.revivedPending || 0, 'var(--warning)'],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: v > 0 ? c : 'var(--text-muted)' }}>{v}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{l}</div>
                  </div>
                ))}
              </div>
              {syncResult.errors.length > 0 && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', marginBottom: 6 }}>⚠ Hatalar ({syncResult.errors.length})</div>
                  {syncResult.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3 }}>• {e}</div>)}
                </div>
              )}
              {syncResult.updated === 0 && syncResult.discovered === 0 && !syncResult.passived && !syncResult.revivedPending && syncResult.errors.length === 0 && (
                <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>Tüm durumlar güncel, değişen ürün yok.</div>
              )}
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setSyncResult(null)}>Kapat</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
