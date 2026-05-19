import { useState, useEffect, useMemo } from 'react';
import { Plus, RefreshCw, Trash2, FileCode2, Clock, CheckCircle, XCircle, Settings, Eye, ArrowRight, Link2, Send, Tag, DollarSign, Search, Check, FolderTree, Loader2, AlertCircle, ImageOff, X } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import LoadingOverlay from '../../components/LoadingOverlay';

// Ürün alanları tanımı
const PRODUCT_FIELDS = [
  { key: 'sku', label: 'SKU / Ürün Kodu', required: true, icon: '🔑' },
  { key: 'barcode', label: 'Barkod', required: false, icon: '📊' },
  { key: 'title', label: 'Ürün Adı', required: true, icon: '📝' },
  { key: 'description', label: 'Açıklama', required: false, icon: '📄' },
  { key: 'price', label: 'Alış Fiyatı', required: true, icon: '💰' },
  { key: 'stock', label: 'Stok Miktarı', required: true, icon: '📦' },
  { key: 'brand', label: 'Marka', required: false, icon: '🏢' },
  { key: 'category', label: 'Kategori', required: false, icon: '📁' },
  { key: 'images', label: 'Görsel URL', required: false, icon: '🖼️' },
];

export default function XmlSourcesPage() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMappingModal, setShowMappingModal] = useState(null); // source id
  const [syncing, setSyncing] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [xmlPreviewSource, setXmlPreviewSource] = useState(null);
  const [xmlPreviewData, setXmlPreviewData] = useState(null);
  const [xmlPreviewLoading, setXmlPreviewLoading] = useState(false);

  // Add form
  const [addForm, setAddForm] = useState({ name: '', url: '', syncIntervalMin: 60, barcodePrefix: '', priceMarkup: '', priceMarkupPct: '', defaultCategoryId: '', defaultBrandId: '', defaultVatRate: '10', purchaseVatRate: '0' });

  // Mapping state
  const [analyzing, setAnalyzing] = useState(false);
  const [xmlAnalysis, setXmlAnalysis] = useState(null);
  const [mapping, setMapping] = useState({});
  const [previewData, setPreviewData] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);

  // Add wizard state
  const [addStep, setAddStep] = useState(1); // 1: basic info, 2: mapping, 3: config, 4: preview, 5: save+send
  const [addAnalysis, setAddAnalysis] = useState(null);
  const [addMapping, setAddMapping] = useState({});
  const [addPreview, setAddPreview] = useState(null);
  const [savedSourceId, setSavedSourceId] = useState(null);
  const [sending, setSending] = useState(false);

  // Category mapping state
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [trendyolCategories, setTrendyolCategories] = useState([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const [selectedLocalForMap, setSelectedLocalForMap] = useState('');
  const [selectedTrendyolForMap, setSelectedTrendyolForMap] = useState(null);
  const [addCategoryMappings, setAddCategoryMappings] = useState({});

  useEffect(() => { 
    fetchSources(); 
    fetchConnections();
  }, []);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const trendyolConns = res.data.filter(c => c.marketplaceType === 'trendyol');
      setConnections(trendyolConns);
      if (trendyolConns.length > 0) {
        setSelectedConn(trendyolConns[0]);
        loadCategories(trendyolConns[0].id);
      }
    } catch { }
  };

  const loadCategories = async (connId) => {
    setCatLoading(true);
    try {
      const catRes = await api.get(`/marketplace/connections/${connId}/categories`);
      setTrendyolCategories(catRes.data?.categories || catRes.data || []);
    } catch (err) {
      toast.error('Trendyol kategorileri yüklenemedi');
    } finally { setCatLoading(false); }
  };

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

  const filteredCategories = useMemo(() => {
    if (!catSearch.trim()) return [];
    const q = catSearch.toLowerCase();
    return flatCategories
      .filter(c => !c.subCategories?.length)
      .filter(c => c.fullPath.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [catSearch, flatCategories]);

  const localCats = useMemo(() => {
    if (!addPreview) return [];
    const cats = new Set();
    addPreview.forEach(p => {
      if (p.category && p.category !== '-') cats.add(p.category);
    });
    return Array.from(cats).sort();
  }, [addPreview]);

  const handleAddCategoryMapping = () => {
    if (!selectedLocalForMap || !selectedTrendyolForMap || !selectedConn) return;
    setAddCategoryMappings(prev => ({
      ...prev,
      [selectedLocalForMap]: {
        marketplaceCategoryId: selectedTrendyolForMap.id,
        marketplaceCategoryName: selectedTrendyolForMap.fullPath || selectedTrendyolForMap.name,
        connectionId: selectedConn.id
      }
    }));
    setSelectedLocalForMap('');
    setSelectedTrendyolForMap(null);
    setCatSearch('');
  };

  const handleRemoveCategoryMapping = (localCat) => {
    setAddCategoryMappings(prev => {
      const next = { ...prev };
      delete next[localCat];
      return next;
    });
  };
  
  const handleOpenXmlPreview = async (source) => {
    setXmlPreviewSource(source);
    setXmlPreviewData(null);
    setXmlPreviewLoading(true);
    try {
      const res = await api.get(`/xml-sources/${source.id}/xml-preview`);
      setXmlPreviewData(res.data);
    } catch (err) {
      const msg = err.response?.data?.error || 'XML önizlemesi alınamadı';
      toast.error(msg);
      setXmlPreviewSource(null);
    } finally {
      setXmlPreviewLoading(false);
    }
  };

  const fetchSources = async () => {
    try {
      const res = await api.get('/xml-sources');
      setSources(res.data);
    } catch { toast.error('XML kaynakları yüklenemedi'); }
    finally { setLoading(false); }
  };

  // ===== ADD WIZARD =====
  const handleAnalyzeNew = async () => {
    if (!addForm.url) return toast.error('XML URL gerekli');
    setAnalyzing(true);
    try {
      const res = await api.post('/xml-sources/analyze', { url: addForm.url });
      if (res.data.success) {
        setAddAnalysis(res.data);
        setAddStep(2);
        toast.success(`${res.data.totalProducts} ürün bulundu! Şimdi alan eşleştirmesi yapın.`);
      } else {
        toast.error(res.data.error || 'XML analiz edilemedi');
      }
    } catch (err) { toast.error(err.response?.data?.error || 'XML analiz hatası'); }
    finally { setAnalyzing(false); }
  };

  const handleAddPreview = async () => {
    // Use already-analyzed data — no need to re-fetch from server
    if (!addAnalysis || !addAnalysis.sampleData) {
      toast.error('Önce XML analizi yapılmalı');
      return;
    }
    setPreviewing(true);
    try {
      const mapped = addAnalysis.sampleData.map(row => {
        const product = {};
        for (const field of PRODUCT_FIELDS) {
          const xmlField = addMapping[field.key];
          if (!xmlField) {
            product[field.key] = '-';
          } else if (field.key === 'images' && xmlField.includes(',')) {
            // Multiple image fields — join the URLs
            const urls = xmlField.split(',').map(f => f.trim()).map(f => row[f]).filter(Boolean);
            product[field.key] = urls.length > 0 ? urls[0] : '-'; // show first image URL in preview
          } else {
            const val = row[xmlField];
            product[field.key] = (val !== null && val !== undefined && val !== '') ? String(val) : '-';
          }
        }
        return product;
      });
      setAddPreview(mapped);
      setAddStep(3);
    } catch (err) {
      toast.error('Önizleme hatası: ' + err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleSaveAdd = async () => {
    try {
      const res = await api.post('/xml-sources', {
        name: addForm.name,
        url: addForm.url,
        syncIntervalMin: parseInt(addForm.syncIntervalMin),
        mappingConfig: addMapping,
        barcodePrefix: addForm.barcodePrefix || null,
        priceMarkup: parseFloat(addForm.priceMarkup) || 0,
        priceMarkupPct: parseFloat(addForm.priceMarkupPct) || 0,
        defaultCategoryId: addForm.defaultCategoryId || null,
        defaultBrandId: addForm.defaultBrandId || null,
        defaultVatRate: parseInt(addForm.defaultVatRate) || 10,
        purchaseVatRate: parseInt(addForm.purchaseVatRate) || 0,
      });
      setSavedSourceId(res.data.id);
      
      // Kategori eşleştirmelerini kaydet
      const mappings = Object.entries(addCategoryMappings);
      for (const [localCategory, mapData] of mappings) {
        try {
          await api.post(`/marketplace/connections/${mapData.connectionId}/category-mappings`, {
            localCategory,
            marketplaceCategoryId: mapData.marketplaceCategoryId,
            marketplaceCategoryName: mapData.marketplaceCategoryName
          });
        } catch (e) { console.error('Kategori eşleştirme kaydedilemedi', e); }
      }

      toast.success('XML kaynağı ve ayarları kaydedildi! Şimdi ürünleri çekin.');
      setAddStep(5);
      fetchSources();
    } catch (err) { toast.error(err.response?.data?.error || 'Kayıt hatası'); }
  };

  const handleSyncAndSend = async () => {
    if (!savedSourceId) return;
    setSending(true);
    try {
      const res = await api.post(`/xml-sources/${savedSourceId}/sync`);
      toast.success(`${res.data.results.total} ürün çekildi (${res.data.results.created} yeni, ${res.data.results.updated} güncellendi)`);
      resetAddWizard();
      fetchSources();
    } catch (err) { toast.error(err.response?.data?.error || 'Senkronizasyon hatası'); }
    finally { setSending(false); }
  };

  const resetAddWizard = () => {
    setShowAddModal(false);
    setAddStep(1);
    setAddForm({ name: '', url: '', syncIntervalMin: 60, barcodePrefix: '', priceMarkup: '', priceMarkupPct: '', defaultCategoryId: '', defaultBrandId: '', defaultVatRate: '10' });
    setAddAnalysis(null);
    setAddMapping({});
    setAddPreview(null);
    setSavedSourceId(null);
    setAddCategoryMappings({});
    setSelectedLocalForMap('');
    setSelectedTrendyolForMap(null);
    setCatSearch('');
  };

  // ===== EXISTING SOURCE MAPPING =====
  const openMapping = async (source) => {
    setShowMappingModal(source.id);
    setAnalyzing(true);
    setXmlAnalysis(null);
    setPreviewData(null);

    // Mevcut mapping'i yükle
    let existingMapping = {};
    if (source.mappingConfig) {
      try { existingMapping = JSON.parse(source.mappingConfig); } catch {}
    }
    setMapping(existingMapping);

    try {
      const res = await api.post(`/xml-sources/${source.id}/analyze`);
      if (res.data.success) {
        setXmlAnalysis(res.data);
      } else {
        toast.error(res.data.error || 'XML analiz edilemedi');
      }
    } catch (err) { toast.error(err.response?.data?.error || 'Analiz hatası'); }
    finally { setAnalyzing(false); }
  };

  const handlePreview = async () => {
    if (!showMappingModal) return;
    setPreviewing(true);
    try {
      const res = await api.post(`/xml-sources/${showMappingModal}/preview`, { mappingConfig: mapping });
      setPreviewData(res.data.preview);
      toast.success(`${res.data.totalProducts} ürün önizlemesi`);
    } catch (err) { toast.error(err.response?.data?.error || 'Önizleme hatası'); }
    finally { setPreviewing(false); }
  };

  const handleSaveMapping = async () => {
    if (!showMappingModal) return;
    setSavingMapping(true);
    try {
      await api.put(`/xml-sources/${showMappingModal}`, { mappingConfig: mapping });
      toast.success('Alan eşleştirmesi kaydedildi! Artık "Şimdi Çek" ile doğru veriler gelecek.');
      setShowMappingModal(null);
      setXmlAnalysis(null);
      setPreviewData(null);
      fetchSources();
    } catch (err) { toast.error('Kayıt hatası'); }
    finally { setSavingMapping(false); }
  };

  // ===== SYNC & DELETE =====
  const handleSync = async (id) => {
    setSyncing(id);
    try {
      const res = await api.post(`/xml-sources/${id}/sync`);
      toast.success(`${res.data.results.total} ürün işlendi (${res.data.results.created} yeni, ${res.data.results.updated} güncellendi)`);
      fetchSources();
    } catch (err) { toast.error(err.response?.data?.error || 'Senkronizasyon hatası'); }
    finally { setSyncing(null); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const id = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await api.delete(`/xml-sources/${id}`);
      toast.success('XML kaynağı silindi');
      fetchSources();
    } catch { toast.error('Silme hatası'); }
  };

  const statusIcon = (status) => {
    if (status === 'active') return <CheckCircle size={14} style={{ color: 'var(--success)' }} />;
    if (status === 'error') return <XCircle size={14} style={{ color: 'var(--danger)' }} />;
    return <Clock size={14} style={{ color: 'var(--warning)' }} />;
  };

  // ===== MAPPING UI COMPONENT =====
  const MappingInterface = ({ analysis, currentMapping, onMappingChange, onPreview, onSave, previewResult, isNew }) => {
    if (!analysis) return <div className="loading-spinner"><div className="spinner"></div></div>;

    const xmlFields = analysis.fields.filter(f => f.type === 'string' || f.type === 'number' || f.type === 'array');

    return (
      <div>
        {/* Bilgilendirme */}
        <div className="alert alert-success" style={{ marginBottom: 20 }}>
          ✅ XML başarıyla analiz edildi! <strong>{analysis.totalProducts}</strong> ürün bulundu.
          Aşağıda XML'inizdeki alanları ürün alanlarıyla eşleştirin.
        </div>

        {/* Eşleştirme tablosu */}
        <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
          {PRODUCT_FIELDS.map(field => (
            <div key={field.key} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
              background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${currentMapping[field.key] ? 'rgba(16,185,129,0.3)' : 'var(--border-color)'}`,
            }}>
              {/* Sol: Ürün alanı */}
              <div style={{ flex: '0 0 180px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>{field.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{field.label}</div>
                  {field.required && <span style={{ fontSize: 10, color: 'var(--danger)' }}>Zorunlu</span>}
                </div>
              </div>

              {/* Ortada: Ok */}
              <ArrowRight size={16} style={{ color: currentMapping[field.key] ? 'var(--success)' : 'var(--text-muted)', flex: '0 0 16px' }} />

              {/* Sağ: XML alan seçici */}
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
                                {xf.path} {xf.sample ? `→ "${xf.sample.substring(0, 50)}"` : ''}
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
                            {xf.path} {xf.sample ? `→ "${xf.sample.substring(0, 50)}"` : ''}
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
                        {xf.path} {xf.sample ? `→ "${xf.sample.substring(0, 50)}"` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Örnek değer */}
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

        {/* Önizleme butonu */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <button className="btn btn-secondary" onClick={onPreview} disabled={previewing}>
            <Eye size={14} /> {previewing ? 'Yükleniyor...' : 'Eşleştirmeyi Önizle'}
          </button>
        </div>

        {/* Önizleme tablosu */}
        {previewResult && previewResult.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--accent-primary)' }}>
              📋 Önizleme — İlk {previewResult.length} ürün (eşleştirme sonucu)
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
                  {previewResult.slice(0, 5).map((row, i) => (
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
      </div>
    );
  };

  return (
    <div>
      <LoadingOverlay visible={analyzing} message="XML Analiz Ediliyor..." submessage="Kaynak okunuyor ve alanlar tespit ediliyor, lütfen bekleyin." />
      <LoadingOverlay visible={!analyzing && previewing} message="Önizleme Hazırlanıyor..." submessage="Eşleştirme örnek veriye uygulanıyor." />
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>XML Kaynakları</h1><p>Tedarikçi XML'lerinizi bağlayın, alanları eşleştirin ve ürünleri otomatik çekin</p></div>
        <button className="btn btn-primary" onClick={() => { resetAddWizard(); setShowAddModal(true); }}><Plus size={16} /> XML Kaynağı Ekle</button>
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : sources.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <FileCode2 size={48} className="empty-icon" />
            <h3>Henüz XML kaynağı yok</h3>
            <p>Tedarikçinizin XML bağlantısını ekleyerek ürünleri otomatik çekmeye başlayın</p>
            <button className="btn btn-primary" onClick={() => { resetAddWizard(); setShowAddModal(true); }}><Plus size={16} /> İlk Kaynağı Ekle</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-2">
          {sources.map((s) => {
            const hasMapping = s.mappingConfig && s.mappingConfig !== '{}' && s.mappingConfig !== 'null';
            const isGlobal = !!s.globalProviderId;
            return (
              <div key={s.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {statusIcon(s.status)} {s.name}
                    </h3>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' }}>
                      {isGlobal ? <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>✨ Tedarikçi Havuzundan Eklendi (Bağlantı Gizli)</span> : s.url}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <span className={`badge ${hasMapping || isGlobal ? 'badge-success' : 'badge-warning'}`}>
                      {isGlobal ? '✓ Hazır Şablon' : (hasMapping ? '✓ Eşleştirildi' : '⚠ Eşleştirme Yok')}
                    </span>
                    <span className={`badge ${s.status === 'active' ? 'badge-success' : s.status === 'error' ? 'badge-danger' : 'badge-warning'}`}>
                      {s.status === 'active' ? 'Aktif' : s.status === 'error' ? 'Hata' : 'Bekliyor'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <span>📦 {s._count?.products || s.totalProducts || 0} ürün</span>
                  <span>⏱ Her {s.syncIntervalMin} dk</span>
                  <span>🕐 {s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString('tr-TR') : 'Henüz yok'}</span>
                </div>
                {s.errorMessage && <div className="alert alert-error" style={{ marginBottom: 12 }}>{s.errorMessage}</div>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {!isGlobal && (
                      <button className="btn btn-secondary btn-sm" onClick={() => openMapping(s)}>
                        <Settings size={14} /> Alan Eşleştir
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={() => handleOpenXmlPreview(s)}>
                      <Eye size={14} /> Önizle
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => handleSync(s.id)} disabled={syncing === s.id}>
                      <RefreshCw size={14} className={syncing === s.id ? 'spinning' : ''} />
                    {syncing === s.id ? 'Çekiliyor...' : 'Şimdi Çek'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(s.id)}><Trash2 size={14} /> Sil</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== ADD WIZARD MODAL ===== */}
      {showAddModal && (
        <div className="modal-overlay" onClick={resetAddWizard}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: addStep > 1 ? 900 : 560 }}>
            <div className="modal-header">
              <h3>
                {addStep === 1 && '1️⃣ XML Kaynağı Ekle'}
                {addStep === 2 && '2️⃣ Alan Eşleştirmesi'}
                {addStep === 3 && '3️⃣ Ürün Ayarları'}
                {addStep === 4 && '4️⃣ Önizleme & Kaydet'}
                {addStep === 5 && '✅ Tamamlandı'}
              </h3>
              <button className="modal-close" onClick={resetAddWizard}>×</button>
            </div>

            {/* Step indicators */}
            <div style={{ display: 'flex', gap: 4, padding: '12px 24px', borderBottom: '1px solid var(--border-color)' }}>
              {[1, 2, 3, 4, 5].map(step => (
                <div key={step} style={{
                  flex: 1, height: 4, borderRadius: 2,
                  background: step <= addStep ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  transition: 'background 0.3s'
                }} />
              ))}
            </div>

            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {/* Step 1: Basic Info */}
              {addStep === 1 && (
                <>
                  <div className="form-group">
                    <label className="form-label">Kaynak Adı *</label>
                    <input className="form-input" placeholder="ör: Ana Tedarikçi XML" value={addForm.name} onChange={e => setAddForm({...addForm, name: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">XML URL *</label>
                    <input className="form-input" placeholder="https://tedarikci.com/urunler.xml" value={addForm.url} onChange={e => setAddForm({...addForm, url: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Senkronizasyon Aralığı (dakika)</label>
                    <input type="number" className="form-input" value={addForm.syncIntervalMin} onChange={e => setAddForm({...addForm, syncIntervalMin: e.target.value})} min={5} />
                  </div>
                </>
              )}

              {/* Step 2: Field Mapping */}
              {addStep === 2 && (
                <MappingInterface
                  analysis={addAnalysis}
                  currentMapping={addMapping}
                  onMappingChange={setAddMapping}
                  onPreview={handleAddPreview}
                  previewResult={null}
                  isNew={true}
                />
              )}

              {/* Step 3: Product Config */}
              {addStep === 3 && (
                <div>
                  <div className="alert alert-info" style={{ marginBottom: 20 }}>
                    🔧 Ürünlerinize uygulanacak ayarları belirleyin. Bu ayarlar her senkronizasyonda otomatik uygulanır.
                  </div>

                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag size={16} style={{ color: 'var(--accent-primary)' }} /> Barkod Ayarları
                  </h4>
                  <div className="form-group">
                    <label className="form-label">Barkod Ön Eki</label>
                    <input className="form-input" placeholder="ör: TRY- (barkodların başına eklenir)" value={addForm.barcodePrefix} onChange={e => setAddForm({...addForm, barcodePrefix: e.target.value})} />
                    <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4, display: 'block' }}>
                      Örnek: Ön ek "TRY-" ise, barkod "12345" → "TRY-12345" olur
                    </small>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />

                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    📋 KDV Ayarları
                  </h4>
                  <div className="form-group" style={{ marginBottom: 16 }}>
                    <label className="form-label">Alış Fiyatı KDV Oranı</label>
                    <select
                      className="form-select"
                      value={addForm.purchaseVatRate ?? '0'}
                      onChange={e => setAddForm({...addForm, purchaseVatRate: e.target.value})}
                    >
                      <option value="0">%0 — KDV Dahil / KDV Yok</option>
                      <option value="1">%1 — KDV Hariç, %1 Ekle</option>
                      <option value="10">%10 — KDV Hariç, %10 Ekle</option>
                      <option value="20">%20 — KDV Hariç, %20 Ekle</option>
                    </select>
                    <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4, display: 'block' }}>
                      Tedarikçi fiyatları KDV hariç geliyorsa seçili oran alış fiyatına otomatik eklenir.
                    </small>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Ürün KDV Oranı (Trendyol)</label>
                    <select
                      className="form-select"
                      value={addForm.defaultVatRate}
                      onChange={e => setAddForm({...addForm, defaultVatRate: e.target.value})}
                    >
                      <option value="0">%0 - KDV Muaf</option>
                      <option value="1">%1</option>
                      <option value="10">%10</option>
                      <option value="20">%20</option>
                    </select>
                    <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4, display: 'block' }}>
                      Trendyol'a gönderilecek ürünlerin vergi oranı. Temmuz 2024 sonrası kabul edilen oranlar: %0, %1, %10, %20
                    </small>
                  </div>
                </div>
              )}



              {/* Step 5: Preview */}
              {addStep === 4 && addPreview && (
                <div>
                  <div className="alert alert-success" style={{ marginBottom: 16 }}>
                    ✅ Her şey hazır! Aşağıdaki önizlemeyi kontrol edin, doğruysa kaydedin.
                    {addForm.barcodePrefix && <><br/>📎 Barkod ön eki: <strong>{addForm.barcodePrefix}</strong></>}
                  </div>
                  <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                    <table style={{ minWidth: 800 }}>
                      <thead>
                        <tr>
                          {PRODUCT_FIELDS.filter(f => f.key !== 'description' && f.key !== 'images').map(f => (
                            <th key={f.key} style={{ fontSize: 11, padding: '8px 10px' }}>{f.icon} {f.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {addPreview.map((row, i) => (
                          <tr key={i}>
                            {PRODUCT_FIELDS.filter(f => f.key !== 'description' && f.key !== 'images').map(f => (
                              <td key={f.key} style={{
                                fontSize: 12, padding: '8px 10px', maxWidth: 160,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                color: row[f.key] && row[f.key] !== '-' ? 'var(--text-primary)' : 'var(--danger)'
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

              {/* Step 5: Done */}
              {addStep === 5 && (
                <div style={{ textAlign: 'center', padding: '30px 0' }}>
                  <CheckCircle size={48} style={{ color: 'var(--success)', marginBottom: 16 }} />
                  <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Kaynak başarıyla eklendi!</h3>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>Şimdi ürünleri sunucunuza çekin.</p>
                  <button className="btn btn-primary" onClick={handleSyncAndSend} disabled={sending} style={{ padding: '12px 32px' }}>
                    <RefreshCw size={16} className={sending ? 'spinning' : ''} />
                    {sending ? 'Ürünler çekiliyor...' : 'Ürünleri Çek'}
                  </button>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 12 }}>
                    Trendyol'a göndermek için <strong>Pazaryeri → Trendyol'a Gönder</strong> sayfasını kullanın.
                  </p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              {addStep > 1 && addStep < 5 && (
                <button className="btn btn-secondary" onClick={() => setAddStep(addStep - 1)}>← Geri</button>
              )}
              <div style={{ flex: 1 }} />
              {addStep === 1 && (
                <button className="btn btn-primary" onClick={handleAnalyzeNew} disabled={analyzing || !addForm.name || !addForm.url}>
                  {analyzing ? <><RefreshCw size={14} className="spinning" /> Analiz ediliyor...</> : <>Devam Et →</>}
                </button>
              )}
              {addStep === 2 && (
                <button className="btn btn-primary" onClick={() => { handleAddPreview(); setAddStep(3); }} disabled={previewing}>
                  {previewing ? 'Yükleniyor...' : 'Devam Et →'}
                </button>
              )}
              {addStep === 3 && (
                <button className="btn btn-primary" onClick={() => setAddStep(4)}>
                  Önizle →
                </button>
              )}
              {addStep === 4 && (
                <button className="btn btn-primary" onClick={handleSaveAdd}>
                  ✓ Kaydet
                </button>
              )}
              {addStep === 5 && (
                <button className="btn btn-secondary" onClick={resetAddWizard}>Kapat</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== MAPPING MODAL (for existing sources) ===== */}
      {showMappingModal && (
        <div className="modal-overlay" onClick={() => { setShowMappingModal(null); setXmlAnalysis(null); setPreviewData(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <div className="modal-header">
              <h3><Settings size={18} /> Alan Eşleştirmesi</h3>
              <button className="modal-close" onClick={() => { setShowMappingModal(null); setXmlAnalysis(null); setPreviewData(null); }}>×</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {analyzing ? (
                <div className="loading-spinner"><div className="spinner"></div></div>
              ) : (
                <MappingInterface
                  analysis={xmlAnalysis}
                  currentMapping={mapping}
                  onMappingChange={setMapping}
                  onPreview={handlePreview}
                  previewResult={previewData}
                  isNew={false}
                />
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setShowMappingModal(null); setXmlAnalysis(null); setPreviewData(null); }}>İptal</button>
              <button className="btn btn-primary" onClick={handleSaveMapping} disabled={savingMapping}>
                {savingMapping ? 'Kaydediliyor...' : '✓ Eşleştirmeyi Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DELETE CONFIRM MODAL ===== */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>Kaynağı Sil</h3>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Bu XML kaynağını ve <strong>bağlı tüm ürünleri</strong> silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>İptal</button>
              <button className="btn btn-danger" onClick={handleDelete}>Evet, Sil</button>
            </div>
          </div>
        </div>
      )}
      {/* ===== XML PREVIEW MODAL ===== */}
      {xmlPreviewSource && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 960, maxHeight: '88vh', padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="table-header" style={{ flexShrink: 0 }}>
              <div>
                <h3 style={{ margin: 0 }}>{xmlPreviewSource.name} — Önizleme</h3>
                {xmlPreviewData && (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Toplam {xmlPreviewData.total} ürün · İlk 20 gösteriliyor
                  </p>
                )}
              </div>
              <button className="text-btn" onClick={() => { setXmlPreviewSource(null); setXmlPreviewData(null); }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ overflowY: 'auto', padding: 20, flex: 1 }}>
              {xmlPreviewLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                  XML yükleniyor, lütfen bekleyin...
                </div>
              ) : xmlPreviewData ? (
                <>
                  {/* Ürün kartları */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 28 }}>
                    {xmlPreviewData.preview.map((p, i) => (
                      <div key={i} style={{
                        background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)', overflow: 'hidden',
                        display: 'flex', flexDirection: 'column'
                      }}>
                        <div style={{ width: '100%', aspectRatio: '1', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {p.image ? (
                            <>
                              <img
                                src={p.image}
                                alt={p.title}
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                referrerPolicy="no-referrer"
                                onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
                              />
                              <div style={{ display: 'none', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                                <ImageOff size={28} color="var(--text-muted)" />
                              </div>
                            </>
                          ) : (
                            <ImageOff size={28} color="var(--text-muted)" />
                          )}
                        </div>
                        <div style={{ padding: '8px 10px 10px' }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {p.title}
                          </p>
                          {p.category && p.category !== '—' && (
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

                  {/* Kategoriler */}
                  {xmlPreviewData.categories?.length > 0 && (
                    <div>
                      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FolderTree size={16} style={{ color: 'var(--accent-primary)' }} />
                        XML Kategorileri ({xmlPreviewData.categories.length})
                      </h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {xmlPreviewData.categories.map((cat, i) => (
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
              ) : null}
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button className="btn btn-secondary" onClick={() => { setXmlPreviewSource(null); setXmlPreviewData(null); }}>Kapat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
