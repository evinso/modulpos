import { useState } from 'react';
import { ArrowRight, Download, Copy, RefreshCw, CheckCircle, AlertCircle, Zap, Globe, FileCode2, Link2 } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.modulpos.com/api';

export default function XmlConverterPage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const proxyUrl = url
    ? `${API_BASE}/xml-converter/proxy?url=${encodeURIComponent(url)}`
    : '';

  const downloadUrl = url
    ? `${API_BASE}/xml-converter/download?url=${encodeURIComponent(url)}`
    : '';

  const handlePreview = async () => {
    if (!url.trim()) return toast.error('XML URL gerekli');
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post('/xml-converter/preview', { url });
      if (res.data.success) {
        setResult(res.data);
        toast.success(`${res.data.totalProducts} ürün dönüştürüldü!`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Dönüştürme hatası');
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
      <div className="page-title">
        <div>
          <h1>XML Dönüştürücü</h1>
          <p>Desteklenmeyen XML formatlarını otomatik dönüştürün ve sisteme ekleyin</p>
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
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileCode2 size={18} style={{ color: 'var(--accent-primary)' }} />
          XML URL Girin
        </h2>

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
            disabled={loading || !url}
            style={{ whiteSpace: 'nowrap', minWidth: 140 }}
          >
            {loading
              ? <><RefreshCw size={14} className="spinning" /> Analiz ediliyor...</>
              : <><Zap size={14} /> Dönüştür & Önizle</>
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
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{result.totalProducts} ürün standart formata çevrildi</p>
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

      {/* Format support info */}
      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Desteklenen XML Formatları</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {[
            { format: 'RSS 2.0 / Google Shopping', example: '<rss><channel><item>...</item></channel></rss>', badge: 'success' },
            { format: 'Türk e-Ticaret (Urunler/Urun)', example: '<Urunler><Urun>...</Urun></Urunler>', badge: 'success' },
            { format: 'Generic (Products/Product)', example: '<Products><Product>...</Product></Products>', badge: 'success' },
            { format: 'Atom Feed', example: '<feed><entry>...</entry></feed>', badge: 'success' },
            { format: 'Custom (Items/Item)', example: '<Items><Item>...</Item></Items>', badge: 'success' },
            { format: 'Düz liste (root > item)', example: '<catalog><item>...</item></catalog>', badge: 'success' },
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
