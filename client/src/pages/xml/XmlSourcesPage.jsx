import { useState, useEffect, useMemo } from 'react';
import { Plus, RefreshCw, Trash2, FileCode2, Clock, CheckCircle, XCircle, Settings, Eye, ArrowRight, Link2, Send, Tag, DollarSign, Search, Check, FolderTree, Loader2, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

// Ürün alanları tanımı
const PRODUCT_FIELDS = [
  { key: 'sku', label: 'SKU / Ürün Kodu', required: true, icon: '🔑' },
  { key: 'barcode', label: 'Barkod', required: false, icon: '📊' },
  { key: 'title', label: 'Ürün Adı', required: true, icon: '📝' },
  { key: 'description', label: 'Açıklama', required: false, icon: '📄' },
  { key: 'price', label: 'Satış Fiyatı', required: true, icon: '💰' },
  { key: 'listPrice', label: 'Liste Fiyatı', required: false, icon: '🏷️' },
  { key: 'cost', label: 'Maliyet Fiyatı', required: false, icon: '💵' },
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

  // Add form
  const [addForm, setAddForm] = useState({ name: '', url: '', syncIntervalMin: 60, barcodePrefix: '', priceMarkup: '', priceMarkupPct: '', defaultCategoryId: '', defaultBrandId: '' });

  // Mapping state
  const [analyzing, setAnalyzing] = useState(false);
  const [xmlAnalysis, setXmlAnalysis] = useState(null);
  const [mapping, setMapping] = useState({});
  const [previewData, setPreviewData] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);

  // Add wizard state
  const [addStep, setAddStep] = useState(1); // 1: basic info, 2: mapping, 3: config, 4: category map, 5: preview, 6: save+send
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
    setPreviewing(true);
    try {
      // Geçici kaynak oluşturup preview almak yerine analyze verisiyle simüle edelim
      const res = await api.post('/xml-sources/analyze', { url: addForm.url });
      if (res.data.success && res.data.sampleData) {
        // Mapping'e göre veriyi dönüştür
        const mapped = res.data.sampleData.map(row => {
          const product = {};
          for (const field of PRODUCT_FIELDS) {
            const xmlField = addMapping[field.key];
            product[field.key] = xmlField ? (row[xmlField] || '-') : '-';
          }
          return product;
        });
        setAddPreview(mapped);
        setAddStep(3);
      }
    } catch (err) { toast.error('Önizleme hatası'); }
    finally { setPreviewing(false); }
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
      setAddStep(6);
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
    setAddForm({ name: '', url: '', syncIntervalMin: 60, barcodePrefix: '', priceMarkup: '', priceMarkupPct: '', defaultCategoryId: '', defaultBrandId: '' });
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

  const handleDelete = async (id) => {
    if (!confirm('Bu XML kaynağını ve bağlı ürünleri silmek istediğinize emin misiniz?')) return;
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
                    return sample ? (sample[currentMapping[field.key]] || '-') : '-';
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
            return (
              <div key={s.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {statusIcon(s.status)} {s.name}
                    </h3>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' }}>{s.url}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <span className={`badge ${hasMapping ? 'badge-success' : 'badge-warning'}`}>
                      {hasMapping ? '✓ Eşleştirildi' : '⚠ Eşleştirme Yok'}
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
                  <button className="btn btn-secondary btn-sm" onClick={() => openMapping(s)}>
                    <Settings size={14} /> Alan Eşleştir
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => handleSync(s.id)} disabled={syncing === s.id}>
                    <RefreshCw size={14} className={syncing === s.id ? 'spinning' : ''} />
                    {syncing === s.id ? 'Çekiliyor...' : 'Şimdi Çek'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s.id)}><Trash2 size={14} /> Sil</button>
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
                {addStep === 4 && '4️⃣ Kategori Eşleştirme'}
                {addStep === 5 && '5️⃣ Önizleme & Kaydet'}
                {addStep === 6 && '✅ Tamamlandı'}
              </h3>
              <button className="modal-close" onClick={resetAddWizard}>×</button>
            </div>

            {/* Step indicators */}
            <div style={{ display: 'flex', gap: 4, padding: '12px 24px', borderBottom: '1px solid var(--border-color)' }}>
              {[1, 2, 3, 4, 5, 6].map(step => (
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

                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <DollarSign size={16} style={{ color: 'var(--success)' }} /> Fiyat Ayarları
                  </h4>
                  <div className="grid grid-2" style={{ gap: 16 }}>
                    <div className="form-group">
                      <label className="form-label">Fiyat Artışı (%)</label>
                      <input type="number" className="form-input" placeholder="ör: 20 (XML fiyatına %20 ekler)" value={addForm.priceMarkupPct} onChange={e => setAddForm({...addForm, priceMarkupPct: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Sabit Fiyat Artışı (₺)</label>
                      <input type="number" className="form-input" placeholder="ör: 50 (XML fiyatına ₺50 ekler)" value={addForm.priceMarkup} onChange={e => setAddForm({...addForm, priceMarkup: e.target.value})} />
                    </div>
                  </div>
                  <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 4 }}>
                    Önce yüzde artışı, sonra sabit tutar uygulanır. Örnek: XML fiyat ₺100, %20 + ₺10 → ₺130
                  </small>
                </div>
              )}

              {/* Step 4: Category Mapping */}
              {addStep === 4 && (
                <div>
                  <div className="alert alert-info" style={{ marginBottom: 20 }}>
                    📁 XML'den gelen kategorilerinizi pazaryeri kategorileriyle eşleştirin. Bu işlem pazaryerine ürün gönderirken zorunludur.
                  </div>
                  
                  {connections.length === 0 ? (
                    <div className="alert alert-warning">
                      ⚠ Eşleştirme yapabileceğiniz bir pazaryeri bağlantısı bulunamadı. Bu adımı atlayabilir ve daha sonra "Pazaryeri" menüsünden eşleştirme yapabilirsiniz.
                    </div>
                  ) : (
                    <>
                      <div className="form-group">
                        <label className="form-label">Mağaza Bağlantısı Seçin</label>
                        <select className="form-select" value={selectedConn?.id || ''} onChange={e => {
                          const c = connections.find(x => x.id === e.target.value);
                          setSelectedConn(c);
                          if (c) loadCategories(c.id);
                        }}>
                          {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
                        </select>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: 16, alignItems: 'start', background: 'var(--bg-tertiary)', padding: 16, borderRadius: 'var(--radius)' }}>
                        <div>
                          <label className="form-label">Yerel Kategori (XML)</label>
                          <select className="form-select" value={selectedLocalForMap} onChange={e => setSelectedLocalForMap(e.target.value)}>
                            <option value="">Kategori seçin...</option>
                            {localCats.map(cat => (
                              <option key={cat} value={cat} style={{ color: addCategoryMappings[cat] ? 'var(--success)' : undefined }}>
                                {cat} {addCategoryMappings[cat] ? '✓' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 28 }}>
                          <ArrowRight size={20} style={{ color: 'var(--accent-primary)' }} />
                        </div>
                        
                        <div>
                          <label className="form-label">Trendyol Kategorisi</label>
                          <div style={{ position: 'relative' }}>
                            <Search size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                            <input className="form-input" style={{ paddingLeft: 34 }} placeholder="Kategori ara..." value={catSearch} onChange={e => { setCatSearch(e.target.value); setSelectedTrendyolForMap(null); }} />
                          </div>
                          
                          {selectedTrendyolForMap && (
                            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Check size={14} style={{ color: 'var(--accent-primary)' }} />
                              <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{selectedTrendyolForMap.fullPath || selectedTrendyolForMap.name}</span>
                            </div>
                          )}

                          {catSearch.trim() && !selectedTrendyolForMap && (
                            <div style={{ marginTop: 4, maxHeight: 250, overflowY: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
                              {catLoading ? (
                                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}><Loader2 size={18} className="spinning" /></div>
                              ) : filteredCategories.length === 0 ? (
                                <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Kategori bulunamadı</div>
                              ) : (
                                filteredCategories.map(cat => (
                                  <button key={cat.id} onClick={() => { setSelectedTrendyolForMap(cat); setCatSearch(cat.name); }} style={{ display: 'block', width: '100%', padding: '10px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-color)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-primary)' }}>
                                    <div style={{ fontWeight: 500 }}>{cat.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{cat.fullPath}</div>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary btn-sm" onClick={handleAddCategoryMapping} disabled={!selectedLocalForMap || !selectedTrendyolForMap}>
                          <Check size={14} /> Eşleştirmeyi Ekle
                        </button>
                      </div>
                      
                      {Object.keys(addCategoryMappings).length > 0 && (
                        <div style={{ marginTop: 24 }}>
                          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Eklenen Eşleştirmeler</h4>
                          <table style={{ fontSize: 13 }}>
                            <thead>
                              <tr>
                                <th>Yerel Kategori</th>
                                <th>Pazaryeri Kategorisi</th>
                                <th style={{ width: 40 }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(addCategoryMappings).map(([localCat, mapData]) => (
                                <tr key={localCat}>
                                  <td>{localCat}</td>
                                  <td>{mapData.marketplaceCategoryName}</td>
                                  <td><button className="btn btn-danger btn-sm" style={{ padding: 4 }} onClick={() => handleRemoveCategoryMapping(localCat)}><Trash2 size={14} /></button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Step 5: Preview */}
              {addStep === 5 && addPreview && (
                <div>
                  <div className="alert alert-success" style={{ marginBottom: 16 }}>
                    ✅ Her şey hazır! Aşağıdaki önizlemeyi kontrol edin, doğruysa kaydedin.
                    {addForm.barcodePrefix && <><br/>📎 Barkod ön eki: <strong>{addForm.barcodePrefix}</strong></>}
                    {addForm.priceMarkupPct && <><br/>📈 Fiyat artışı: <strong>%{addForm.priceMarkupPct}</strong></>}
                    {addForm.priceMarkup && <><br/>💰 Sabit artış: <strong>₺{addForm.priceMarkup}</strong></>}
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

              {/* Step 6: Done */}
              {addStep === 6 && (
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
              {addStep > 1 && addStep < 6 && (
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
                  Kategori Eşleştir →
                </button>
              )}
              {addStep === 4 && (
                <button className="btn btn-primary" onClick={() => setAddStep(5)}>
                  Önizle →
                </button>
              )}
              {addStep === 5 && (
                <button className="btn btn-primary" onClick={handleSaveAdd}>
                  ✓ Kaydet
                </button>
              )}
              {addStep === 6 && (
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
    </div>
  );
}
