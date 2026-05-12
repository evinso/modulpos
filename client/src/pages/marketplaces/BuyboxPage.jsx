import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle, Wallet } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function BuyboxPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [creditBalance, setCreditBalance] = useState(null);
  const [buyboxCostPerBatch, setBuyboxCostPerBatch] = useState(1);
  const [productCount, setProductCount] = useState(0);
  const [sortField, setSortField] = useState('buyboxOrder');

  useEffect(() => {
    fetchConnections();
    fetchCreditInfo();
  }, []);

  useEffect(() => {
    if (selectedConn) {
      fetchHistory();
      fetchProductCount();
    }
  }, [selectedConn]);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const trendyol = res.data.filter(c => c.marketplaceType === 'trendyol' && c.status === 'active');
      setConnections(trendyol);
      if (trendyol.length > 0) setSelectedConn(trendyol[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const fetchCreditInfo = async () => {
    try {
      const [balRes, priceRes] = await Promise.all([
        api.get('/credits/balance'),
        api.get('/credits/prices')
      ]);
      setCreditBalance(balRes.data.balance);
      setBuyboxCostPerBatch(priceRes.data.buyboxCheckCost ?? 1);
    } catch {}
  };

  const fetchProductCount = async () => {
    if (!selectedConn) return;
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/buybox-history`);
      // Use history length as proxy; actual count comes from check result
      setHistory(res.data);
    } catch {}
  };

  const fetchHistory = async () => {
    if (!selectedConn) return;
    setHistoryLoading(true);
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/buybox-history`);
      setHistory(res.data);
    } catch {}
    finally { setHistoryLoading(false); }
  };

  const estimatedCost = (count) => {
    if (!count) return null;
    return (Math.ceil(count / 10) * buyboxCostPerBatch).toFixed(1);
  };

  const handleCheck = async () => {
    if (!selectedConn) return;
    setChecking(true);
    setResults(null);
    try {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/buybox-check`);
      setResults(res.data);
      setProductCount(res.data.checked);
      await fetchCreditInfo();
      await fetchHistory();
      toast.success(`${res.data.checked} ürün kontrol edildi`);
    } catch (err) {
      const msg = err.response?.data?.error || 'BuyBox kontrol hatası';
      toast.error(msg, { duration: 6000 });
    } finally { setChecking(false); }
  };

  const displayRows = (results?.results || history).sort((a, b) => {
    if (sortField === 'buyboxOrder') {
      const aVal = a.buyboxOrder ?? 999;
      const bVal = b.buyboxOrder ?? 999;
      return aVal - bVal;
    }
    if (sortField === 'priceDiff') {
      const aOur = a.ourPrice ?? a.marketplacePrice ?? 0;
      const bOur = b.ourPrice ?? b.marketplacePrice ?? 0;
      const aBp = a.buyboxPrice ?? aOur;
      const bBp = b.buyboxPrice ?? bOur;
      return (aOur - aBp) - (bOur - bBp);
    }
    return 0;
  });

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>BuyBox İzleme</h1></div>
        <div className="card">
          <div className="empty-state">
            <AlertCircle size={48} className="empty-icon" />
            <h3>Aktif Trendyol bağlantısı bulunamadı</h3>
            <p>Pazaryerleri sayfasından bir Trendyol bağlantısı ekleyin.</p>
          </div>
        </div>
      </div>
    );
  }

  const checkCount = results?.checked ?? history.length;
  const winCount = results?.winning ?? history.filter(r => r.buyboxOrder === 1).length;
  const loseCount = results?.losing ?? history.filter(r => r.buyboxOrder != null && r.buyboxOrder > 1).length;
  const cost = results?.creditUsed ?? null;

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>BuyBox İzleme</h1>
          <p>Ürünlerinizin Trendyol BuyBox sırasını takip edin</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {creditBalance !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 14px', fontSize: 13 }}>
              <Wallet size={14} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ color: 'var(--text-secondary)' }}>Bakiye:</span>
              <strong>{creditBalance.toFixed(1)} kredi</strong>
            </div>
          )}
          {connections.length > 1 && (
            <select className="form-select" style={{ width: 200 }}
              value={selectedConn?.id || ''}
              onChange={e => setSelectedConn(connections.find(c => c.id === e.target.value))}
            >
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
            </select>
          )}
          <button
            className="btn btn-primary"
            onClick={handleCheck}
            disabled={checking}
            style={{ padding: '10px 24px' }}
          >
            <RefreshCw size={16} className={checking ? 'spin' : ''} />
            {checking ? 'Kontrol ediliyor...' : 'BuyBox Kontrol Et'}
          </button>
        </div>
      </div>

      {/* Credit cost hint */}
      {buyboxCostPerBatch > 0 && (
        <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
          Her 10 barkod için <strong>{buyboxCostPerBatch} kredi</strong> kullanılır.
          {checkCount > 0 && <span> Tahmini maliyet: <strong>{estimatedCost(checkCount)} kredi</strong> ({checkCount} ürün)</span>}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-3" style={{ marginBottom: 20, gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Kontrol Edilen</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{checkCount}</div>
          {cost !== null && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{cost} kredi kullanıldı</div>}
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>BuyBox Kazanıyor</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{winCount}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>BuyBox Kaybediyor</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--danger)' }}>{loseCount}</div>
        </div>
      </div>

      {/* Results table */}
      {displayRows.length > 0 && (
        <div className="table-container">
          <div className="table-header">
            <h3>{results ? 'Sonuçlar' : 'Son Kontrol Sonuçları'}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="form-select form-select-sm" style={{ fontSize: 13, padding: '6px 10px' }}
                value={sortField} onChange={e => setSortField(e.target.value)}>
                <option value="buyboxOrder">Sıraya Göre</option>
                <option value="priceDiff">Fiyat Farkına Göre</option>
              </select>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Ürün</th>
                <th>SKU</th>
                <th style={{ textAlign: 'right' }}>Bizim Fiyatımız</th>
                <th style={{ textAlign: 'right' }}>BuyBox Fiyatı</th>
                <th style={{ textAlign: 'right' }}>Fark</th>
                <th style={{ textAlign: 'center' }}>BuyBox Sırası</th>
                <th style={{ textAlign: 'center' }}>Çoklu Satıcı</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r, i) => {
                const ourPrice = r.ourPrice ?? r.marketplacePrice ?? null;
                const diff = (ourPrice != null && r.buyboxPrice != null) ? ourPrice - r.buyboxPrice : null;
                const isWinning = r.buyboxOrder === 1;
                const isUnknown = r.buyboxOrder == null;
                const title = r.title ?? r.product?.title ?? r.barcode;
                const sku = r.sku ?? r.product?.sku ?? '—';
                return (
                  <tr key={r.barcode || i}>
                    <td style={{ fontSize: 13, maxWidth: 220 }}>
                      <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{r.barcode}</div>
                    </td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{sku}</td>
                    <td style={{ textAlign: 'right', fontSize: 13 }}>
                      {ourPrice != null ? `${ourPrice.toFixed(2)}₺` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>
                      {r.buyboxPrice != null ? `${r.buyboxPrice.toFixed(2)}₺` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 13 }}>
                      {diff != null ? (
                        <span style={{ color: diff > 0 ? 'var(--danger)' : diff < 0 ? 'var(--success)' : 'var(--text-secondary)' }}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(2)}₺
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {isUnknown ? (
                        <span className="badge" style={{ background: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)' }}>—</span>
                      ) : isWinning ? (
                        <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <TrendingUp size={12} /> 1. Sıra
                        </span>
                      ) : (
                        <span className="badge badge-error" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <TrendingDown size={12} /> {r.buyboxOrder}. Sıra
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontSize: 12, color: r.hasMultipleSeller ? 'var(--warning)' : 'var(--text-muted)' }}>
                        {r.hasMultipleSeller ? 'Evet' : 'Hayır'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {displayRows.length === 0 && !checking && (
        <div className="card">
          <div className="empty-state">
            <TrendingUp size={48} className="empty-icon" />
            <h3>Henüz kontrol yapılmadı</h3>
            <p>"BuyBox Kontrol Et" butonuna basarak ürünlerinizin durumunu öğrenin.</p>
          </div>
        </div>
      )}
    </div>
  );
}
