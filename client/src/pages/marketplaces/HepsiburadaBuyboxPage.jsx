import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle, Search, ChevronUp, ChevronDown, CheckCircle, XCircle, Minus } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const SORT_OPTIONS = [
  { value: 'buyboxOrder', label: 'BuyBox Sırası' },
  { value: 'priceDiff', label: 'Fiyat Farkı' },
  { value: 'productName', label: 'Ürün Adı' },
];

export default function HepsiburadaBuyboxPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [listings, setListings] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('buyboxOrder');
  const [sortDir, setSortDir] = useState('asc');
  const [filterTab, setFilterTab] = useState('all'); // all | winning | losing | unknown
  const [limit, setLimit] = useState(500);

  // Price adjust
  const [adjustModal, setAdjustModal] = useState(null); // { items: [...], mode: 'match'|'undercut' }
  const [adjustMode, setAdjustMode] = useState('match');
  const [adjustAmount, setAdjustAmount] = useState('1');
  const [adjusting, setAdjusting] = useState(false);

  useEffect(() => { fetchConnections(); }, []);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const hb = res.data.filter(c => c.marketplaceType === 'hepsiburada' && c.status === 'active');
      setConnections(hb);
      if (hb.length > 0) setSelectedConn(hb[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const handleCheck = async () => {
    if (!selectedConn) return;
    setChecking(true);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/hepsiburada-buybox-check`, { limit });
      setListings(res.data.listings || []);
      setStats({ total: res.data.total, winning: res.data.winning, losing: res.data.losing, unknown: res.data.unknown });
      toast.success(`${res.data.total} ürünün BuyBox sırası alındı`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'BuyBox sorgu hatası');
    } finally { setChecking(false); }
  };

  const handleAdjust = async () => {
    if (!adjustModal || !selectedConn) return;
    setAdjusting(true);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/hepsiburada-buybox-adjust`, {
        items: adjustModal.items,
        mode: adjustMode,
        amount: parseFloat(adjustAmount) || 1,
      });
      toast.success(`${res.data.updated} ürünün fiyatı güncellendi`);
      if (res.data.failed > 0) toast.error(`${res.data.failed} ürün güncellenemedi`);
      setAdjustModal(null);
      // Refresh BuyBox after adjustment
      handleCheck();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fiyat güncellenemedi');
    } finally { setAdjusting(false); }
  };

  const sortedFiltered = useMemo(() => {
    let rows = [...listings];

    // Tab filter
    if (filterTab === 'winning') rows = rows.filter(r => r.buyboxOrder === 1);
    else if (filterTab === 'losing') rows = rows.filter(r => r.buyboxOrder != null && r.buyboxOrder > 1);
    else if (filterTab === 'unknown') rows = rows.filter(r => r.buyboxOrder == null);

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.productName || '').toLowerCase().includes(q) ||
        (r.sku || '').toLowerCase().includes(q) ||
        (r.barcode || '').toLowerCase().includes(q)
      );
    }

    // Sort
    rows.sort((a, b) => {
      let va, vb;
      if (sortField === 'buyboxOrder') { va = a.buyboxOrder ?? 999; vb = b.buyboxOrder ?? 999; }
      else if (sortField === 'priceDiff') {
        va = (a.ourPrice ?? 0) - (a.buyboxPrice ?? a.ourPrice ?? 0);
        vb = (b.ourPrice ?? 0) - (b.buyboxPrice ?? b.ourPrice ?? 0);
      }
      else if (sortField === 'productName') { va = (a.productName || '').toLowerCase(); vb = (b.productName || '').toLowerCase(); }
      else { va = 0; vb = 0; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return rows;
  }, [listings, filterTab, search, sortField, sortDir]);

  const losingItems = listings.filter(r => r.buyboxOrder != null && r.buyboxOrder > 1 && r.buyboxPrice != null);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Hepsiburada — BuyBox Sırası</h1></div>
        <div className="card">
          <div className="empty-state">
            <AlertCircle size={48} className="empty-icon" />
            <h3>Aktif Hepsiburada bağlantısı bulunamadı</h3>
            <p>Lütfen önce <a href="/marketplace" style={{ color: 'var(--accent-primary)' }}>Pazaryeri Bağlantıları</a> sayfasından Hepsiburada bağlayın ve bağlantıyı test edin.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Hepsiburada — BuyBox Sırası</h1>
          <p>Ürünlerinizin Hepsiburada BuyBox sırasını görün ve fiyatlarınızı optimize edin</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {connections.length > 1 && (
            <select className="form-select" style={{ width: 200 }} value={selectedConn?.id || ''}
              onChange={e => { setSelectedConn(connections.find(c => c.id === e.target.value)); setListings([]); setStats(null); }}>
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
            </select>
          )}
          <select className="form-select" style={{ width: 160 }} value={limit} onChange={e => setLimit(parseInt(e.target.value))}>
            <option value={100}>100 ürün çek</option>
            <option value={250}>250 ürün çek</option>
            <option value={500}>500 ürün çek</option>
            <option value={1000}>1000 ürün çek</option>
          </select>
          <button className="btn btn-primary" onClick={handleCheck} disabled={checking}>
            <RefreshCw size={16} className={checking ? 'spinning' : ''} />
            {checking ? 'Sorgulanıyor...' : 'BuyBox Sırası Getir'}
          </button>
        </div>
      </div>

      {/* Info box */}
      <div style={{ background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <AlertCircle size={15} style={{ color: '#ff6000', flexShrink: 0 }} />
        <span>Hepsiburada Listing API'nden anlık BuyBox sıra verisi çekilir. <strong>1. sıra</strong> BuyBox kazananını gösterir.</span>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-4" style={{ marginBottom: 16, gap: 12 }}>
          {[
            { label: 'Toplam Listeleme', value: stats.total, color: 'var(--text-primary)', tab: 'all' },
            { label: 'BuyBox Kazanıyor (1. sıra)', value: stats.winning, color: 'var(--success)', tab: 'winning' },
            { label: 'BuyBox Kaybediyor', value: stats.losing, color: 'var(--danger)', tab: 'losing' },
            { label: 'Sıra Bilgisi Yok', value: stats.unknown, color: 'var(--text-muted)', tab: 'unknown' },
          ].map(card => (
            <div key={card.tab} className="card" onClick={() => setFilterTab(card.tab)}
              style={{ padding: 16, cursor: 'pointer', border: filterTab === card.tab ? `2px solid ${card.color}` : undefined }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{card.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Quick adjust bar for losing products */}
      {losingItems.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--danger)' }}>{losingItems.length} ürün</strong> BuyBox dışında — fiyatlarını optimize edin
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setAdjustModal({ items: losingItems.map(r => ({ sku: r.sku, buyboxPrice: r.buyboxPrice, ourPrice: r.ourPrice })) })}
          >
            <TrendingDown size={14} /> Kaybedenlerin Fiyatını Ayarla ({losingItems.length})
          </button>
        </div>
      )}

      {/* Search + sort + table */}
      {listings.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
              <input className="form-input" style={{ paddingLeft: 32 }} placeholder="Ürün adı, SKU veya barkod..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: 180 }} value={sortField}
              onChange={e => { setSortField(e.target.value); setSortDir('asc'); }}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
              {sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Ürün</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('buyboxOrder')}>
                    BuyBox Sırası <SortIcon field="buyboxOrder" />
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>BuyBox Fiyatı</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('priceDiff')}>
                    Sizin Fiyatınız <SortIcon field="priceDiff" />
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Fark</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Stok</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((r, i) => {
                  const priceDiff = r.ourPrice != null && r.buyboxPrice != null ? r.ourPrice - r.buyboxPrice : null;
                  const isWinning = r.buyboxOrder === 1;
                  const isLosing = r.buyboxOrder != null && r.buyboxOrder > 1;
                  return (
                    <tr key={r.sku || i} style={{ borderBottom: '1px solid var(--border-color)', background: isWinning ? 'rgba(34,197,94,0.03)' : isLosing ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 500, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.productName || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {r.sku ? `SKU: ${r.sku}` : ''}
                          {r.barcode ? ` | ${r.barcode}` : ''}
                          {r.hasMultipleSeller && <span style={{ marginLeft: 6, color: 'var(--warning)' }}>• Çoklu satıcı</span>}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        {r.buyboxOrder == null ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                        ) : r.buyboxOrder === 1 ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(34,197,94,0.15)', color: 'var(--success)', borderRadius: 6, padding: '3px 10px', fontWeight: 700, fontSize: 13 }}>
                            <CheckCircle size={12} /> 1. sıra
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', borderRadius: 6, padding: '3px 10px', fontWeight: 700, fontSize: 13 }}>
                            <XCircle size={12} /> {r.buyboxOrder}. sıra
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: 'var(--success)' }}>
                        {r.buyboxPrice != null ? `${r.buyboxPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>
                        {r.ourPrice != null ? `${r.ourPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        {priceDiff == null ? <Minus size={14} style={{ color: 'var(--text-muted)' }} /> : (
                          <span style={{ color: priceDiff > 0 ? 'var(--danger)' : priceDiff < 0 ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>
                            {priceDiff > 0 ? '+' : ''}{priceDiff.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                        {r.stock ?? '—'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        {isLosing && r.buyboxPrice != null && (
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: 11, padding: '3px 10px' }}
                            onClick={() => setAdjustModal({ items: [{ sku: r.sku, buyboxPrice: r.buyboxPrice, ourPrice: r.ourPrice }] })}
                          >
                            <TrendingDown size={11} /> Ayarla
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {sortedFiltered.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                {listings.length === 0 ? 'Veri yok — "BuyBox Sırası Getir" butonuna basın' : 'Filtrele eşleşen ürün yok'}
              </div>
            )}
          </div>

          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
            {sortedFiltered.length} / {listings.length} listeleme gösteriliyor
          </div>
        </>
      )}

      {listings.length === 0 && !checking && (
        <div className="card">
          <div className="empty-state">
            <TrendingUp size={48} className="empty-icon" />
            <h3>BuyBox verisi yok</h3>
            <p>Yukarıdaki "BuyBox Sırası Getir" butonuna basarak Hepsiburada listelerinizin sırasını çekin.</p>
          </div>
        </div>
      )}

      {/* Price adjust modal */}
      {adjustModal && (
        <div className="modal-overlay" onClick={() => setAdjustModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h3>Fiyat Ayarla</h3>
              <button className="modal-close" onClick={() => setAdjustModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                <strong>{adjustModal.items.length}</strong> ürünün fiyatı BuyBox fiyatına göre güncellenecek.
              </p>

              <div className="form-group">
                <label className="form-label">Fiyat Stratejisi</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { value: 'match', label: 'BuyBox fiyatıyla eşleş', desc: 'Fiyatını tam BuyBox fiyatına ayarla' },
                    { value: 'undercut', label: 'BuyBox fiyatının altına geç', desc: `BuyBox fiyatından ${adjustAmount} ₺ düşük ayarla` },
                  ].map(opt => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 8, border: `1px solid ${adjustMode === opt.value ? '#ff6000' : 'var(--border-color)'}`, background: adjustMode === opt.value ? 'rgba(255,96,0,0.06)' : 'transparent' }}>
                      <input type="radio" name="adjustMode" value={opt.value} checked={adjustMode === opt.value} onChange={() => setAdjustMode(opt.value)} style={{ marginTop: 2 }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{opt.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {adjustMode === 'undercut' && (
                <div className="form-group">
                  <label className="form-label">Altına geçme miktarı (₺)</label>
                  <input type="number" min="0.01" step="0.01" className="form-input"
                    value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} />
                </div>
              )}

              <div style={{ background: 'var(--bg-tertiary)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                Etkilenen ürünler: {adjustModal.items.map(i => i.sku).slice(0, 5).join(', ')}
                {adjustModal.items.length > 5 && ` ve ${adjustModal.items.length - 5} ürün daha`}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAdjustModal(null)}>İptal</button>
              <button className="btn btn-primary" onClick={handleAdjust} disabled={adjusting}
                style={{ background: '#ff6000', borderColor: '#ff6000' }}>
                {adjusting ? <><RefreshCw size={14} className="spinning" /> Güncelleniyor...</> : `${adjustModal.items.length} Ürünü Güncelle`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
