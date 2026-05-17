import { useState, useEffect } from 'react';
import { ArrowRight, Download, Copy, RefreshCw, CheckCircle, AlertCircle, Zap, Globe, FileCode2, Link2, Wallet, Info, Trash2, History } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.modulpos.com/api';
const HISTORY_KEY = 'xmlConverterHistory';
const MAX_HISTORY = 50;

export default function XmlConverterPage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [history, setHistory] = useState([]);

  const [balance, setBalance] = useState(null);
  const [convertCost, setConvertCost] = useState(1);

  useEffect(() => {
    fetchCreditInfo();
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      setHistory(saved);
    } catch {}
  }, []);

  const addToHistory = (originalUrl, proxyUrl, productCount) => {
    const entry = { originalUrl, proxyUrl, productCount, date: new Date().toISOString() };
    setHistory(prev => {
      const filtered = prev.filter(h => h.originalUrl !== originalUrl);
      const next = [entry, ...filtered].slice(0, MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const removeFromHistory = (originalUrl) => {
    setHistory(prev => {
      const next = prev.filter(h => h.originalUrl !== originalUrl);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
  };

  const fetchCreditInfo = async () => {
    try {
      const [balRes, pricesRes] = await Promise.all([
        api.get('/credits/balance'),
        api.get('/credits/prices')
      ]);
      setBalance(balRes.data.balance);
      setConvertCost(pricesRes.data.xmlConvertCost ?? 1);
    } catch {}
  };

  const proxyUrl = url
    ? `${API_BASE}/xml-converter/proxy?url=${encodeURIComponent(url)}`
    : '';

  const downloadUrl = url
    ? `${API_BASE}/xml-converter/download?url=${encodeURIComponent(url)}`
    : '';

  const hasEnoughCredits = balance === null || balance >= convertCost;

  const handlePreview = async () => {
    if (!url.trim()) return toast.error('XML URL gerekli');
    if (!hasEnoughCredits) return toast.error(`Yetersiz kredi. Bu işlem ${convertCost} kredi gerektirir.`);
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post('/xml-converter/preview', { url });
      if (res.data.success) {
        setResult(res.data);
        setBalance(prev => prev !== null ? Math.max(0, prev - convertCost) : null);
        toast.success(`${res.data.totalProducts} ürün dönüştürüldü! (${convertCost} kredi kullanıldı)`);
        fetchCreditInfo();
        addToHistory(url, `${API_BASE}/xml-converter/proxy?url=${encodeURIComponent(url)}`, res.data.totalProducts);
      }
    } catch (err) {
      const data = err.response?.data;
      const msg = data?.error || 'Dönüştürme hatası';
      const detail = data?.detail && data.detail !== msg ? ` — ${data.detail}` : '';
      if (err.response?.status === 402) {
        toast.error(msg);
        fetchCreditInfo();
      } else {
        toast.error(msg + detail);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(proxyUrl);
    setCopied(true);
    toast.success('Proxy URL kopyalandı!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {/* Header */}
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>XML Dönüştürücü</h1>
          <p>Desteklenmeyen XML formatlarını otomatik dönüştürün ve sisteme ekleyin</p>
        </div>
        {/* Credit balance badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
          background: 'var(--bg-card)', border: '1px solid var(--border-color)',
          borderRadius: 10, flexShrink: 0
        }}>
          <Wallet size={16} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Bakiye:</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: balance !== null && balance < convertCost ? 'var(--danger)' : 'var(--text-primary)' }}>
            {balance !== null ? balance.toFixed(2) : '…'} kredi
          </span>
        </div>
      </div>

      {/* Info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { icon: <Globe size={20} />, title: 'Her XML Formatı', desc: 'RSS, Google Shopping, Atom, özel formatlar — hepsi desteklenir', color: 'var(--accent-primary)' },
          { icon: <Zap size={20} />, title: 'Canlı Proxy', desc: 'Proxy URL sayesinde veriler her çekmede anlık dönüştürülür', color: '#10b981' },
          { icon: <Link2 size={20} />, title: 'Kolay Entegrasyon', desc: 'Proxy URL\'yi XML kaynağı olarak direkt sisteme ekleyin', color: '#f59e0b' },
        ].map((card, i) => (
          <div key={i} className="card" style={{ padding: '20px 24px', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: `${card.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: card.color, flexShrink: 0 }}>
              {card.icon}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{card.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{card.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Converter */}
      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileCode2 size={18} style={{ color: 'var(--accent-primary)' }} />
          XML URL Girin
        </h2>

        {/* Credit cost notice */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          background: hasEnoughCredits ? 'rgba(59,130,246,0.07)' : 'rgba(239,68,68,0.07)',
          border: `1px solid ${hasEnoughCredits ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.25)'}`,
          borderRadius: 8, marginBottom: 16, fontSize: 13
        }}>
          <Info size={15} style={{ color: hasEnoughCredits ? 'var(--accent-primary)' : 'var(--danger)', flexShrink: 0 }} />
          <span style={{ color: 'var(--text-secondary)' }}>
            Her dönüştürme işlemi{' '}
            <strong style={{ color: hasEnoughCredits ? 'var(--accent-primary)' : 'var(--danger)' }}>
              {convertCost} kredi
            </strong>{' '}
            kullanır.
            {balance !== null && !hasEnoughCredits && (
              <span style={{ color: 'var(--danger)', marginLeft: 8 }}>
                Bakiyeniz yetersiz ({balance.toFixed(2)} kredi). <a href="/credits" style={{ color: 'var(--danger)', fontWeight: 600 }}>Kredi yükleyin →</a>
              </span>
            )}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <input
            className="form-input"
            style={{ flex: 1 }}
            placeholder="https://tedarikci.com/export.xml"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePreview()}
          />
          <button
            className="btn btn-primary"
            onClick={handlePreview}
            disabled={loading || !url || !hasEnoughCredits}
            style={{ whiteSpace: 'nowrap', minWidth: 160 }}
          >
            {loading
              ? <><RefreshCw size={14} className="spinning" /> Analiz ediliyor...</>
              : <><Zap size={14} /> Dönüştür ({convertCost} kredi)</>
            }
          </button>
        </div>

        {/* Proxy URL section */}
        {url && (
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Proxy URL (XML Kaynağı Olarak Kullanın)
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{
                flex: 1, padding: '10px 14px', background: 'var(--bg-primary)',
                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)',
                fontSize: 12, fontFamily: 'monospace', color: 'var(--accent-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {proxyUrl}
              </div>
              <button className="btn btn-secondary" onClick={handleCopy} style={{ whiteSpace: 'nowrap' }}>
                {copied ? <><CheckCircle size={14} /> Kopyalandı</> : <><Copy size={14} /> Kopyala</>}
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              💡 Bu URL'yi <strong>XML Kaynakları</strong> sayfasında yeni kaynak eklerken kullanın. Her senkronizasyonda orijinal XML otomatik çekilip dönüştürülür.
            </p>
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="card" style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle size={20} style={{ color: 'var(--success)' }} />
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>Dönüştürme Başarılı</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {result.totalProducts} ürün standart formata çevrildi
                  {' · '}
                  <span style={{ color: 'var(--warning)' }}>{convertCost} kredi kullanıldı</span>
                </p>
              </div>
            </div>
            <a
              href={downloadUrl}
              className="btn btn-secondary"
              download
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Download size={14} /> XML İndir
            </a>
          </div>

          {/* How to use */}
          <div className="alert alert-info" style={{ marginBottom: 20 }}>
            <strong>Nasıl kullanılır?</strong>
            <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13, lineHeight: 2 }}>
              <li>Yukarıdaki <strong>Proxy URL</strong>'yi kopyalayın</li>
              <li><strong>XML Kaynakları</strong> sayfasına gidin → "XML Kaynağı Ekle" tıklayın</li>
              <li>URL alanına Proxy URL'yi yapıştırın</li>
              <li>Sisteme ekleyin — her çekmede otomatik dönüştürülür ✅</li>
            </ol>
          </div>

          {/* Preview table */}
          {result.sample && result.sample.length > 0 && (
            <>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>📋 Dönüştürülmüş Ürün Önizlemesi (İlk {result.sample.length})</h4>
              <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                <table style={{ minWidth: 800 }}>
                  <thead>
                    <tr>
                      {['SKU', 'Ürün Adı', 'Fiyat', 'Liste Fiyatı', 'Stok', 'Marka', 'Kategori'].map(h => (
                        <th key={h} style={{ fontSize: 11, padding: '10px 12px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.sample.map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12, padding: '10px 12px', fontFamily: 'monospace', color: 'var(--accent-primary)' }}>{p.stok_kodu || '-'}</td>
                        <td style={{ fontSize: 12, padding: '10px 12px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.adi || '-'}</td>
                        <td style={{ fontSize: 12, padding: '10px 12px', color: '#10b981' }}>{p.fiyat?.son_kullanici ? `₺${p.fiyat.son_kullanici}` : '-'}</td>
                        <td style={{ fontSize: 12, padding: '10px 12px', color: 'var(--text-secondary)' }}>{p.fiyat?.bayi_fiyati ? `₺${p.fiyat.bayi_fiyati}` : '-'}</td>
                        <td style={{ fontSize: 12, padding: '10px 12px' }}>{p.miktar || '-'}</td>
                        <td style={{ fontSize: 12, padding: '10px 12px', color: 'var(--text-secondary)' }}>{p.marka || '-'}</td>
                        <td style={{ fontSize: 12, padding: '10px 12px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{p.kategori || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Conversion History */}
      {history.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <History size={18} style={{ color: 'var(--accent-primary)' }} />
              Dönüştürme Geçmişi ({history.length})
            </h3>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => { if (window.confirm('Tüm geçmiş silinsin mi?')) clearHistory(); }}
            >
              <Trash2 size={13} /> Temizle
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map((h, i) => (
              <div key={i} style={{
                padding: '12px 16px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                display: 'flex', alignItems: 'center', gap: 12
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{new Date(h.date).toLocaleString('tr-TR')}</span>
                    <span className="badge badge-success" style={{ fontSize: 10 }}>{h.productCount} ürün</span>
                  </div>
                  <div style={{
                    fontSize: 12, fontFamily: 'monospace', color: 'var(--accent-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }} title={h.proxyUrl}>
                    {h.proxyUrl}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.originalUrl}>
                    ↳ {h.originalUrl}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '5px 10px' }}
                    onClick={() => {
                      navigator.clipboard.writeText(h.proxyUrl);
                      setCopiedIndex(i);
                      toast.success('Kopyalandı!');
                      setTimeout(() => setCopiedIndex(null), 2000);
                    }}
                  >
                    {copiedIndex === i ? <CheckCircle size={13} /> : <Copy size={13} />}
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '5px 10px' }}
                    onClick={() => { setUrl(h.originalUrl); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ fontSize: 12, padding: '5px 10px' }}
                    onClick={() => removeFromHistory(h.originalUrl)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Format support info */}
      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Desteklenen XML Formatları</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {[
            { format: 'RSS 2.0 / Google Shopping', example: '<rss><channel><item>...</item></channel></rss>' },
            { format: 'Türk e-Ticaret (Urunler/Urun)', example: '<Urunler><Urun>...</Urun></Urunler>' },
            { format: 'Generic (Products/Product)', example: '<Products><Product>...</Product></Products>' },
            { format: 'Atom Feed', example: '<feed><entry>...</entry></feed>' },
            { format: 'Custom (Items/Item)', example: '<Items><Item>...</Item></Items>' },
            { format: 'Düz liste (root > item)', example: '<catalog><item>...</item></catalog>' },
          ].map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
              <span className="badge badge-success" style={{ fontSize: 10, height: 18, alignSelf: 'center' }}>✓</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{f.format}</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', marginTop: 3 }}>{f.example}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
