import React, { useState, useEffect } from 'react';
import { Download, Search, Tag, AlertCircle, CheckCircle2, PackageSearch, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useNavigate } from 'react-router-dom';

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
              
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.5', flex: 1, marginBottom: '12px' }}>
                {provider.description || "Bu XML kaynağı uzman ekibimiz tarafından sizin için önceden ayarlanmıştır."}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: 'var(--warning)',
                  display: 'flex', alignItems: 'center', gap: 4
                }}>
                  <Wallet size={14} />
                  {(provider.creditCost > 0 ? provider.creditCost : defaultCost)} Kredi
                </span>
                <span className="badge badge-success" style={{ marginTop: 0 }}>Hazır Eşleştirme</span>
              </div>
              
              <button 
                className="btn btn-primary" 
                style={{ width: '100%' }}
                onClick={() => setSelectedProvider(provider)}
              >
                <Download size={16} /> Mağazama Ekle
              </button>
            </div>
          ))}
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
                <label className="form-label">Kâr Marjı (%)</label>
                <input
                  type="number"
                  className="form-input"
                  value={importConfig.priceMarkupPct}
                  onChange={(e) => setImportConfig({...importConfig, priceMarkupPct: e.target.value})}
                  placeholder="Örn: 20"
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>XML'deki fiyata eklenecek % kâr marjı</span>
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
