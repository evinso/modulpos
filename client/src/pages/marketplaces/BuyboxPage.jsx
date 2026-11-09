import { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle, Wallet, Clock, Zap, ChevronDown, ChevronUp, ArrowDownCircle, Search } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { matchesQuery } from './buyboxSearch';

function timeAgo(date) {
  if (!date) return null;
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}sn önce`;
  if (diff < 3600) return `${Math.floor(diff / 60)}dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}sa önce`;
  return `${Math.floor(diff / 86400)}g önce`;
}

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
  const [adjustCostPerProduct, setAdjustCostPerProduct] = useState(0.1);
  const [sortField, setSortField] = useState('buyboxOrder');
  const [batchSize, setBatchSize] = useState(50);
  const [query, setQuery] = useState('');

  // Adjust modal
  const [adjustModal, setAdjustModal] = useState(null); // { barcodes?: string[], title?: string }
  const [adjustMode, setAdjustMode] = useState('equal');
  const [adjustAmount, setAdjustAmount] = useState('1');
  const [adjusting, setAdjusting] = useState(false);

  // Auto mode panel
  const [showAutoPanel, setShowAutoPanel] = useState(false);
  const [autoSettings, setAutoSettings] = useState({ enabled: false, mode: 'equal', amount: '1' });
  const [autoSaving, setAutoSaving] = useState(false);

  useEffect(() => {
    fetchConnections();
    fetchCreditInfo();
  }, []);

  useEffect(() => {
    if (selectedConn) {
      fetchHistory();
      loadAutoSettings();
    }
  }, [selectedConn]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setAdjustCostPerProduct(priceRes.data.buyboxAdjustCost ?? 0.1);
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

  const loadAutoSettings = () => {
    try {
      const cfg = selectedConn?.config ? JSON.parse(selectedConn.config) : {};
      setAutoSettings({
        enabled: !!cfg.buyboxAutoAdjust,
        mode: cfg.buyboxAutoMode || 'equal',
        amount: String(cfg.buyboxAutoAmount ?? '1'),
      });
    } catch {}
  };

  const estimatedCost = (count) => {
    if (!count) return null;
    return (Math.ceil(count / 10) * buyboxCostPerBatch).toFixed(1);
  };

  // "Tümünü kontrol et" would be ONE request of several minutes (the browser gives up after 3 minutes while the server keeps
  // working and charges the credits), so it is sent in windows of CHUNK products with a progress counter.
  const CHUNK = 200;
  const stopRef = useRef(false);
  const [progress, setProgress] = useState(null);   // { done, total }

  const runCheck = async () => {
    if (batchSize > 0) {
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/buybox-check`, { batchSize });
      return res.data;
    }
    const sum = { checked: 0, totalEligible: 0, winning: 0, losing: 0, creditUsed: 0, autoAdjusted: 0, autoSkipped: null, autoError: null, results: [], stopped: false };
    for (let offset = 0; ; offset += CHUNK) {
      if (stopRef.current) { sum.stopped = true; break; }
      let d;
      try {
        d = (await api.post(`/marketplace/connections/${selectedConn.id}/buybox-check`, { batchSize: CHUNK, offset })).data;
      } catch (err) {
        if (sum.checked === 0) throw err;                 // nothing done yet: show the real error
        sum.error = err.response?.data?.error || err.message; sum.stopped = true; break;   // keep what was checked
      }
      sum.totalEligible = d.totalEligible;
      for (const k of ['checked', 'winning', 'losing', 'creditUsed', 'autoAdjusted']) sum[k] += d[k] || 0;
      sum.results.push(...d.results);
      if (d.autoSkipped) sum.autoSkipped = { notLower: (sum.autoSkipped?.notLower || 0) + (d.autoSkipped.notLower || 0), loss: (sum.autoSkipped?.loss || 0) + (d.autoSkipped.loss || 0) };
      if (d.autoError) sum.autoError = d.autoError;
      setProgress({ done: Math.min(offset + CHUNK, d.totalEligible), total: d.totalEligible });
      if (offset + CHUNK >= d.totalEligible) break;
    }
    return sum;
  };

  const handleCheck = async () => {
    if (!selectedConn) return;
    setChecking(true);
    setResults(null);
    stopRef.current = false;
    setProgress(null);
    try {
      const data = await runCheck();
      setResults(data);
      await fetchCreditInfo();
      await fetchHistory();
      const msg = data.autoAdjusted > 0
        ? `${data.checked} ürün kontrol edildi, ${data.autoAdjusted} fiyat otomatik güncellendi`
        : `${data.checked} ürün kontrol edildi`;
      if (data.stopped) toast(`${msg}. Kontrol ${data.error ? `yarıda kaldı: ${data.error}` : 'durduruldu'}`, { duration: 8000 });
      else toast.success(msg);
      const sk = data.autoSkipped;
      if (sk && (sk.notLower || sk.loss)) {
        toast(`Otomatik fiyat: ${sk.notLower ? `${sk.notLower} ürün zaten daha ucuz/eşit olduğu için` : ''}${sk.notLower && sk.loss ? ', ' : ''}${sk.loss ? `${sk.loss} ürün zarara düşeceği için` : ''} atlandı`, { duration: 7000 });
      }
      if (data.autoError) toast.error(`Otomatik fiyat güncellenemedi: ${data.autoError}`, { duration: 8000 });
    } catch (err) {
      const msg = err.response?.data?.error || (err.code === 'ECONNABORTED' ? 'İstek zaman aşımına uğradı, daha az ürünle deneyin' : 'BuyBox kontrol hatası');
      toast.error(msg, { duration: 6000 });
    } finally { setChecking(false); setProgress(null); }
  };

  const handleAdjust = async () => {
    if (!selectedConn || !adjustModal) return;
    setAdjusting(true);
    try {
      const payload = {
        mode: adjustMode,
        amount: adjustMode === 'undercut' ? parseFloat(adjustAmount) : 0,
      };
      if (adjustModal.barcodes) payload.barcodes = adjustModal.barcodes;
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/buybox-price-adjust`, payload);
      toast.success(res.data.message + (res.data.creditUsed > 0 ? ` (${res.data.creditUsed} kredi kesildi)` : ''));
      setAdjustModal(null);
      await Promise.all([fetchHistory(), fetchCreditInfo()]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fiyat güncellenemedi');
    } finally { setAdjusting(false); }
  };

  const handleSaveAutoSettings = async () => {
    if (!selectedConn) return;
    setAutoSaving(true);
    try {
      const res = await api.put(`/marketplace/connections/${selectedConn.id}/buybox-auto-settings`, {
        enabled: autoSettings.enabled,
        mode: autoSettings.mode,
        amount: parseFloat(autoSettings.amount) || 0,
      });
      // Update the in-memory connection so loadAutoSettings reads fresh config on next tab switch
      setSelectedConn(c => ({ ...c, config: JSON.stringify(res.data.config) }));
      setConnections(cs => cs.map(c => c.id === selectedConn.id ? { ...c, config: JSON.stringify(res.data.config) } : c));
      toast.success('Otomatik ayarlar kaydedildi');
    } catch {
      toast.error('Kaydedilemedi');
    } finally { setAutoSaving(false); }
  };

  const [clearConfirm, setClearConfirm] = useState(false);

  const handleClearRecords = async () => {
    if (!selectedConn) return;
    setClearConfirm(false);
    try {
      const res = await api.delete(`/marketplace/connections/${selectedConn.id}/buybox-records`);
      toast.success(res.data.message);
      setHistory([]);
      setResults(null);
    } catch {
      toast.error('Kayıtlar silinemedi');
    }
  };

  const losingRows = history.filter(r => r.buyboxOrder != null && r.buyboxOrder > 1 && r.buyboxPrice != null);

  const displayRows = history.filter(r => matchesQuery(r, query)).sort((a, b) => {
    if (sortField === 'buyboxOrder') {
      return (a.buyboxOrder ?? 999) - (b.buyboxOrder ?? 999);
    }
    if (sortField === 'priceDiff') {
      const aOur = a.ourPrice ?? a.marketplacePrice ?? 0;
      const bOur = b.ourPrice ?? b.marketplacePrice ?? 0;
      const aBp = a.buyboxPrice ?? aOur;
      const bBp = b.buyboxPrice ?? bOur;
      return (aOur - aBp) - (bOur - bBp);
    }
    if (sortField === 'checkedAt') {
      return new Date(a.checkedAt ?? 0) - new Date(b.checkedAt ?? 0);
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

  const totalEligible = results?.totalEligible ?? history.length;
  const checkCount = results?.checked ?? history.filter(r => r.checkedAt).length;
  const winCount = results?.winning ?? history.filter(r => r.buyboxOrder === 1).length;
  const loseCount = results?.losing ?? history.filter(r => r.buyboxOrder != null && r.buyboxOrder > 1).length;

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>BuyBox İzleme</h1>
          <p>Ürünlerinizin Trendyol BuyBox sırasını takip edin</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <select
            className="form-select"
            style={{ width: 160 }}
            value={batchSize}
            onChange={e => setBatchSize(parseInt(e.target.value))}
          >
            <option value={20}>20 ürün kontrol et</option>
            <option value={50}>50 ürün kontrol et</option>
            <option value={100}>100 ürün kontrol et</option>
            <option value={0}>Tümünü kontrol et</option>
          </select>
          <button className="btn btn-primary" onClick={handleCheck} disabled={checking} style={{ padding: '10px 24px' }}>
            <RefreshCw size={16} className={checking ? 'spin' : ''} />
            {checking ? (progress ? `Kontrol ediliyor… ${progress.done}/${progress.total}` : 'Kontrol ediliyor...') : 'BuyBox Kontrol Et'}
          </button>
          {checking && batchSize === 0 && (
            <button className="btn btn-secondary" onClick={() => { stopRef.current = true; }} style={{ padding: '10px 16px' }}>Durdur</button>
          )}
        </div>
      </div>

      {/* Info bar */}
      <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {buyboxCostPerBatch > 0 && (
          <span>Her 10 barkod = <strong>{buyboxCostPerBatch} kredi</strong></span>
        )}
        {batchSize > 0 && buyboxCostPerBatch > 0 && (
          <span>Bu kontrol tahmini: <strong>{estimatedCost(Math.min(batchSize, totalEligible || batchSize))} kredi</strong></span>
        )}
        {results && (
          <span style={{ color: 'var(--success)' }}><strong>{results.creditUsed} kredi</strong> kullanıldı</span>
        )}
        {results?.autoAdjusted > 0 && (
          <span style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Zap size={13} /> <strong>{results.autoAdjusted} fiyat</strong> otomatik güncellendi
          </span>
        )}
        {totalEligible > 0 && batchSize > 0 && batchSize < totalEligible && (
          <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={13} />
            Rotasyon aktif — en eski kontrol edilenler önce seçilir ({totalEligible} toplam ürün)
          </span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-4" style={{ marginBottom: 20, gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Toplam Ürün</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{totalEligible || history.length}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Kontrol Edildi</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{history.length}</div>
          {results && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Bu seferki: {results.checked}</div>}
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

      {/* Auto mode panel */}
      <div className="card" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
        <button
          onClick={() => setShowAutoPanel(p => !p)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 14 }}>
            <Zap size={16} style={{ color: autoSettings.enabled ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
            Otomatik Fiyat Ayarı
            {autoSettings.enabled && (
              <span className="badge badge-success" style={{ fontSize: 11 }}>Aktif</span>
            )}
          </div>
          {showAutoPanel ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showAutoPanel && (
          <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border-color)' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '14px 0 16px' }}>
              "BuyBox Kontrol Et" yapıldığında kaybeden ürünlerin fiyatı Trendyol'da güncellenir (kontrol kendiliğinden çalışmaz, butonla başlar).
              Fiyat yalnızca düşürülür; zarara düşecek ya da BuyBox fiyatı zaten bizden yüksek olan ürünler atlanır.
              Güncellenen fiyat o ürün için "elle fiyat" olur, sonraki XML güncellemeleri onu şablon fiyatına geri çevirmez.
            </p>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Otomatik Mod</span>
                <button
                  type="button"
                  onClick={() => setAutoSettings(s => ({ ...s, enabled: !s.enabled }))}
                  style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
                    background: autoSettings.enabled ? 'var(--primary)' : 'var(--border)',
                    transition: 'background 0.2s'
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 3, left: autoSettings.enabled ? 23 : 3,
                    width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s'
                  }} />
                </button>
              </label>

              <div>
                <label className="form-label" style={{ marginBottom: 6 }}>Fiyat Modu</label>
                <select
                  className="form-select"
                  value={autoSettings.mode}
                  onChange={e => setAutoSettings(s => ({ ...s, mode: e.target.value }))}
                  style={{ width: 200 }}
                >
                  <option value="equal">BuyBox fiyatına eşit ol</option>
                  <option value="undercut">BuyBox fiyatının altına in</option>
                </select>
              </div>

              {autoSettings.mode === 'undercut' && (
                <div>
                  <label className="form-label" style={{ marginBottom: 6 }}>Fark (₺)</label>
                  <input
                    type="number"
                    className="form-input"
                    style={{ width: 120 }}
                    min="0.01"
                    step="0.01"
                    value={autoSettings.amount}
                    onChange={e => setAutoSettings(s => ({ ...s, amount: e.target.value }))}
                  />
                </div>
              )}

              <button className="btn btn-primary" onClick={handleSaveAutoSettings} disabled={autoSaving}>
                {autoSaving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Results table */}
      {historyLoading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : history.length > 0 ? (
        <div className="table-container">
          <div className="table-header">
            <h3>
              BuyBox Durumu
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 10 }}>
                {query.trim() ? `${displayRows.length} / ${history.length} ürün` : `${history.length} ürün kayıtlı`}
              </span>
            </h3>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="search"
                  className="form-input"
                  placeholder="Ürün adı, barkod veya SKU ara"
                  aria-label="Ürün ara"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  style={{ width: 250, fontSize: 13, padding: '7px 10px 7px 30px' }}
                />
              </div>
              {losingRows.length > 0 && (
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 13, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={() => setAdjustModal({ title: `${losingRows.length} kaybeden ürünü güncelle` })}
                >
                  <ArrowDownCircle size={14} />
                  Kaybedenleri Güncelle ({losingRows.length})
                </button>
              )}
              <select className="form-select form-select-sm" style={{ fontSize: 13, padding: '6px 10px' }}
                value={sortField} onChange={e => setSortField(e.target.value)}>
                <option value="buyboxOrder">BuyBox Sırasına Göre</option>
                <option value="priceDiff">Fiyat Farkına Göre</option>
                <option value="checkedAt">En Eski Kontrol</option>
              </select>
              <button
                className="btn btn-danger"
                style={{ fontSize: 13, padding: '7px 14px' }}
                onClick={() => setClearConfirm(true)}
              >
                Kayıtları Temizle
              </button>
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
                <th style={{ textAlign: 'center' }}>Son Kontrol</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)', fontSize: 13 }}>
                  "{query}" ile eşleşen ürün yok
                </td></tr>
              )}
              {displayRows.map((r, i) => {
                const ourPrice = r.ourPrice ?? r.marketplacePrice ?? null;
                const diff = (ourPrice != null && r.buyboxPrice != null) ? ourPrice - r.buyboxPrice : null;
                const isWinning = r.buyboxOrder === 1;
                const isUnknown = r.buyboxOrder == null;
                const isLosing = !isUnknown && !isWinning && r.buyboxPrice != null;
                const title = r.title ?? r.product?.title ?? r.barcode;
                const sku = r.sku ?? r.product?.sku ?? '—';
                const ago = timeAgo(r.checkedAt);
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
                    <td style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {ago ?? '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {isLosing && (
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => setAdjustModal({ barcodes: [r.barcode], title: `Fiyat Güncelle: ${title}` })}
                        >
                          Fiyat Güncelle
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <div className="empty-state">
            <TrendingUp size={48} className="empty-icon" />
            <h3>Henüz kontrol yapılmadı</h3>
            <p>"BuyBox Kontrol Et" butonuna basarak ürünlerinizin durumunu öğrenin.</p>
          </div>
        </div>
      )}

      {/* Adjust Modal */}
      {adjustModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 440, padding: 0 }}>
            <div className="table-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ArrowDownCircle size={16} />
                {adjustModal.title || 'Fiyat Güncelle'}
              </h3>
              <button className="text-btn" onClick={() => setAdjustModal(null)}>✕</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label className="form-label">Fiyat Modu</label>
                <select className="form-select" value={adjustMode} onChange={e => setAdjustMode(e.target.value)}>
                  <option value="equal">BuyBox fiyatına eşit ol</option>
                  <option value="undercut">BuyBox fiyatının altına in</option>
                </select>
              </div>

              {adjustMode === 'undercut' && (
                <div>
                  <label className="form-label">Ne kadar altına in? (₺)</label>
                  <input
                    type="number"
                    className="form-input"
                    min="0.01"
                    step="0.01"
                    value={adjustAmount}
                    onChange={e => setAdjustAmount(e.target.value)}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                    Örn: 1 girersen BuyBox fiyatından 1₺ daha ucuz olur
                  </span>
                </div>
              )}

              {(() => {
                const count = adjustModal.barcodes ? adjustModal.barcodes.length : losingRows.length;
                const cost = Math.round(count * adjustCostPerProduct * 100) / 100;
                return (
                  <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)' }}>
                    <strong>En fazla {count} ürün</strong> güncellenecek (zarara düşenler ve zaten daha ucuz olanlar atlanır)
                    {adjustMode === 'equal' ? ' — BuyBox fiyatına eşitlenecek' : ` — BuyBox fiyatından ${adjustAmount}₺ düşük olacak`}
                    {cost > 0 && <span style={{ marginLeft: 8, color: 'var(--accent-primary)', fontWeight: 600 }}>· {cost} kredi kesilecek</span>}
                  </div>
                );
              })()}
            </div>
            <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setAdjustModal(null)}>İptal</button>
              <button className="btn btn-primary" onClick={handleAdjust} disabled={adjusting}>
                {adjusting ? 'Güncelleniyor...' : 'Fiyatları Güncelle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {clearConfirm && (
        <div className="modal-overlay" onClick={() => setClearConfirm(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Kayıtları Temizle</h3>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                <strong>{history.length} kayıt</strong> kalıcı olarak silinecek. Bu işlem geri alınamaz.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setClearConfirm(false)}>İptal</button>
              <button className="btn btn-danger" onClick={handleClearRecords}>Evet, Sil</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
