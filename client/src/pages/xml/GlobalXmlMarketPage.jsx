import React, { useState, useEffect } from 'react';
import { Download, Search, Tag, CheckCircle2, PackageSearch, Wallet, Eye, X, ImageOff, FolderTree, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useNavigate } from 'react-router-dom';
import LoadingOverlay from '../../components/LoadingOverlay';

export default function GlobalXmlMarketPage() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [importing, setImporting] = useState(false);
  
  const [importConfig, setImportConfig] = useState({
    barcodePrefix: '',
    priceMarkupPct: 0
  });

  const [creditBalance, setCreditBalance] = useState(0);
  const [defaultCost, setDefaultCost] = useState(0);

  const [previewProvider, setPreviewProvider] = useState(null);
  const [previewProducts, setPreviewProducts] = useState([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewCategories, setPreviewCategories] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    fetchProviders();
    fetchCredits();
  }, []);

  const fetchCredits = async () => {
    try {
      const [balRes, priceRes] = await Promise.all([
        api.get('/credits/balance'),
        api.get('/credits/prices')
      ]);
      setCreditBalance(balRes.data.balance);
      setDefaultCost(priceRes.data.xmlImportDefaultCost || 0);
    } catch {}
  };

  const fetchProviders = async () => {
    try {
      const res = await api.get('/global-xml');
      setProviders(res.data);
    } catch (error) {
      toast.error('Global XML listesi alınamadı');
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async (provider) => {
    setPreviewProvider(provider);
    setPreviewProducts([]);
    setPreviewTotal(0);
    setPreviewCategories([]);
    setPreviewLoading(true);
    try {
      const res = await api.get(`/global-xml/${provider.id}/preview`);
      setPreviewProducts(res.data.preview);
      setPreviewTotal(res.data.total);
      setPreviewCategories(res.data.categories || []);
    } catch {
      toast.error('Önizleme yüklenemedi');
      setPreviewProvider(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleImport = async (e) => {
    e.preventDefault();
    if (!selectedProvider) return;

    setImporting(true);
    try {
      await api.post(`/global-xml/${selectedProvider.id}/import`, importConfig);
      toast.success('XML Kaynağı mağazanıza başarıyla eklendi!');
      setSelectedProvider(null);
      navigate('/xml-sources');
    } catch (error) {
      toast.error(error.response?.data?.error || 'İçe aktarma başarısız');
    } finally {
      setImporting(false);
    }
  };

  const filteredProviders = providers.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    (p.description && p.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="global-xml-market">
      <LoadingOverlay visible={importing} message="İçe Aktarılıyor..." submessage="XML kaynağı mağazanıza ekleniyor, lütfen bekleyin." />
      <div className="page-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>Hazır XML Market</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Kategori eşleştirmeleri ve tag ayarları önceden yapılmış tedarikçi XML'lerini tek tıkla mağazanıza ekleyin.
          </p>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 12,
          background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)'
        }}>
          <Wallet size={18} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent-primary)' }}>
            {creditBalance.toFixed(2)} Kredi
          </span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="header-search" style={{ width: '100%', maxWidth: '400px' }}>
          <Search className="search-icon" size={18} />
          <input
            type="text"
            placeholder="Tedarikçi ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>Yükleniyor...</div>
      ) : filteredProviders.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <PackageSearch size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Hazır tedarikçi bulunamadı.</p>
        </div>
      ) : (
        <div className="grid grid-3">
          {filteredProviders.map(provider => (
            <div key={provider.id} className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                <div style={{ 
                  width: '48px', height: '48px', borderRadius: 'var(--radius-sm)', 
                  background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden'
                }}>
                  {provider.logo ? (
                    <img src={provider.logo} alt={provider.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Tag size={24} color="var(--accent-primary)" />
                  )}
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: '600' }}>{provider.name}</h3>
                  <span className="badge badge-success" style={{ marginTop: '4px' }}>Hazır Eşleştirme</span>
                </div>
              </div>
              
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.5', marginBottom: '12px' }}>
                {provider.description || "Bu XML kaynağı uzman ekibimiz tarafından sizin için önceden ayarlanmıştır."}
              </p>

              {(() => {
                let cargos = [];
                if (provider.cargoCompanies) {
                  try { cargos = JSON.parse(provider.cargoCompanies); } catch {}
                }
                if (!cargos.length) return null;
                return (
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      🚚 Çalışılan Kargolar
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {cargos.map(c => (
                        <span key={c} style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 10,
                          background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                          color: 'var(--text-secondary)', fontWeight: 500
                        }}>
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 'auto' }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: 'var(--warning)',
                  display: 'flex', alignItems: 'center', gap: 4
                }}>
                  <Wallet size={14} />
                  {(provider.creditCost > 0 ? provider.creditCost : defaultCost)} Kredi
                </span>
                {provider.productCount > 0 ? (
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
                    display: 'flex', alignItems: 'center', gap: 4
                  }}>
                    <Package size={13} style={{ color: 'var(--accent-primary)' }} />
                    {provider.productCount.toLocaleString('tr-TR')} ürün
                  </span>
                ) : (
                  <span className="badge badge-success" style={{ marginTop: 0 }}>Hazır Eşleştirme</span>
                )}
              </div>
              
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => handlePreview(provider)}
                >
                  <Eye size={16} /> Önizle
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => setSelectedProvider(provider)}
                >
                  <Download size={16} /> Ekle
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewProvider && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 900, maxHeight: '85vh', padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="table-header" style={{ flexShrink: 0 }}>
              <div>
                <h3 style={{ margin: 0 }}>{previewProvider.name} — Önizleme</h3>
                {previewTotal > 0 && (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Toplam {previewTotal} ürün · İlk 20 gösteriliyor
                  </p>
                )}
              </div>
              <button className="text-btn" onClick={() => setPreviewProvider(null)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ overflowY: 'auto', padding: 20, flex: 1 }}>
              {previewLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                  XML yükleniyor, lütfen bekleyin...
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: previewCategories.length > 0 ? 28 : 0 }}>
                    {previewProducts.map((p, i) => (
                      <div key={i} style={{
                        background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)', overflow: 'hidden',
                        display: 'flex', flexDirection: 'column'
                      }}>
                        <div style={{ width: '100%', aspectRatio: '1', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {p.image ? (
                            <img
                              src={p.image}
                              alt={p.title}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                              onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
                            />
                          ) : null}
                          <div style={{ display: p.image ? 'none' : 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                            <ImageOff size={32} color="var(--text-muted)" />
                          </div>
                        </div>
                        <div style={{ padding: '10px 10px 12px' }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {p.title}
                          </p>
                          {p.category && p.category !== '—' && (
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.category}
                            </p>
                          )}
                          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-primary)' }}>
                            {p.price > 0 ? `₺${p.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {previewCategories.length > 0 && (
                    <div>
                      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FolderTree size={16} style={{ color: 'var(--accent-primary)' }} />
                        XML Kategorileri ({previewCategories.length})
                      </h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {previewCategories.map((cat, i) => (
                          <span key={i} style={{
                            fontSize: 12, padding: '4px 10px', borderRadius: 20,
                            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                            color: 'var(--text-secondary)'
                          }}>{cat}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
              <button className="btn btn-secondary" onClick={() => setPreviewProvider(null)}>Kapat</button>
              <button className="btn btn-primary" onClick={() => { setPreviewProvider(null); setSelectedProvider(previewProvider); }}>
                <Download size={16} /> Mağazama Ekle
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedProvider && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', 
          alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: '500px', padding: '0' }}>
            <div className="table-header">
              <h3>{selectedProvider.name} - XML İçe Aktar</h3>
              <button className="text-btn" onClick={() => setSelectedProvider(null)}>Kapat</button>
            </div>
            
            <form onSubmit={handleImport} style={{ padding: '20px' }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '12px', borderRadius: 'var(--radius-sm)', marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <CheckCircle2 color="var(--success)" size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--success)', marginBottom: '4px' }}>Kategori Eşleştirmeleri Hazır!</h4>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Bu XML'i eklediğinizde Trendyol eşleştirmeleri otomatik yapılacaktır.</p>
                </div>
              </div>

              <div style={{
                background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                padding: '12px', borderRadius: 'var(--radius-sm)', marginBottom: '20px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Bu işlem için kesilecek kredi:</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-primary)' }}>
                  {(selectedProvider.creditCost > 0 ? selectedProvider.creditCost : defaultCost)} Kredi
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Barkod Ön Eki (Opsiyonel)</label>
                <input
                  type="text"
                  className="form-input"
                  value={importConfig.barcodePrefix}
                  onChange={(e) => setImportConfig({...importConfig, barcodePrefix: e.target.value})}
                  placeholder="Örn: ABC_"
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>Trendyol'da ürünlerinizin karışmaması için barkod başına eklenecek metin</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedProvider(null)}>İptal</button>
                <button type="submit" className="btn btn-primary" disabled={importing}>
                  {importing ? 'Ekleniyor...' : 'Mağazama Ekle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
