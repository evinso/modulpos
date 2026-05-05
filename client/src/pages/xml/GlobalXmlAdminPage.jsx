import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Link, Save, X, Globe, RefreshCw, Eye, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

const PRODUCT_FIELDS = [
  { key: 'sku', label: 'SKU / Ürün Kodu', required: true, icon: '🔑' },
  { key: 'barcode', label: 'Barkod', required: false, icon: '📊' },
  { key: 'title', label: 'Ürün Adı', required: true, icon: '📝' },
  { key: 'description', label: 'Açıklama', required: false, icon: '📄' },
  { key: 'price', label: 'Alış Fiyatı', required: true, icon: '💰' },
  { key: 'listPrice', label: 'Liste Fiyatı', required: false, icon: '🏷️' },
  { key: 'cost', label: 'Maliyet Fiyatı', required: false, icon: '💵' },
  { key: 'stock', label: 'Stok Miktarı', required: true, icon: '📦' },
  { key: 'brand', label: 'Marka', required: false, icon: '🏢' },
  { key: 'category', label: 'Kategori', required: false, icon: '📁' },
  { key: 'images', label: 'Görsel URL', required: false, icon: '🖼️' },
];

const MappingInterface = ({ analysis, currentMapping, onMappingChange, onPreview, onSave, previewResult }) => {
  if (!analysis) return null;

  const xmlFields = analysis.fields.filter(f => f.type === 'string' || f.type === 'number' || f.type === 'array');

  return (
    <div>
      <div className="alert alert-success" style={{ marginBottom: 20 }}>
        ✅ XML başarıyla analiz edildi! <strong>{analysis.totalProducts}</strong> ürün bulundu.
        Aşağıda XML'inizdeki alanları ürün alanlarıyla eşleştirin.
      </div>

      <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
        {PRODUCT_FIELDS.map(field => (
          <div key={field.key} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
            border: `1px solid ${currentMapping[field.key] ? 'rgba(16,185,129,0.3)' : 'var(--border-color)'}`,
          }}>
            <div style={{ flex: '0 0 180px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>{field.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{field.label}</div>
                {field.required && <span style={{ fontSize: 10, color: 'var(--danger)' }}>Zorunlu</span>}
              </div>
            </div>

            <ArrowRight size={16} style={{ color: currentMapping[field.key] ? 'var(--success)' : 'var(--text-muted)', flex: '0 0 16px' }} />

            <div style={{ flex: 1 }}>
              {field.key === 'images' ? (() => {
                const selectedArr = (currentMapping[field.key] || '').split(',').filter(Boolean);
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selectedArr.map((sel, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 8 }}>
                        <select
                          className="form-select"
                          value={sel}
                          onChange={(e) => {
                            const newArr = [...selectedArr];
                            newArr[idx] = e.target.value;
                            onMappingChange({ ...currentMapping, [field.key]: newArr.filter(Boolean).join(',') });
                          }}
                          style={{ flex: 1, fontSize: 13, padding: '8px 12px', borderColor: 'rgba(16,185,129,0.3)' }}
                        >
                          <option value="">— Kaldır —</option>
                          {xmlFields.map(xf => (
                            <option key={xf.path} value={xf.path}>
                              {xf.path} {xf.sample ? `→ "${String(xf.sample).substring(0, 50)}"` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    
                    <select
                      className="form-select"
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const newArr = [...selectedArr, e.target.value];
                        onMappingChange({ ...currentMapping, [field.key]: newArr.filter(Boolean).join(',') });
                      }}
                      style={{ fontSize: 13, padding: '8px 12px', borderStyle: 'dashed' }}
                    >
                      <option value="">+ Yeni görsel alanı seç/ekle...</option>
                      {xmlFields.filter(xf => !selectedArr.includes(xf.path)).map(xf => (
                        <option key={xf.path} value={xf.path}>
                          {xf.path} {xf.sample ? `→ "${String(xf.sample).substring(0, 50)}"` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })() : (
                <select
                  className="form-select"
                  value={currentMapping[field.key] || ''}
                  onChange={(e) => onMappingChange({ ...currentMapping, [field.key]: e.target.value })}
                  style={{
                    background: 'var(--bg-primary)',
                    fontSize: 13,
                    padding: '8px 12px',
                    borderColor: currentMapping[field.key] ? 'rgba(16,185,129,0.3)' : 'var(--border-color)',
                  }}
                >
                  <option value="">— Eşleştirme yok —</option>
                  {xmlFields.map(xf => (
                    <option key={xf.path} value={xf.path}>
                      {xf.path} {xf.sample ? `→ "${String(xf.sample).substring(0, 50)}"` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {currentMapping[field.key] && (
              <div style={{
                flex: '0 0 200px', fontSize: 12, color: 'var(--text-secondary)',
                background: 'var(--bg-primary)', padding: '6px 10px', borderRadius: 6,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {(() => {
                  const sample = analysis.sampleData?.[0];
                  if (!sample) return '-';
                  if (field.key === 'images' && currentMapping[field.key].includes(',')) {
                    return currentMapping[field.key].split(',').map(k => {
                      const parts = k.split('.');
                      let val = sample;
                      for(const p of parts) { if(val) val = val[p]; }
                      return val;
                    }).filter(Boolean).join(' | ') || '-';
                  }
                  
                  const parts = currentMapping[field.key].split('.');
                  let val = sample;
                  for(const p of parts) { if(val) val = val[p]; }
                  return val ? String(val) : '-';
                })()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default function GlobalXmlAdminPage() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    format: 'xml',
    description: '',
    logo: '',
    barcodePrefix: '',
    priceMarkup: '',
    priceMarkupPct: '',
    isActive: true
  });

  // Mapping state
  const [mapping, setMapping] = useState({});
  const [analyzing, setAnalyzing] = useState(false);
  const [xmlAnalysis, setXmlAnalysis] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const res = await api.get('/global-xml/all');
      setProviders(res.data);
    } catch (error) {
      toast.error('Global XML listesi alınamadı');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (provider = null) => {
    if (provider) {
      setFormData({
        name: provider.name,
        url: provider.url,
        format: provider.format,
        description: provider.description || '',
        logo: provider.logo || '',
        barcodePrefix: provider.barcodePrefix || '',
        priceMarkup: provider.priceMarkup || '',
        priceMarkupPct: provider.priceMarkupPct || '',
        isActive: provider.isActive
      });
      
      let initialMapping = {};
      if (provider.mappingConfig) {
        try { initialMapping = JSON.parse(provider.mappingConfig); } catch(e) {}
      }
      setMapping(initialMapping);
      setEditingProvider(provider);
    } else {
      setFormData({
        name: '',
        url: '',
        format: 'xml',
        description: '',
        logo: '',
        barcodePrefix: '',
        priceMarkup: '',
        priceMarkupPct: '',
        isActive: true
      });
      setMapping({});
      setEditingProvider(null);
    }
    setXmlAnalysis(null);
    setPreviewData(null);
    setIsModalOpen(true);
  };

  const handleAnalyze = async () => {
    if (!formData.url) return toast.error('Lütfen önce XML URL girin');
    setAnalyzing(true);
    try {
      const res = await api.post('/xml-sources/analyze', { url: formData.url });
      if (res.data && res.data.success) {
        setXmlAnalysis(res.data);
        toast.success(`${res.data.totalProducts} ürün başarıyla analiz edildi`);
      } else {
        toast.error(res.data?.error || 'Analiz başarısız');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'XML analiz hatası');
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePreview = () => {
    if (!xmlAnalysis || !xmlAnalysis.sampleData) return;
    setPreviewing(true);
    try {
      const mapped = xmlAnalysis.sampleData.map(row => {
        const product = {};
        for (const field of PRODUCT_FIELDS) {
          const xmlField = mapping[field.key];
          if (!xmlField) {
            product[field.key] = '-';
          } else if (field.key === 'images' && xmlField.includes(',')) {
            const urls = xmlField.split(',').map(f => f.trim()).map(f => row[f]).filter(Boolean);
            product[field.key] = urls.length > 0 ? urls[0] : '-';
          } else {
            const val = row[xmlField];
            product[field.key] = (val !== null && val !== undefined && val !== '') ? String(val) : '-';
          }
        }
        return product;
      });
      setPreviewData(mapped);
      toast.success('Önizleme oluşturuldu');
    } catch (err) {
      toast.error('Önizleme hatası: ' + err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const payload = { ...formData, mappingConfig: mapping };

      if (editingProvider) {
        await api.put(`/global-xml/${editingProvider.id}`, payload);
        toast.success('Global XML güncellendi');
      } else {
        await api.post('/global-xml', payload);
        toast.success('Global XML oluşturuldu');
      }
      
      setIsModalOpen(false);
      fetchProviders();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Bu global XML sağlayıcısını silmek istediğinize emin misiniz?')) return;
    
    try {
      await api.delete(`/global-xml/${id}`);
      toast.success('Silindi');
      fetchProviders();
    } catch (error) {
      toast.error('Silme başarısız');
    }
  };

  return (
    <div className="global-xml-admin">
      <div className="page-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>Global XML Tedarikçileri (Sistem Geneli)</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Kullanıcıların tek tıkla ekleyebileceği hazır XML tedarikçilerini yönetin.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
          <Plus size={16} /> Yeni Tedarikçi Ekle
        </button>
      </div>

      <div className="table-container">
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>Yükleniyor...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Durum</th>
                <th>Tedarikçi Adı</th>
                <th>URL</th>
                <th>Açıklama</th>
                <th>Eşleştirme</th>
                <th style={{ textAlign: 'right' }}>İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    Henüz hiç global tedarikçi eklenmemiş.
                  </td>
                </tr>
              ) : (
                providers.map(p => {
                  const hasMapping = p.mappingConfig && p.mappingConfig !== '{}' && p.mappingConfig !== 'null';
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className={`badge ${p.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {p.isActive ? 'Aktif' : 'Pasif'}
                        </span>
                      </td>
                      <td style={{ fontWeight: '500' }}>{p.name}</td>
                      <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={p.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }}>
                          {p.url}
                        </a>
                      </td>
                      <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                        {p.description}
                      </td>
                      <td>
                        <span className={`badge ${hasMapping ? 'badge-success' : 'badge-warning'}`}>
                          {hasMapping ? '✓ Hazır' : '⚠ Eksik'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => handleOpenModal(p)} style={{ marginRight: '8px' }}>
                          <Edit2 size={14} />
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p.id)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '900px', padding: '0', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="table-header" style={{ flexShrink: 0 }}>
              <h3>{editingProvider ? 'Tedarikçi Düzenle' : 'Yeni Global Tedarikçi'}</h3>
              <button className="text-btn" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>
            
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              <form id="providerForm" onSubmit={handleSave}>
                <div className="grid grid-2" style={{ marginBottom: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Tedarikçi Adı</label>
                    <input type="text" className="form-input" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Örn: X Bilişim" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Logo URL (Opsiyonel)</label>
                    <input type="url" className="form-input" value={formData.logo} onChange={e => setFormData({...formData, logo: e.target.value})} placeholder="https://..." />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label">XML URL</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="url" className="form-input" required value={formData.url} onChange={e => setFormData({...formData, url: e.target.value})} placeholder="https://..." style={{ flex: 1 }} />
                    <button type="button" className="btn btn-secondary" onClick={handleAnalyze} disabled={analyzing || !formData.url}>
                      {analyzing ? <><RefreshCw size={14} className="spinning" /> Analiz ediliyor...</> : 'XML Analiz Et'}
                    </button>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '24px' }}>
                  <label className="form-label">Açıklama (Kullanıcılara Gösterilecek)</label>
                  <textarea className="form-textarea" style={{ minHeight: '60px' }} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="XML kaynağı hakkında bilgi..." />
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '24px 0' }} />
                
                <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>Gizli Fiyatlandırma ve Barkod Ayarları</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
                  Bu ayarlar kullanıcıdan tamamen gizlenir. Kullanıcı ürünleri çektiğinde alış fiyatları ve barkodlar bu ayarlara göre değişmiş olarak gelir.
                </p>

                <div className="grid grid-3" style={{ marginBottom: '24px', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Sabit Kâr Ekle (TL)</label>
                    <input type="number" step="0.01" className="form-input" value={formData.priceMarkup} onChange={e => setFormData({...formData, priceMarkup: e.target.value})} placeholder="Örn: 10" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Yüzdelik Kâr Ekle (%)</label>
                    <input type="number" step="0.01" className="form-input" value={formData.priceMarkupPct} onChange={e => setFormData({...formData, priceMarkupPct: e.target.value})} placeholder="Örn: 20" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Global Barkod Ön Eki</label>
                    <input type="text" className="form-input" value={formData.barcodePrefix} onChange={e => setFormData({...formData, barcodePrefix: e.target.value})} placeholder="Örn: GLOB-" />
                  </div>
                </div>

                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
                  <input type="checkbox" id="isActive" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} />
                  <label htmlFor="isActive" style={{ fontSize: '14px', fontWeight: '500' }}>Aktif (Kullanıcılar Görebilir)</label>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '24px 0' }} />
                
                <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Alan Eşleştirmesi</h3>
                
                {analyzing ? (
                  <div className="loading-spinner" style={{ margin: '40px 0' }}><div className="spinner"></div></div>
                ) : xmlAnalysis ? (
                  <>
                    <MappingInterface
                      analysis={xmlAnalysis}
                      currentMapping={mapping}
                      onMappingChange={setMapping}
                      onPreview={handlePreview}
                      previewResult={previewData}
                    />
                    
                    {/* Preview Table */}
                    {previewData && previewData.length > 0 && (
                      <div style={{ marginTop: 24 }}>
                        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--accent-primary)' }}>
                          📋 Önizleme — İlk 5 Ürün
                        </h4>
                        <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                          <table style={{ minWidth: 900 }}>
                            <thead>
                              <tr>
                                {PRODUCT_FIELDS.filter(f => f.key !== 'description' && f.key !== 'images').map(f => (
                                  <th key={f.key} style={{ fontSize: 11, padding: '8px 10px', whiteSpace: 'nowrap' }}>{f.icon} {f.label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {previewData.slice(0, 5).map((row, i) => (
                                <tr key={i}>
                                  {PRODUCT_FIELDS.filter(f => f.key !== 'description' && f.key !== 'images').map(f => (
                                    <td key={f.key} style={{
                                      fontSize: 12, padding: '8px 10px', maxWidth: 180,
                                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                      color: row[f.key] && row[f.key] !== '-' && row[f.key] !== 'null' && row[f.key] !== '0' ? 'var(--text-primary)' : 'var(--danger)'
                                    }}>
                                      {row[f.key] ?? '-'}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    
                    {!previewData && (
                      <button type="button" className="btn btn-secondary" onClick={handlePreview} style={{ marginTop: '16px' }}>
                        <Eye size={16} /> Eşleştirmeyi Önizle
                      </button>
                    )}
                  </>
                ) : (
                  <div className="alert alert-warning">
                    ⚠️ Lütfen eşleştirme yapabilmek için önce üst kısımdan bir XML URL'si girin ve "XML Analiz Et" butonuna tıklayın.
                    Eğer halihazırda kayıtlı bir eşleştirmeniz varsa, onu güncellemek için de analiz işlemini yapmanız gerekir.
                  </div>
                )}
              </form>
            </div>

            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>İptal</button>
              <button type="submit" form="providerForm" className="btn btn-primary" disabled={saving}>
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
