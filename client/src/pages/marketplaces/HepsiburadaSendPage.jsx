import { useState, useEffect } from 'react';
import { Send, Search, CheckSquare, Square, Package, RefreshCw, AlertCircle, CheckCircle, XCircle, Power, PowerOff, Trash2, Lock, Unlock, Plus } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const CARGO_OPTIONS = ['Yurtiçi Kargo', 'Aras Kargo', 'MNG Kargo', 'PTT Kargo', 'HepsiJet', 'Borusan Lojistik', 'Sürat Kargo', 'UPS'];

const TABS = [
  { key: 'sync',     label: 'Envanter (XML)' },
  { key: 'stock',    label: 'Stok Güncelle' },
  { key: 'price',    label: 'Fiyat Güncelle' },
  { key: 'shipping', label: 'Teslimat Güncelle' },
  { key: 'extra',    label: 'Ek Bilgi Güncelle' },
  { key: 'manage',   label: 'Listing Yönetimi' },
  { key: 'unlock',   label: 'Kilit Kaldır' },
];

export default function HepsiburadaSendPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('sync');

  useEffect(() => { fetchConnections(); }, []);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const hb = res.data.filter(c => c.marketplaceType === 'hepsiburada');
      setConnections(hb);
      if (hb.length > 0) setSelectedConn(hb[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Hepsiburada — Listing Güncelle</h1></div>
        <div className="card"><div className="empty-state"><Package size={48} className="empty-icon" /><h3>Hepsiburada bağlantısı bulunamadı</h3><p>Lütfen önce <a href="/marketplace" style={{ color: '#ff6000' }}>Pazaryeri Bağlantıları</a> sayfasından hesabınızı ekleyin.</p></div></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>Hepsiburada — Listing Güncelle</h1><p>Fiyat, stok, teslimat ve listing yönetimi</p></div>
        {connections.length > 1 && (
          <select className="form-select" style={{ width: 220 }} value={selectedConn?.id || ''}
            onChange={e => setSelectedConn(connections.find(c => c.id === e.target.value))}>
            {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
          </select>
        )}
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: 16, gap: 2, flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: '9px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
            fontWeight: activeTab === tab.key ? 600 : 400,
            color: activeTab === tab.key ? '#ff6000' : 'var(--text-secondary)',
            borderBottom: activeTab === tab.key ? '2px solid #ff6000' : '2px solid transparent',
            marginBottom: -1, whiteSpace: 'nowrap',
          }}>{tab.label}</button>
        ))}
      </div>

      {activeTab === 'sync'     && <SyncTab     conn={selectedConn} />}
      {activeTab === 'stock'    && <UploadTab   conn={selectedConn} type="stock"    title="Stok Güncelle" />}
      {activeTab === 'price'    && <UploadTab   conn={selectedConn} type="price"    title="Fiyat Güncelle" />}
      {activeTab === 'shipping' && <UploadTab   conn={selectedConn} type="shipping" title="Teslimat Güncelle" />}
      {activeTab === 'extra'    && <UploadTab   conn={selectedConn} type="extra"    title="Ek Bilgi Güncelle" />}
      {activeTab === 'manage'   && <ManageTab   conn={selectedConn} />}
      {activeTab === 'unlock'   && <UnlockTab   conn={selectedConn} />}
    </div>
  );
}

// ─── Tab 1: Envanter XML batch ─────────────────────────────────────────────────

function SyncTab({ conn }) {
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [dispatchTime, setDispatchTime] = useState(1);
  const [uploadId, setUploadId] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusResult, setStatusResult] = useState(null);

  useEffect(() => { if (conn) fetchProducts(); }, [conn, pagination.page, search]);

  const fetchProducts = async () => {
    try {
      const res = await api.get('/products', { params: { page: pagination.page, limit: 20, search } });
      setProducts(res.data.products);
      setPagination(p => ({ ...p, total: res.data.pagination.total, totalPages: res.data.pagination.totalPages }));
    } catch { toast.error('Ürünler yüklenemedi'); }
  };

  const toggleSelect = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    const valid = products.filter(p => p.sku || p.barcode).map(p => p.id);
    setSelectedIds(selectedIds.size === valid.length && valid.length > 0 ? new Set() : new Set(valid));
  };

  const handleSync = async () => {
    if (!conn || selectedIds.size === 0) return;
    const payload = products.filter(p => selectedIds.has(p.id) && (p.sku || p.barcode)).map(p => ({ sku: p.sku || p.barcode, price: Number(p.price) || 0, stock: parseInt(p.stock) || 0, dispatchTime }));
    if (!payload.length) { toast.error('Seçili ürünlerde SKU/Barkod yok'); return; }
    setSyncing(true); setSyncResult(null);
    try {
      const res = await api.post(`/marketplace/connections/${conn.id}/hepsiburada-sync`, { products: payload });
      setSyncResult(res.data);
      const id = res.data?.id || res.data?.Id || res.data?.uploadId;
      if (id) setUploadId(String(id));
      toast.success(`${payload.length} ürün gönderildi`);
      setSelectedIds(new Set());
    } catch (err) { toast.error(err.response?.data?.error || 'Gönderme hatası'); }
    finally { setSyncing(false); }
  };

  const checkStatus = async () => {
    if (!uploadId.trim() || !conn) return;
    setStatusLoading(true);
    try {
      const res = await api.get(`/marketplace/connections/${conn.id}/hepsiburada-inventory-upload-status/${uploadId.trim()}`);
      setStatusResult(res.data);
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setStatusLoading(false); }
  };

  const validCount = products.filter(p => p.sku || p.barcode).length;

  return (
    <div>
      <InfoBox text="XML toplu güncelleme (Envanter). Mevcut Hepsiburada listelerinde fiyat + stok + kargo güncellenir. MerchantSku eşleşmesi gerekir." />

      {syncResult && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle size={14} />{syncResult.sent ?? '?'} ürün gönderildi</span>
            {(syncResult.id || syncResult.Id) && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Upload ID: <strong style={{ fontFamily: 'monospace' }}>{syncResult.id || syncResult.Id}</strong></span>}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="form-input" placeholder="Upload ID (durumu sorgulamak için)..." value={uploadId}
            onChange={e => setUploadId(e.target.value)} onKeyDown={e => e.key === 'Enter' && checkStatus()} style={{ flex: 1, fontFamily: 'monospace' }} />
          <button className="btn btn-secondary" onClick={checkStatus} disabled={statusLoading || !uploadId.trim()}>
            {statusLoading ? <><RefreshCw size={14} className="spinning" /> Sorgulanıyor</> : 'Durumu Sorgula'}
          </button>
        </div>
        <UploadStatusResult result={statusResult} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={toggleAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
            {selectedIds.size === validCount && validCount > 0 ? <CheckSquare size={16} /> : <Square size={16} />} Tümünü Seç
          </button>
          <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
            <input className="form-input" style={{ paddingLeft: 32 }} placeholder="Ürün ara..."
              value={search} onChange={e => { setSearch(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <label style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Kargoya Verme:</label>
            <input type="number" min={1} max={30} className="form-input" style={{ width: 64 }} value={dispatchTime}
              onChange={e => setDispatchTime(Math.max(1, parseInt(e.target.value) || 1))} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>gün</span>
          </div>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing || selectedIds.size === 0}>
            {syncing ? <><RefreshCw size={15} className="spinning" /> Gönderiliyor...</> : <><Send size={15} /> {selectedIds.size} Ürünü Güncelle</>}
          </button>
        </div>
      </div>

      <ProductTable products={products} selectedIds={selectedIds} toggleSelect={toggleSelect} pagination={pagination} setPagination={setPagination} />
    </div>
  );
}

// ─── Tab 2–5: Dedicated upload tabs ────────────────────────────────────────────

function UploadTab({ conn, type, title }) {
  const [rows, setRows] = useState([emptyRow(type)]);
  const [sending, setSending] = useState(false);
  const [uploadId, setUploadId] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusResult, setStatusResult] = useState(null);

  function emptyRow(t) {
    const base = { hepsiburadaSku: '', merchantSku: '' };
    if (t === 'stock')    return { ...base, availableStock: '' };
    if (t === 'price')    return { ...base, price: '' };
    if (t === 'shipping') return { ...base, dispatchTime: '', shippingProfileName: '', cargoCompany1: '', cargoCompany2: '', cargoCompany3: '' };
    if (t === 'extra')    return { ...base, productName: '', maximumPurchasableQuantity: '' };
    return base;
  }

  const updateRow = (idx, field, val) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  const addRow = () => setRows(prev => [...prev, emptyRow(type)]);
  const removeRow = (idx) => setRows(prev => prev.length === 1 ? [emptyRow(type)] : prev.filter((_, i) => i !== idx));

  const handleSend = async () => {
    const items = rows.filter(r => r.hepsiburadaSku.trim() || r.merchantSku.trim());
    if (!items.length) return toast.error('En az bir ürün girin');
    setSending(true);
    try {
      const endpoints = { stock: 'hepsiburada-stock-upload', price: 'hepsiburada-price-upload', shipping: 'hepsiburada-shipping-upload', extra: 'hepsiburada-additional-upload' };
      const res = await api.post(`/marketplace/connections/${conn.id}/${endpoints[type]}`, { items });
      const id = res.data?.id || res.data?.Id;
      if (id) { setUploadId(String(id)); toast.success(`Yükleme başladı. Upload ID: ${id}`); }
      else toast.success('Yükleme gönderildi');
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setSending(false); }
  };

  const checkStatus = async () => {
    if (!uploadId.trim() || !conn) return;
    setStatusLoading(true);
    try {
      const statusEndpoints = { stock: 'hepsiburada-stock-upload-status', price: 'hepsiburada-price-upload-status', shipping: 'hepsiburada-shipping-upload-status', extra: 'hepsiburada-additional-upload-status' };
      const res = await api.get(`/marketplace/connections/${conn.id}/${statusEndpoints[type]}/${uploadId.trim()}`);
      setStatusResult(res.data);
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setStatusLoading(false); }
  };

  return (
    <div>
      <InfoBox text={
        type === 'stock'    ? 'Yalnızca stok miktarını günceller. HB SKU veya MerchantSku giriniz.' :
        type === 'price'    ? 'Yalnızca fiyatı günceller. Maksimum 4000 SKU / istek, 5 eşzamanlı istek.' :
        type === 'shipping' ? 'Kargoya verme süresi ve kargo şirketini günceller. (Ocak 2024\'ten itibaren dispatchTime yalnızca bu endpoint üzerinden güncellenebilir.)' :
        'Ürün adı ve maksimum satın alınabilir miktar gibi ek bilgileri günceller.'
      } />

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row, idx) => (
            <div key={idx} style={{ display: 'grid', gap: 8, gridTemplateColumns: type === 'extra' ? '1fr 1fr 1fr 1fr auto' : type === 'shipping' ? '1fr 1fr 1fr 1fr 1fr 1fr auto' : '1fr 1fr 1fr auto', alignItems: 'center' }}>
              <input className="form-input" placeholder="HB SKU" style={{ fontFamily: 'monospace', fontSize: 12 }}
                value={row.hepsiburadaSku} onChange={e => updateRow(idx, 'hepsiburadaSku', e.target.value)} />
              <input className="form-input" placeholder="Merchant SKU" style={{ fontFamily: 'monospace', fontSize: 12 }}
                value={row.merchantSku} onChange={e => updateRow(idx, 'merchantSku', e.target.value)} />
              {type === 'stock' && <input className="form-input" placeholder="Stok" type="number" min={0}
                value={row.availableStock} onChange={e => updateRow(idx, 'availableStock', e.target.value)} />}
              {type === 'price' && <input className="form-input" placeholder="Fiyat (örn: 118.97)" type="number" min={0} step="0.01"
                value={row.price} onChange={e => updateRow(idx, 'price', e.target.value)} />}
              {type === 'shipping' && <>
                <input className="form-input" placeholder="Kargoya verme (gün)" type="number" min={0}
                  value={row.dispatchTime} onChange={e => updateRow(idx, 'dispatchTime', e.target.value)} />
                <select className="form-select" value={row.cargoCompany1} onChange={e => updateRow(idx, 'cargoCompany1', e.target.value)}>
                  <option value="">Kargo 1 seç</option>
                  {CARGO_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="form-select" value={row.cargoCompany2} onChange={e => updateRow(idx, 'cargoCompany2', e.target.value)}>
                  <option value="">Kargo 2 (isteğe bağlı)</option>
                  {CARGO_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input className="form-input" placeholder="Profil adı (isteğe bağlı)"
                  value={row.shippingProfileName} onChange={e => updateRow(idx, 'shippingProfileName', e.target.value)} />
              </>}
              {type === 'extra' && <>
                <input className="form-input" placeholder="Ürün adı"
                  value={row.productName} onChange={e => updateRow(idx, 'productName', e.target.value)} />
                <input className="form-input" placeholder="Maks. satın alınabilir (0=sınırsız)" type="number" min={0}
                  value={row.maximumPurchasableQuantity} onChange={e => updateRow(idx, 'maximumPurchasableQuantity', e.target.value)} />
              </>}
              <button type="button" onClick={() => removeRow(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 6, flexShrink: 0 }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={addRow} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> Satır Ekle
          </button>
          <button className="btn btn-primary" onClick={handleSend} disabled={sending} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {sending ? <><RefreshCw size={14} className="spinning" /> Gönderiliyor...</> : <><Send size={14} /> Gönder ({rows.filter(r => r.hepsiburadaSku || r.merchantSku).length} SKU)</>}
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Yükleme Durumu Sorgula</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-input" placeholder="Upload ID girin..." value={uploadId}
            onChange={e => setUploadId(e.target.value)} onKeyDown={e => e.key === 'Enter' && checkStatus()} style={{ flex: 1, fontFamily: 'monospace' }} />
          <button className="btn btn-secondary" onClick={checkStatus} disabled={statusLoading || !uploadId.trim()}>
            {statusLoading ? <RefreshCw size={14} className="spinning" /> : 'Sorgula'}
          </button>
        </div>
        <UploadStatusResult result={statusResult} />
      </div>
    </div>
  );
}

// ─── Tab 6: Listing management ──────────────────────────────────────────────────

function ManageTab({ conn }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [deleteModal, setDeleteModal] = useState(null);

  const fetchListings = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/marketplace/connections/${conn.id}/hepsiburada-listings`);
      const raw = res.data;
      const items = raw?.listings || raw?.data?.listings || (Array.isArray(raw) ? raw : []);
      setListings(items);
    } catch (err) { toast.error('Listingler yüklenemedi: ' + (err.response?.data?.error || err.message)); }
    finally { setLoading(false); }
  };

  const doAction = async (actionKey, fn, successMsg) => {
    setActionLoading(prev => ({ ...prev, [actionKey]: true }));
    try { await fn(); toast.success(successMsg); fetchListings(); }
    catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setActionLoading(prev => ({ ...prev, [actionKey]: false })); }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    const hbSku = deleteModal.hbSku || deleteModal.listingId || deleteModal.merchantSku;
    const merchantSku = deleteModal.merchantSku;
    doAction(`del_${hbSku}`, () => api.delete(`/marketplace/connections/${conn.id}/hepsiburada-listing/${encodeURIComponent(hbSku)}/merchantsku/${encodeURIComponent(merchantSku)}`), 'Listing silindi');
    setDeleteModal(null);
  };

  const filtered = listings.filter(l => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (l.productName || '').toLowerCase().includes(s) || (l.merchantSku || '').toLowerCase().includes(s) || (l.hbSku || l.listingId || '').toLowerCase().includes(s);
  });

  return (
    <div>
      <InfoBox text="Hepsiburada'daki mevcut listinglerinizi aktif/deaktif edin veya silin." />
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
          <input className="form-input" style={{ paddingLeft: 32 }} placeholder="SKU veya ürün adı ara..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-secondary" onClick={fetchListings} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spinning' : ''} /> {loading ? ' Yükleniyor...' : " Hepsiburada'dan Çek"}
        </button>
      </div>

      {listings.length === 0 && !loading ? (
        <div className="card"><div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}><Package size={36} style={{ marginBottom: 10, opacity: 0.4 }} /><div style={{ marginBottom: 12 }}>Listing bulunamadı</div><button className="btn btn-primary" onClick={fetchListings}>Hepsiburada'dan Çek</button></div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Ürün</th>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>HB SKU</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Fiyat</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Stok</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Durum</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, i) => {
                const hbSku = l.hbSku || l.listingId || l.sku;
                const mSku = l.merchantSku || l.sku;
                const state = (l.state || l.status || '').toUpperCase();
                const isActive = state === 'ACTIVE' || state === 'ENABLED' || !state;
                const isLocked = l.isLocked || l.IsLocked;
                const actKey = `act_${hbSku}`, deactKey = `deact_${hbSku}`, delKey = `del_${hbSku}`;
                return (
                  <tr key={hbSku || i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.productName || l.name || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>MerchantSku: {mSku || '—'}</div>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{hbSku || '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{l.price != null ? `${Number(l.price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{l.availableCount ?? l.stock ?? '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                        {isActive ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 3 }}><CheckCircle size={11} /> Aktif</span>
                          : <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}><XCircle size={11} /> Deaktif</span>}
                        {isLocked && <span style={{ fontSize: 10, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 2 }}><Lock size={9} /> Kilitli</span>}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        {isActive
                          ? <button className="btn btn-secondary btn-sm" disabled={!!actionLoading[deactKey]} onClick={() => doAction(deactKey, () => api.post(`/marketplace/connections/${conn.id}/hepsiburada-deactivate/${encodeURIComponent(hbSku)}`), 'Listing deaktif edildi')} style={{ padding: '4px 8px', fontSize: 11 }}><PowerOff size={12} /> {actionLoading[deactKey] ? '...' : 'Kapat'}</button>
                          : <button className="btn btn-secondary btn-sm" disabled={!!actionLoading[actKey]} onClick={() => doAction(actKey, () => api.post(`/marketplace/connections/${conn.id}/hepsiburada-activate/${encodeURIComponent(hbSku)}`), 'Listing aktif edildi')} style={{ padding: '4px 8px', fontSize: 11, color: 'var(--success)' }}><Power size={12} /> {actionLoading[actKey] ? '...' : 'Aç'}</button>}
                        <button className="btn btn-secondary btn-sm" disabled={!!actionLoading[delKey]} onClick={() => setDeleteModal(l)} style={{ padding: '4px 8px', fontSize: 11, color: '#ef4444' }}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && listings.length > 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Aramanızla eşleşen listing yok</div>}
        </div>
      )}

      {deleteModal && (
        <div className="modal-overlay" onClick={() => setDeleteModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header"><h3>Listing Sil</h3><button className="modal-close" onClick={() => setDeleteModal(null)}>×</button></div>
            <div className="modal-body"><p style={{ fontSize: 14 }}><strong>{deleteModal.productName || deleteModal.merchantSku}</strong> isimli listing kalıcı olarak silinecek. Bu işlem geri alınamaz.</p></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteModal(null)}>İptal</button>
              <button onClick={handleDelete} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Sil</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 7: Bulk Unlock ─────────────────────────────────────────────────────────

function UnlockTab({ conn }) {
  const [skus, setSkus] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleUnlock = async () => {
    const hbSkuList = skus.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!hbSkuList.length) return toast.error('En az bir HB SKU girin');
    setLoading(true);
    try {
      const res = await api.post(`/marketplace/connections/${conn.id}/hepsiburada-bulk-unlock`, { hbSkuList });
      setResult(res.data);
      toast.success('Kilit kaldırma isteği gönderildi');
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <InfoBox text="Fiyat eşiği ihlali nedeniyle kilitlenen listing'lerin kilidini toplu olarak kaldırır. Her satıra veya virgülle ayırarak HB SKU girin." />
      <div className="card">
        <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'block' }}>HB SKU Listesi</label>
        <textarea className="form-input" rows={8} placeholder="HBV000001234567&#10;HBV000009876543&#10;..." style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          value={skus} onChange={e => setSkus(e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={handleUnlock} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {loading ? <><RefreshCw size={15} className="spinning" /> Gönderiliyor...</> : <><Unlock size={15} /> Kilitleri Kaldır</>}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{skus.split(/[\n,]+/).filter(s => s.trim()).length} SKU</span>
        </div>
        {result && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(16,185,129,0.08)', borderRadius: 6, fontSize: 13 }}>
            <CheckCircle size={14} style={{ color: 'var(--success)', marginRight: 6 }} />
            İstek gönderildi
            {result.data && <pre style={{ fontSize: 11, marginTop: 6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{JSON.stringify(result.data, null, 2)}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared helpers ─────────────────────────────────────────────────────────────

function InfoBox({ text }) {
  return (
    <div style={{ background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
      <AlertCircle size={15} style={{ color: '#ff6000', flexShrink: 0, marginTop: 1 }} /><span>{text}</span>
    </div>
  );
}

function UploadStatusResult({ result }) {
  if (!result) return null;
  const status = result.Status || result.status || '';
  const processed = result.Processed ?? result.processed;
  const total = result.Total ?? result.total;
  const errors = result.Errors || result.errors || result.failedItems || [];
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 12, fontSize: 13, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>Durum: <span style={{ color: status === 'Done' ? 'var(--success)' : 'var(--warning)' }}>{status || '—'}</span></span>
        {processed != null && <span>İşlenen: {processed} / {total}</span>}
      </div>
      {errors.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {errors.map((e, i) => (
            <div key={i} style={{ fontSize: 12, color: '#ef4444', padding: '3px 0' }}>
              {e.HepsiburadaSku || e.hepsiburadaSku || e.MerchantSku || e.merchantSku}: {e.ErrorReason || e.errorReason || e.errorMessage || JSON.stringify(e)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductTable({ products, selectedIds, toggleSelect, pagination, setPagination }) {
  return (
    <>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
              <th style={{ width: 40, padding: '10px 12px' }}></th>
              <th style={{ padding: '10px 12px', textAlign: 'left' }}>Ürün</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Fiyat</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Stok</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => {
              const sku = p.sku || p.barcode;
              const canSelect = !!sku;
              return (
                <tr key={p.id} onClick={() => canSelect && toggleSelect(p.id)}
                  style={{ borderBottom: '1px solid var(--border-color)', cursor: canSelect ? 'pointer' : 'default', opacity: canSelect ? 1 : 0.5, background: selectedIds.has(p.id) ? 'rgba(255,96,0,0.06)' : 'transparent' }}>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {canSelect ? selectedIds.has(p.id) ? <CheckSquare size={16} style={{ color: '#ff6000' }} /> : <Square size={16} style={{ color: 'var(--text-muted)' }} /> : <Square size={16} style={{ opacity: 0.3 }} />}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 500 }}>{p.title || p.name || 'İsimsiz'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sku ? `MerchantSku: ${sku}` : 'SKU/Barkod yok'}</div>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.price ? `${Number(p.price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.stock ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {products.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}><Package size={28} style={{ marginBottom: 8 }} /><div>Ürün bulunamadı</div></div>}
      </div>
      {pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" disabled={pagination.page <= 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>Önceki</button>
          <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>{pagination.page} / {pagination.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>Sonraki</button>
        </div>
      )}
    </>
  );
}
