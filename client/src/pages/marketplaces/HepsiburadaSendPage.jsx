import { useState, useEffect } from 'react';
import { Send, Search, CheckSquare, Square, Package, RefreshCw, AlertCircle, CheckCircle, XCircle, Power, PowerOff, Trash2 } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

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
        <div className="page-title"><h1>Hepsiburada — Stok & Fiyat</h1></div>
        <div className="card">
          <div className="empty-state">
            <Package size={48} className="empty-icon" />
            <h3>Hepsiburada bağlantısı bulunamadı</h3>
            <p>Lütfen önce <a href="/marketplace" style={{ color: '#ff6000' }}>Pazaryeri Bağlantıları</a> sayfasından hesabınızı ekleyin.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Hepsiburada — Stok & Fiyat</h1>
          <p>Fiyat/stok güncelleme ve listing yönetimi</p>
        </div>
        {connections.length > 1 && (
          <select className="form-select" style={{ width: 220 }} value={selectedConn?.id || ''}
            onChange={e => setSelectedConn(connections.find(c => c.id === e.target.value))}>
            {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: 16 }}>
        {[
          { key: 'sync', label: 'Fiyat & Stok Güncelle' },
          { key: 'manage', label: 'Listing Yönetimi' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
            fontWeight: activeTab === tab.key ? 600 : 400,
            color: activeTab === tab.key ? '#ff6000' : 'var(--text-secondary)',
            borderBottom: activeTab === tab.key ? '2px solid #ff6000' : '2px solid transparent',
            marginBottom: -1,
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'sync'
        ? <SyncTab conn={selectedConn} />
        : <ManageTab conn={selectedConn} />}
    </div>
  );
}

// ─── Tab 1: Batch price+stock update from local products ─────────────────────

function SyncTab({ conn }) {
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [dispatchTime, setDispatchTime] = useState(1);

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
    const payload = products
      .filter(p => selectedIds.has(p.id) && (p.sku || p.barcode))
      .map(p => ({
        sku: p.sku || p.barcode,
        price: Number(p.price) || 0,
        stock: parseInt(p.stock) || 0,
        dispatchTime,
      }));
    if (!payload.length) { toast.error('Seçili ürünlerde SKU/Barkod yok'); return; }

    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await api.post(`/marketplace/connections/${conn.id}/hepsiburada-sync`, { products: payload });
      setSyncResult(res.data);
      toast.success(`${payload.length} ürün Hepsiburada'ya gönderildi`);
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(err.response?.data?.error || 'Gönderme hatası');
    } finally { setSyncing(false); }
  };

  const validCount = products.filter(p => p.sku || p.barcode).length;

  return (
    <div>
      <div style={{ background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
        <AlertCircle size={15} style={{ color: '#ff6000', flexShrink: 0, marginTop: 1 }} />
        <span>XML toplu güncelleme. Mevcut Hepsiburada listelerinde fiyat ve stok güncellenir. MerchantSku eşleşmesi gerekir.</span>
      </div>

      {syncResult && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <CheckCircle size={16} style={{ color: 'var(--success)' }} />
            <span style={{ color: 'var(--success)', fontWeight: 600 }}>{syncResult.sent} ürün gönderildi</span>
            {syncResult.result && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{JSON.stringify(syncResult.result)}</span>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={toggleAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
            {selectedIds.size === validCount && validCount > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
            Tümünü Seç
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
                    {canSelect
                      ? selectedIds.has(p.id) ? <CheckSquare size={16} style={{ color: '#ff6000' }} /> : <Square size={16} style={{ color: 'var(--text-muted)' }} />
                      : <Square size={16} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />}
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
    </div>
  );
}

// ─── Tab 2: HepsiBurada listing management (activate/deactivate/delete) ──────

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
    } catch (err) {
      toast.error('Listingler yüklenemedi: ' + (err.response?.data?.error || err.message));
    } finally { setLoading(false); }
  };

  const doAction = async (actionKey, fn, successMsg) => {
    setActionLoading(prev => ({ ...prev, [actionKey]: true }));
    try {
      await fn();
      toast.success(successMsg);
      fetchListings();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setActionLoading(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  const handleActivate = (l) => {
    const sku = l.hbSku || l.listingId || l.merchantSku;
    doAction(`act_${sku}`,
      () => api.post(`/marketplace/connections/${conn.id}/hepsiburada-activate/${encodeURIComponent(sku)}`),
      'Listing aktif edildi'
    );
  };

  const handleDeactivate = (l) => {
    const sku = l.hbSku || l.listingId || l.merchantSku;
    doAction(`deact_${sku}`,
      () => api.post(`/marketplace/connections/${conn.id}/hepsiburada-deactivate/${encodeURIComponent(sku)}`),
      'Listing deaktif edildi'
    );
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    const hbSku = deleteModal.hbSku || deleteModal.listingId || deleteModal.merchantSku;
    const merchantSku = deleteModal.merchantSku;
    doAction(`del_${hbSku}`,
      () => api.delete(`/marketplace/connections/${conn.id}/hepsiburada-listing/${encodeURIComponent(hbSku)}/merchantsku/${encodeURIComponent(merchantSku)}`),
      'Listing silindi'
    );
    setDeleteModal(null);
  };

  const filtered = listings.filter(l => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (l.productName || '').toLowerCase().includes(s)
      || (l.merchantSku || '').toLowerCase().includes(s)
      || (l.hbSku || l.listingId || '').toLowerCase().includes(s);
  });

  return (
    <div>
      <div style={{ background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
        <AlertCircle size={15} style={{ color: '#ff6000', flexShrink: 0, marginTop: 1 }} />
        <span>Hepsiburada'daki mevcut listinglerinizi aktif/deaktif edin veya silin.</span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
          <input className="form-input" style={{ paddingLeft: 32 }} placeholder="SKU veya ürün adı ara..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-secondary" onClick={fetchListings} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spinning' : ''} />
          {loading ? ' Yükleniyor...' : ' Hepsiburada\'dan Çek'}
        </button>
      </div>

      {listings.length === 0 && !loading ? (
        <div className="card">
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Package size={36} style={{ marginBottom: 10, opacity: 0.4 }} />
            <div style={{ marginBottom: 12 }}>Listing bulunamadı</div>
            <button className="btn btn-primary" onClick={fetchListings}>Hepsiburada'dan Çek</button>
          </div>
        </div>
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
                const actKey = `act_${hbSku}`;
                const deactKey = `deact_${hbSku}`;
                const delKey = `del_${hbSku}`;
                return (
                  <tr key={hbSku || i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.productName || l.name || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>MerchantSku: {mSku || '—'}</div>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)' }}>{hbSku || '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {l.price != null ? `${Number(l.price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{l.availableCount ?? l.stock ?? '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {isActive
                        ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}><CheckCircle size={11} /> Aktif</span>
                        : <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}><XCircle size={11} /> Deaktif</span>}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        {isActive ? (
                          <button className="btn btn-secondary btn-sm" disabled={!!actionLoading[deactKey]}
                            onClick={() => handleDeactivate(l)}
                            title="Satışa Kapat"
                            style={{ padding: '4px 8px', fontSize: 11 }}>
                            <PowerOff size={12} /> {actionLoading[deactKey] ? '...' : 'Kapat'}
                          </button>
                        ) : (
                          <button className="btn btn-secondary btn-sm" disabled={!!actionLoading[actKey]}
                            onClick={() => handleActivate(l)}
                            title="Satışa Aç"
                            style={{ padding: '4px 8px', fontSize: 11, color: 'var(--success)' }}>
                            <Power size={12} /> {actionLoading[actKey] ? '...' : 'Aç'}
                          </button>
                        )}
                        <button className="btn btn-secondary btn-sm" disabled={!!actionLoading[delKey]}
                          onClick={() => setDeleteModal(l)}
                          title="Listing Sil"
                          style={{ padding: '4px 8px', fontSize: 11, color: 'var(--danger, #ef4444)' }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && listings.length > 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Aramanızla eşleşen listing yok</div>
          )}
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteModal && (
        <div className="modal-overlay" onClick={() => setDeleteModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>Listing Sil</h3>
              <button className="modal-close" onClick={() => setDeleteModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14 }}>
                <strong>{deleteModal.productName || deleteModal.merchantSku}</strong> isimli listing kalıcı olarak silinecek. Bu işlem geri alınamaz.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteModal(null)}>İptal</button>
              <button onClick={handleDelete} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
