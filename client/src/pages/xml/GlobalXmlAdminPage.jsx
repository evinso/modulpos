import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Trash2, Link, Save, X, Globe, RefreshCw, Eye, ArrowRight, Search, FolderTree, AlertCircle, Check, Loader2 } from 'lucide-react';
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
    creditCost: '',
    isActive: true
  });

  // Mapping state
  const [mapping, setMapping] = useState({});
  const [categoryMappingConfig, setCategoryMappingConfig] = useState({});
  const [categoryMappingStr, setCategoryMappingStr] = useState('{}');
  const [analyzing, setAnalyzing] = useState(false);
  const [xmlAnalysis, setXmlAnalysis] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  // Category Mapping advanced state
  const [trendyolCategories, setTrendyolCategories] = useState([]);
  const [catLoading, setCatLoading] = useState(false);
  const [selectedLocal, setSelectedLocal] = useState('');
  const [catSearch, setCatSearch] = useState('');
  const [selectedTrendyol, setSelectedTrendyol] = useState(null);
  const [requiredAttributes, setRequiredAttributes] = useState([]);
  const [attributeMappings, setAttributeMappings] = useState({});
  const [attrLoading, setAttrLoading] = useState(false);

  useEffect(() => {
    fetchProviders();
    fetchTrendyolCategories();
  }, []);

  const fetchTrendyolCategories = async () => {
    setCatLoading(true);
    try {
      const res = await api.get('/global-xml/trendyol-categories');
      setTrendyolCategories(res.data?.categories || res.data || []);
    } catch (err) {
      console.error('Trendyol categories load error:', err);
      toast.error('Trendyol kategorileri yüklenemedi: ' + (err.response?.data?.error || err.message));
    } finally {
      setCatLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedTrendyol) {
      setRequiredAttributes([]);
      setAttributeMappings({});
      return;
    }
    const fetchAttrs = async () => {
      setAttrLoading(true);
      try {
        const res = await api.get(`/global-xml/trendyol-categories/${selectedTrendyol.id}/attributes`);
        const attrs = res.data?.categoryAttributes || [];
        const required = attrs.filter(a => a.required);
        setRequiredAttributes(required);
        
        const initialMappings = {};
        required.forEach(a => {
          initialMappings[a.attribute.id] = { name: a.attribute.name, valueId: '', valueName: '' };
        });
        setAttributeMappings(initialMappings);
      } catch (err) {
        toast.error('Kategori özellikleri alınamadı');
      } finally {
        setAttrLoading(false);
      }
    };
    fetchAttrs();
  }, [selectedTrendyol]);

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

  // Build flat searchable list from tree
  const flatCategories = useMemo(() => {
    const result = [];
    const flatten = (cats, path = '') => {
      if (!Array.isArray(cats)) return;
      for (const cat of cats) {
        const fullPath = path ? `${path} > ${cat.name}` : cat.name;
        result.push({ ...cat, fullPath });
        if (cat.subCategories?.length) {
          flatten(cat.subCategories, fullPath);
        }
      }
    };
    flatten(trendyolCategories);
    return result;
  }, [trendyolCategories]);

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    if (!catSearch.trim()) return [];
    const q = catSearch.toLowerCase();
    return flatCategories
      .filter(c => !c.subCategories?.length) // Only leaf categories
      .filter(c => c.fullPath.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [catSearch, flatCategories]);

  const handleSaveMapping = () => {
    if (!selectedLocal || !selectedTrendyol) return;
    
    // Check if all required attributes are mapped
    const unmappedAttr = requiredAttributes.find(a => !attributeMappings[a.attribute.id]?.valueId && !attributeMappings[a.attribute.id]?.valueName);
    if (unmappedAttr) {
      toast.error(`"${unmappedAttr.attribute.name}" özelliği zorunludur.`);
      return;
    }

    const newMapping = {
      marketplaceCategoryId: String(selectedTrendyol.id),
      marketplaceCategoryName: selectedTrendyol.fullPath || selectedTrendyol.name,
      attributes: JSON.stringify(attributeMappings)
    };

    const newConfig = { ...categoryMappingConfig, [selectedLocal]: newMapping };
    setCategoryMappingConfig(newConfig);
    setCategoryMappingStr(JSON.stringify(newConfig, null, 2));
    
    toast.success('Kategori eşleştirmesi JSON\'a eklendi');
    setSelectedLocal('');
    setSelectedTrendyol(null);
    setCatSearch('');
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
        creditCost: provider.creditCost || '',
        isActive: provider.isActive
      });
      
      let initialMapping = {};
      if (provider.mappingConfig) {
        try { initialMapping = JSON.parse(provider.mappingConfig); } catch(e) {}
      }
      setMapping(initialMapping);
      
      let initialCatMapping = {};
      let initialCatStr = '{}';
      if (provider.categoryMappingConfig) {
        try { 
          initialCatMapping = JSON.parse(provider.categoryMappingConfig); 
          initialCatStr = JSON.stringify(initialCatMapping, null, 2);
        } catch(e) {}
      }
      setCategoryMappingConfig(initialCatMapping);
      setCategoryMappingStr(initialCatStr);
      
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
        creditCost: '',
        isActive: true
      });
      setMapping({});
      setCategoryMappingConfig({});
      setCategoryMappingStr('{}');
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
      let parsedCatConfig = {};
      try {
        if (categoryMappingStr && categoryMappingStr.trim() !== '' && categoryMappingStr !== '{}') {
          parsedCatConfig = JSON.parse(categoryMappingStr);
        }
      } catch (err) {
        setSaving(false);
        toast.error('Kategori eşleştirme JSON formatı hatalı. Lütfen geçerli bir JSON girin.');
        return;
      }

      const payload = { 
        ...formData, 
        mappingConfig: mapping,
        categoryMappingConfig: Object.keys(parsedCatConfig).length > 0 ? parsedCatConfig : null
      };

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

  const [deleteModalProvider, setDeleteModalProvider] = useState(null);

  const handleDelete = (provider) => {
    setDeleteModalProvider(provider);
  };

  const confirmDeleteProvider = async () => {
    if (!deleteModalProvider) return;
    try {
      await api.delete(`/global-xml/${deleteModalProvider.id}`);
      toast.success('Silindi');
      setDeleteModalProvider(null);
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
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p)}>
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

      {/* Delete Confirmation Modal */}
      {deleteModalProvider && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 420, padding: 0 }}>
            <div className="table-header">
              <h3>Tedarikçi Silme Onayı</h3>
              <button className="text-btn" onClick={() => setDeleteModalProvider(null)}><X size={20} /></button>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
                <strong>{deleteModalProvider.name}</strong> adlı global XML sağlayıcısını silmek istediğinize emin misiniz? <br/><br/>
                <span style={{ color: 'var(--danger)', fontWeight: 500 }}>Bu işlem geri alınamaz!</span>
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => setDeleteModalProvider(null)}>İptal</button>
                <button className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: 'white' }} onClick={confirmDeleteProvider}>
                  Evet, Sil
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

                <div className="form-group" style={{ marginBottom: 24, maxWidth: 300 }}>
                  <label className="form-label">💰 Kredi Maliyeti</label>
                  <input type="number" step="0.5" min="0" className="form-input" value={formData.creditCost} onChange={e => setFormData({...formData, creditCost: e.target.value})} placeholder="Varsayılan: Sistem ayarı" />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>Bu XML'i eklemek için kullanıcıdan kesilecek kredi. Boş bırakılırsa sistem varsayılanı kullanılır.</span>
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

                    {xmlAnalysis.categories && xmlAnalysis.categories.length > 0 && (
                      <div style={{ marginTop: 32, borderTop: '1px solid var(--border-color)', paddingTop: 24 }}>
                        <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Link size={18} style={{ color: 'var(--accent-primary)' }} />
                          Kategori Eşleştirmesi
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24 }}>
                          Bu XML içindeki kategorileri tüm kullanıcılar için otomatik eşleştirmek istiyorsanız, aşağıdan XML kategorisi ve Trendyol kategorisini seçip zorunlu alanları belirleyebilirsiniz.
                        </p>
                        
                        <div className="card" style={{ marginBottom: 24, padding: 24, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: 16, alignItems: 'start' }}>
                            {/* Local Category */}
                            <div>
                              <label className="form-label">Yerel Kategori (XML)</label>
                              <select
                                className="form-select"
                                value={selectedLocal}
                                onChange={e => setSelectedLocal(e.target.value)}
                              >
                                <option value="">Kategori seçin...</option>
                                {xmlAnalysis.categories.map(cat => (
                                  <option key={cat} value={cat} style={{ color: categoryMappingConfig[cat] ? 'var(--success)' : undefined }}>
                                    {cat} {categoryMappingConfig[cat] ? '✓' : ''}
                                  </option>
                                ))}
                              </select>
                              {selectedLocal && categoryMappingConfig[selectedLocal] && (
                                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', fontSize: 12 }}>
                                  <span style={{ color: 'var(--success)', fontWeight: 600 }}>Mevcut eşleştirme:</span>
                                  <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>{categoryMappingConfig[selectedLocal].marketplaceCategoryName}</span>
                                </div>
                              )}
                            </div>

                            {/* Arrow */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 28 }}>
                              <ArrowRight size={20} style={{ color: 'var(--accent-primary)' }} />
                            </div>

                            {/* Trendyol Category Search */}
                            <div>
                              <label className="form-label">Trendyol Kategorisi</label>
                              <div style={{ position: 'relative' }}>
                                <Search size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                                <input
                                  className="form-input"
                                  style={{ paddingLeft: 34 }}
                                  placeholder="Trendyol'da kategori ara..."
                                  value={catSearch}
                                  onChange={e => { setCatSearch(e.target.value); setSelectedTrendyol(null); }}
                                  disabled={catLoading}
                                />
                              </div>

                              {catLoading && (
                                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Loader2 size={14} className="spinning" /> Kategoriler yükleniyor...
                                </div>
                              )}

                              {selectedTrendyol && (
                                <div style={{
                                  marginTop: 8, padding: '8px 12px', borderRadius: 8,
                                  background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                                  fontSize: 13, display: 'flex', alignItems: 'center', gap: 6
                                }}>
                                  <Check size={14} style={{ color: 'var(--accent-primary)' }} />
                                  <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{selectedTrendyol.fullPath || selectedTrendyol.name}</span>
                                </div>
                              )}

                              {catSearch.trim() && !selectedTrendyol && (
                                <div style={{
                                  marginTop: 4, maxHeight: 250, overflowY: 'auto',
                                  background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                                  borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 30px rgba(0,0,0,0.3)'
                                }}>
                                  {filteredCategories.length === 0 ? (
                                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                                      Kategori bulunamadı
                                    </div>
                                  ) : (
                                    filteredCategories.map(cat => (
                                      <button
                                        type="button"
                                        key={cat.id}
                                        onClick={() => { setSelectedTrendyol(cat); setCatSearch(cat.name); }}
                                        style={{
                                          display: 'block', width: '100%', padding: '10px 14px',
                                          background: 'none', border: 'none', borderBottom: '1px solid var(--border-color)',
                                          textAlign: 'left', cursor: 'pointer', transition: 'background 0.15s',
                                          fontFamily: 'inherit', fontSize: 13, color: 'var(--text-primary)'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.06)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                      >
                                        <div style={{ fontWeight: 500 }}>{cat.name}</div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{cat.fullPath}</div>
                                      </button>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Required Attributes Section */}
                          {selectedTrendyol && (
                            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-color)' }}>
                              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <AlertCircle size={16} style={{ color: 'var(--warning)' }} />
                                Zorunlu Kategori Özellikleri
                              </h4>
                              
                              {attrLoading ? (
                                <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)' }}>
                                  <Loader2 size={16} className="spinning" /> Özellikler yükleniyor...
                                </div>
                              ) : requiredAttributes.length === 0 ? (
                                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                  Bu kategori için zorunlu özellik bulunmuyor.
                                </div>
                              ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
                                  {requiredAttributes.map(attr => (
                                    <div key={attr.attribute.id}>
                                      <label className="form-label">
                                        {attr.attribute.name}
                                        <span style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>
                                      </label>
                                      {attr.allowCustom ? (
                                        <input 
                                          type="text" 
                                          className="form-input" 
                                          placeholder={`${attr.attribute.name} girin veya {alan} yazın`}
                                          value={attributeMappings[attr.attribute.id]?.valueName || ''}
                                          onChange={e => setAttributeMappings(prev => ({
                                            ...prev,
                                            [attr.attribute.id]: { name: attr.attribute.name, valueName: e.target.value }
                                          }))}
                                        />
                                      ) : (
                                        <select 
                                          className="form-select"
                                          value={attributeMappings[attr.attribute.id]?.valueId || ''}
                                          onChange={e => {
                                            const valId = e.target.value;
                                            const valObj = attr.attributeValues.find(v => v.id.toString() === valId);
                                            setAttributeMappings(prev => ({
                                              ...prev,
                                              [attr.attribute.id]: { 
                                                name: attr.attribute.name, 
                                                valueId: valId, 
                                                valueName: valObj ? valObj.name : '' 
                                              }
                                            }));
                                          }}
                                        >
                                          <option value="">Seçiniz...</option>
                                          {attr.attributeValues.map(v => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                          ))}
                                        </select>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={handleSaveMapping}
                              disabled={!selectedLocal || !selectedTrendyol}
                            >
                              <Check size={14} /> Eşleştirmeyi JSON'a Ekle
                            </button>
                          </div>
                        </div>
                        
                        <div>
                          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Mevcut Eşleştirme JSON</span>
                            {Object.keys(categoryMappingConfig).length > 0 && (
                              <button type="button" className="text-btn" onClick={() => {
                                setCategoryMappingConfig({});
                                setCategoryMappingStr('{}');
                              }} style={{ color: 'var(--danger)', fontSize: 12 }}>
                                Tümünü Temizle
                              </button>
                            )}
                          </h4>
                          <textarea
                            className="form-textarea"
                            style={{ height: 200, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre' }}
                            placeholder={`{\n  "Elektronik > Telefon": {\n    "marketplaceCategoryId": "384",\n    "marketplaceCategoryName": "Cep Telefonu",\n    "attributes": "{\\"456\\": {\\"valueId\\": \\"789\\"}}"\n  }\n}`}
                            value={categoryMappingStr}
                            onChange={e => {
                              setCategoryMappingStr(e.target.value);
                              try {
                                if (!e.target.value) { setCategoryMappingConfig({}); return; }
                                const parsed = JSON.parse(e.target.value);
                                setCategoryMappingConfig(parsed);
                              } catch(err) {}
                            }}
                          />
                        </div>
                      </div>
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
