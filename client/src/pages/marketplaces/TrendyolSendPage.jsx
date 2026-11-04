import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Send, Search, CheckSquare, Square, Package, AlertCircle,
  RefreshCw, Filter, X, Check, Clock, Ban, Sparkles
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import LoadingOverlay from '../../components/LoadingOverlay';
import SendSettingsPanel from './SendSettingsPanel';

const MP_STATUS = {
  active:  { label: 'Aktif',    color: 'var(--success)',      bg: 'rgba(16,185,129,0.1)',  icon: <Check size={11} /> },
  pending: { label: 'Bekliyor', color: 'var(--warning)',      bg: 'rgba(245,158,11,0.1)',  icon: <Clock size={11} /> },
  rejected:{ label: 'Reddedildi', color: 'var(--danger)',    bg: 'rgba(239,68,68,0.1)',   icon: <X size={11} /> },
  passive: { label: 'Kaldırıldı', color: '#f97316',          bg: 'rgba(249,115,22,0.1)',  icon: <Ban size={11} /> },
};

// Reasons the server validator can give for blocking a product
const ISSUE_LABELS = {
  no_category_mapping: 'Kategori eşleşmesi yok',
  bad_barcode: 'Barkod hatalı',
  duplicate_barcode: 'Tekrarlı barkod',
  no_price_rule: 'Fiyat şablonu yok',
  invalid_price: 'Fiyat geçersiz',
  price_below_cost: 'Fiyat alışın altında',
  title_empty: 'Başlık boş',
  title_too_long: 'Başlık çok uzun',
  no_description: 'Açıklama yok',
  description_too_long: 'Açıklama çok uzun',
  no_image: 'Görsel yok',
  bad_vat: 'KDV hatalı',
  bad_stock: 'Stok hatalı',
  rejected_by_marketplace: 'Trendyol reddetti',
  missing_attributes: 'Zorunlu özellik eksik',
  low_stock: 'Stok eşiğinin altında',
  no_brand: 'Marka yok',
  excluded_by_settings: 'Gönderim ayarlarına takıldı',
};

export default function TrendyolSendPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [syncingStatus, setSyncingStatus] = useState(false);
  const [showSendModal, setShowSendModal] = useState(null); // 'all' | 'selected'
  const [minStock, setMinStock] = useState(0);
  const [sendResult, setSendResult] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [filterReadiness, setFilterReadiness] = useState('all'); // all | ready | blocked
  const [filterIssue, setFilterIssue] = useState('');
  const [filterMpStatus, setFilterMpStatus] = useState('all'); // all | not_sent | active | pending | rejected | passive
  const [xmlSources, setXmlSources] = useState([]);
  const [filterXmlSource, setFilterXmlSource] = useState('');
  const [filterCategories, setFilterCategories] = useState(new Set());
  const requestSeq = useRef(0);

  useEffect(() => { fetchConnections(); fetchXmlSources(); }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // any filter change goes back to page 1
  useEffect(() => {
    setPagination(p => (p.page === 1 ? p : { ...p, page: 1 }));
  }, [debouncedSearch, filterXmlSource, filterCategories, filterReadiness, filterIssue, filterMpStatus, selectedConn]);

  useEffect(() => {
    if (selectedConn) fetchProducts();
  }, [selectedConn, pagination.page, debouncedSearch, filterXmlSource, filterCategories, filterReadiness, filterIssue, filterMpStatus]);

  useEffect(() => {
    if (selectedConn) fetchMappings();
  }, [selectedConn, filterXmlSource]);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      setConnections(res.data);
      if (res.data.length > 0) setSelectedConn(res.data[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const fetchXmlSources = async () => {
    try { const res = await api.get('/xml-sources'); setXmlSources(res.data); } catch {}
  };

  // One request returns the page, the filtered total and the stats – the server does filtering,
  // validation and price calculation, the browser only renders.
  const fetchProducts = async (fresh = false) => {
    const my = ++requestSeq.current;
    setListLoading(true);
    try {
      const params = { page: pagination.page, limit: 20 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterXmlSource) params.xmlSourceId = filterXmlSource;
      if (filterCategories.size > 0) params.categories = [...filterCategories].join(',');
      if (filterReadiness !== 'all') params.readiness = filterReadiness;
      if (filterIssue) params.issue = filterIssue;
      if (filterMpStatus !== 'all') params.mpStatus = filterMpStatus;
      if (fresh) params.fresh = 1;
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/product-list`, { params });
      if (my !== requestSeq.current) return; // a newer request superseded this one
      setProducts(res.data.products);
      setStats(res.data.stats);
      setPagination(p => ({ ...p, total: res.data.pagination.total, totalPages: res.data.pagination.totalPages }));
    } catch { if (my === requestSeq.current) toast.error('Ürünler yüklenemedi'); }
    finally { if (my === requestSeq.current) setListLoading(false); }
  };

  const fetchMappings = async () => {
    if (!selectedConn) return;
    try {
      // mappings belong to an XML source: with a source selected only its mappings are shown
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/category-mappings`, { params: filterXmlSource ? { xmlSourceId: filterXmlSource } : {} });
      setMappings(res.data);
    } catch {}
  };

  const getMp = (p) => p.marketplaceProducts?.find(m => m.connectionId === selectedConn?.id) || null;

  const resetFilters = () => { setFilterReadiness('all'); setFilterIssue(''); setFilterMpStatus('all'); };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const readyIds = products.filter(p => p.ready).map(p => p.id);
    const allSelected = readyIds.length > 0 && readyIds.every(id => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(readyIds));
  };

  const handleSendAll = async () => {
    setSendingAll(true);
    setShowSendModal(null);
    setSendResult(null);
    try {
      const body = { minStock };
      if (filterXmlSource) body.xmlSourceId = filterXmlSource;
      if (filterCategories.size > 0) body.localCategories = [...filterCategories];
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/send-all-ready`, body);
      setSendResult({ type: 'all', ...res.data, sentAt: new Date().toLocaleString('tr-TR') });
      toast.success(`${res.data.sent} ürün gönderildi`);
      fetchProducts(true);
    } catch (err) {
      const d = err.response?.data;
      if (d?.skipReasons) setSendResult({ type: 'all', sent: 0, skipped: d.skipped, skipReasons: d.skipReasons, batches: 0, sentAt: new Date().toLocaleString('tr-TR') });
      toast.error(d?.error || d?.message || 'Toplu gönderme hatası', { duration: 8000 });
    } finally { setSendingAll(false); }
  };

  const handleSendSelected = async () => {
    setShowSendModal(null);
    setSending(true);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/send-products`, {
        productIds: Array.from(selectedIds), minStock,
      });
      setSendResult({ type: 'selected', sent: selectedIds.size, batches: res.data.batches || 1, skipped: 0, sentAt: new Date().toLocaleString('tr-TR'), message: res.data.message });
      toast.success(res.data.message || `${selectedIds.size} ürün gönderildi`);
      setSelectedIds(new Set());
      fetchProducts(true);
    } catch (err) {
      const d = err.response?.data;
      toast.error(d?.message || d?.error || 'Gönderme hatası', { duration: 8000 });
    } finally { setSending(false); }
  };

  const syncMarketplaceStatus = async () => {
    setSyncingStatus(true);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/sync-status`);
      fetchProducts(true);
      const d = res.data;
      toast.success(`Güncellendi: ${d.activated || 0} aktif, ${d.rejected || 0} reddedildi, ${d.passived || 0} kaldırıldı`);
    } catch { toast.error('Durum sorgulanamadı'); }
    finally { setSyncingStatus(false); }
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
      } catch {}
    }
    return null;
  };

  // Categories on this page that have no marketplace mapping
  const unmappedCategories = useMemo(() => {
    const cats = new Set();
    for (const p of products) {
      if (p.category && p.issues?.some(i => i.code === 'no_category_mapping')) cats.add(p.category);
    }
    return [...cats].sort();
  }, [products]);

  const totalCount   = stats?.total ?? 0;
  const readyCount   = stats?.ready ?? 0;
  const blockedCount = stats?.blocked ?? 0;
  const mpCount = (k) => stats?.mp?.[k] ?? 0;
  const issueEntries = Object.entries(stats?.byIssue || {}).sort((a, b) => b[1] - a[1]);
  const hasFilter = filterReadiness !== 'all' || filterMpStatus !== 'all' || !!filterIssue;

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Trendyol'a Gönder</h1></div>
        <div className="card"><div className="empty-state"><AlertCircle size={48} className="empty-icon" /><h3>Pazaryeri bağlantısı bulunamadı</h3><p>Önce Pazaryerleri sayfasından bir bağlantı oluşturun</p></div></div>
      </div>
    );
  }

  return (
    <div>
      <LoadingOverlay visible={sending} message="Ürünler Gönderiliyor..." submessage="Trendyol'a toplu istek gönderiliyor, lütfen bekleyin." />
      <LoadingOverlay visible={sendingAll} message="Tüm Ürünler Gönderiliyor..." submessage="Gönderilebilir tüm ürünler işleniyor, lütfen bekleyin." />

      {/* Header */}
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Trendyol'a Gönder</h1>
          <p>Ürünlerinizi Trendyol mağazanıza gönderin ve durumlarını takip edin</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {connections.length > 1 && (
            <select className="form-select" style={{ width: 200 }}
              value={selectedConn?.id || ''}
              onChange={e => { setSelectedConn(connections.find(c => c.id === e.target.value)); setSelectedIds(new Set()); }}
            >
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.marketplaceType}</option>)}
            </select>
          )}
          <button className="btn btn-secondary" onClick={syncMarketplaceStatus} disabled={syncingStatus || !selectedConn}>
            <RefreshCw size={15} className={syncingStatus ? 'spinning' : ''} />
            {syncingStatus ? 'Sorgulanıyor...' : 'Durumları Sorgula'}
          </button>
          <button className="btn btn-secondary" onClick={() => setShowSendModal('all')} disabled={sendingAll || sending || !selectedConn}>
            <Send size={15} /> Tümünü Gönder
          </button>
          <button className="btn btn-primary" onClick={() => setShowSendModal('selected')} disabled={sending || sendingAll || selectedIds.size === 0}>
            <Send size={15} /> Seçilenleri Gönder ({selectedIds.size})
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Toplam', value: totalCount, color: 'var(--text-primary)', reset: true },
          { label: 'Gönderilebilir', value: readyCount, color: 'var(--success)', field: 'readiness', filter: 'ready' },
          { label: 'Engelli', value: blockedCount, color: 'var(--danger)', field: 'readiness', filter: 'blocked' },
          { label: 'Trendyol Aktif', value: mpCount('active'), color: 'var(--success)', field: 'mp', filter: 'active' },
          { label: 'Bekliyor', value: mpCount('pending'), color: 'var(--warning)', field: 'mp', filter: 'pending' },
          { label: 'Reddedildi', value: mpCount('rejected'), color: 'var(--danger)', field: 'mp', filter: 'rejected' },
          { label: 'Kaldırıldı', value: mpCount('passive'), color: '#f97316', field: 'mp', filter: 'passive' },
        ].map(c => {
          const isActive = c.field === 'readiness' ? filterReadiness === c.filter : c.field === 'mp' ? filterMpStatus === c.filter : false;
          return (
            <div key={c.label} className="card"
              style={{ padding: '12px 14px', cursor: 'pointer', border: isActive ? `2px solid ${c.color}` : undefined, transition: 'border 0.15s' }}
              onClick={() => {
                if (c.reset) { resetFilters(); return; }
                setFilterIssue('');
                if (c.field === 'readiness') setFilterReadiness(p => p === c.filter ? 'all' : c.filter);
                else setFilterMpStatus(p => p === c.filter ? 'all' : c.filter);
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 500 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: c.value > 0 ? c.color : 'var(--text-muted)' }}>{c.value}</div>
            </div>
          );
        })}
      </div>

      {/* Category mapping panel */}
      {(unmappedCategories.length > 0 || mappings.length > 0) && (
        <div style={{
          background: unmappedCategories.length > 0 ? 'rgba(245,158,11,0.06)' : 'rgba(16,185,129,0.05)',
          border: `1px solid ${unmappedCategories.length > 0 ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.25)'}`,
          borderRadius: 10, padding: '14px 18px', marginBottom: 14
        }}>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 8 }}>
                Kategori Eşlemeleri ({mappings.length})
                {filterCategories.size > 0 && (
                  <button onClick={() => setFilterCategories(new Set())} style={{ fontSize: 10, color: 'var(--accent-primary)', background: 'rgba(99,102,241,0.1)', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, textTransform: 'none', letterSpacing: 0 }}>
                    {filterCategories.size} seçili — temizle ✕
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {mappings.length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Henüz eşleme yok</span>
                ) : mappings.slice(0, 20).map(m => {
                  const selected = filterCategories.has(m.localCategory);
                  const trendyolName = m.marketplaceCategoryName?.split(' > ').pop() || m.marketplaceCategoryName || '';
                  return (
                    <button key={m.id} onClick={() => {
                      setPagination(p => ({ ...p, page: 1 }));
                      setFilterCategories(prev => { const next = new Set(prev); next.has(m.localCategory) ? next.delete(m.localCategory) : next.add(m.localCategory); return next; });
                    }} title={`XML: ${m.localCategory}\nTrendyol: ${m.marketplaceCategoryName || ''}`}
                      style={{ background: selected ? 'rgba(99,102,241,0.15)' : 'rgba(16,185,129,0.08)', border: selected ? '1px solid var(--accent-primary)' : '1px solid rgba(16,185,129,0.3)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: selected ? 'var(--accent-primary)' : 'var(--success)', fontWeight: 600 }}>{m.localCategory}</span>
                      {trendyolName && <span style={{ fontSize: 10, color: selected ? 'var(--accent-primary)' : 'var(--text-muted)' }}>→ {trendyolName}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            {unmappedCategories.length > 0 && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Eşleşmeyen Kategoriler ({unmappedCategories.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                  {unmappedCategories.map(cat => (
                    <span key={cat} style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontFamily: 'monospace' }}>{cat}</span>
                  ))}
                </div>
                <a href="/category-mapping" style={{ fontSize: 12, color: 'var(--accent-primary)' }}>Kategori Eşleştirme sayfasına git →</a>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedConn && <SendSettingsPanel connectionId={selectedConn.id} onSaved={() => fetchProducts(true)} />}

      {/* Why products are blocked (server validator) */}
      {issueEntries.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '12px 18px', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--danger)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Gönderimi engelleyen nedenler — tıklayınca ilgili ürünler listelenir
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {issueEntries.map(([code, n]) => {
              const active = filterIssue === code;
              return (
                <button key={code} onClick={() => { setFilterIssue(active ? '' : code); setFilterReadiness(active ? 'all' : 'blocked'); }}
                  style={{ background: active ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.08)', color: 'var(--danger)', border: active ? '1px solid var(--danger)' : '1px solid transparent', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {ISSUE_LABELS[code] || code}: <strong>{n}</strong>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="table-container">
        <div className="table-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ margin: 0 }}>Ürünler ({pagination.total}){listLoading && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>yükleniyor…</span>}</h3>
            {hasFilter && (
              <button onClick={resetFilters}
                style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
                <Filter size={11} /> Filtreyi Temizle
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="form-select" style={{ width: 160, fontSize: 13, padding: '6px 10px' }} value={filterXmlSource} onChange={e => setFilterXmlSource(e.target.value)}>
              <option value="">Tüm Tedarikçiler</option>
              {xmlSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="form-select" style={{ width: 170, fontSize: 13, padding: '6px 10px' }} value={filterMpStatus} onChange={e => { setFilterMpStatus(e.target.value); }}>
              <option value="all">Tüm Trendyol Durumlar</option>
              <option value="not_sent">Gönderilmemiş</option>
              <option value="active">Aktif</option>
              <option value="pending">Bekliyor</option>
              <option value="rejected">Reddedildi</option>
              <option value="passive">Kaldırıldı</option>
            </select>
            <div className="header-search" style={{ width: 200 }}>
              <Search size={14} className="search-icon" />
              <input type="text" placeholder="Ürün ara..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={toggleAll}>
              {products.filter(p => p.ready).length > 0 && products.filter(p => p.ready).every(p => selectedIds.has(p.id))
                ? <><CheckSquare size={14} /> Seçimi Kaldır</>
                : <><Square size={14} /> Hazırları Seç</>}
            </button>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 0' }}>
            <Package size={36} className="empty-icon" />
            <p>Bu filtreye uygun ürün yok</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Ürün</th>
                <th>Fiyat</th>
                <th>Barkod</th>
                <th>Kategori</th>
                <th>Trendyol Kat.</th>
                <th>Trendyol Durumu</th>
                <th>Gönderim</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const status = p.ready ? 'ready' : 'missing';
                const isSelected = selectedIds.has(p.id);
                const catMapping = p.mapName ? { marketplaceCategoryName: p.mapName } : null;
                const thumbImg = getFirstImage(p);
                const mp = getMp(p);
                const mpInfo = mp?.status ? MP_STATUS[mp.status] : null;

                return (
                  <tr key={p.id} style={{ background: isSelected ? 'rgba(59,130,246,0.06)' : undefined, opacity: status === 'missing' ? 0.75 : 1 }}>
                    <td style={{ textAlign: 'center' }}>
                      {status === 'ready' ? (
                        <button onClick={() => toggleSelect(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)', padding: 0 }}>
                          {isSelected ? <CheckSquare size={17} /> : <Square size={17} />}
                        </button>
                      ) : (
                        <AlertCircle size={15} style={{ color: 'var(--warning)' }} />
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 6, flexShrink: 0, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {thumbImg ? (
                            <>
                              <img src={thumbImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} referrerPolicy="no-referrer"
                                onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }} />
                              <div style={{ display: 'none', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}><Package size={14} color="var(--text-muted)" /></div>
                            </>
                          ) : <Package size={14} color="var(--text-muted)" />}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 13, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {p.salePrice != null ? (
                        <>
                          <div style={{ fontWeight: 700 }}>₺{p.salePrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }} title={p.priceRule?.name ? `Şablon: ${p.priceRule.name}` : undefined}>
                            alış ₺{(p.xmlPrice || 0).toLocaleString('tr-TR')}{p.priceRule?.name ? ` · ${p.priceRule.name}` : ''}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600, color: 'var(--danger)' }}>—</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>alış ₺{(p.xmlPrice || 0).toLocaleString('tr-TR')}</div>
                        </>
                      )}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: p.barcode ? 'var(--text-secondary)' : 'var(--danger)' }}>
                      {p.barcode || '⚠ Eksik'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.category || '—'}</td>
                    <td>
                      {catMapping ? (
                        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(16,185,129,0.1)', color: 'var(--success)', fontWeight: 600 }}>
                          {catMapping.marketplaceCategoryName?.split(' > ').pop() || catMapping.marketplaceCategoryId}
                        </span>
                      ) : p.category ? (
                        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(245,158,11,0.1)', color: 'var(--warning)', fontWeight: 600 }}>Eşleştirilmemiş</span>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                    </td>
                    <td>
                      {mpInfo ? (
                        <div title={mp?.errorMessage || undefined}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 8px', borderRadius: 6, background: mpInfo.bg, color: mpInfo.color, fontWeight: 600 }}>
                            {mpInfo.icon} {mpInfo.label}
                          </span>
                          {mp?.errorMessage && (
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mp.errorMessage}</div>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Sparkles size={11} /> Gönderilmedi
                        </span>
                      )}
                    </td>
                    <td>
                      {status === 'ready' ? (
                        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(16,185,129,0.1)', color: 'var(--success)', fontWeight: 700 }}>✓ Hazır</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {p.issues.map(i => (
                            <span key={i.code} title={i.message}
                              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', fontWeight: 600, width: 'fit-content' }}>
                              {ISSUE_LABELS[i.code] || i.message}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {pagination.totalPages > 1 && (
          <div className="pagination">
            <button disabled={pagination.page <= 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>Önceki</button>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{pagination.page} / {pagination.totalPages}</span>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>Sonraki</button>
          </div>
        )}
      </div>

      {/* Send result modal */}
      {sendResult && (
        <div className="modal-overlay" onClick={() => setSendResult(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Send size={17} style={{ color: 'var(--accent-primary)' }} /> Gönderim Tamamlandı
              </h3>
              <button className="modal-close" onClick={() => setSendResult(null)}>×</button>
            </div>
            <div className="modal-body" style={{ padding: '20px 24px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>🕐 {sendResult.sentAt}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Gönderilen', value: sendResult.sent, color: 'var(--success)' },
                  { label: 'Parti Sayısı', value: sendResult.batches || '—', color: 'var(--accent-primary)' },
                  { label: 'Atlanan', value: sendResult.skipped ?? 0, color: 'var(--warning)' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'center', padding: '12px 8px', borderRadius: 10, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: s.value > 0 ? s.color : 'var(--text-muted)' }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {sendResult.skipReasons && Object.keys(sendResult.skipReasons).length > 0 && (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Atlanan ürünlerin nedenleri</div>
                  {Object.entries(sendResult.skipReasons).sort((a, b) => b[1] - a[1]).map(([code, n]) => (
                    <div key={code} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{ISSUE_LABELS[code] || code}</span><strong>{n}</strong>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                Trendyol ürünleri asenkron işler. Onay durumunu görmek için birkaç dakika bekleyip <strong>Durumları Sorgula</strong> butonunu kullanın.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSendResult(null)}>Kapat</button>
              <button className="btn btn-primary" onClick={() => { setSendResult(null); syncMarketplaceStatus(); }}>
                <RefreshCw size={14} /> Durumları Sorgula
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send confirm modal */}
      {showSendModal && (
        <div className="modal-overlay" onClick={() => setShowSendModal(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{showSendModal === 'all' ? 'Tüm Hazır Ürünleri Gönder' : `${selectedIds.size} Ürün Gönder`}</h3>
              <button className="modal-close" onClick={() => setShowSendModal(null)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
                {showSendModal === 'all'
                  ? <><strong>Tüm gönderilebilir ürünler</strong> Trendyol'a toplu olarak gönderilecek.</>
                  : <><strong>{selectedIds.size} seçili ürün</strong> Trendyol'a gönderilecek.</>}
              </p>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '14px 16px', border: '1px solid var(--border-color)' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Minimum Stok Eşiği</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input type="number" min="0" className="form-input" style={{ width: 100 }} value={minStock}
                    onChange={e => setMinStock(Math.max(0, parseInt(e.target.value) || 0))} />
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {minStock > 0 ? `${minStock} adet altı gönderilmez` : 'Tüm stoklar gönderilir'}
                  </span>
                </div>
              </div>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>
                Ürünler 100'lük partiler halinde gönderilir. Doğrulamadan geçemeyen (kategori, barkod, fiyat şablonu, başlık, açıklama, görsel vb.) ürünler hiçbir zaman gönderilmez ve atlanma nedenleri gösterilir.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowSendModal(null)}>İptal</button>
              <button className="btn btn-primary" onClick={showSendModal === 'all' ? handleSendAll : handleSendSelected}>
                <Send size={14} /> Gönder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
