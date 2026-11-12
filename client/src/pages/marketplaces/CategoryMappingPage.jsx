import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Search, Check, Loader2, Link2, AlertCircle, FolderTree, Wand2, RotateCcw } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import ProductCategoriesSection from './productcat/ProductCategoriesSection';
import ResetDialog from './productcat/ResetDialog';
import CategorySuggestions from './productcat/CategorySuggestions';

export default function CategoryMappingPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [localCategories, setLocalCategories] = useState([]);
  const [trendyolCategories, setTrendyolCategories] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catLoading, setCatLoading] = useState(false);

  // Mapping form state
  const [selectedLocal, setSelectedLocal] = useState('');
  const [catSearch, setCatSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState(new Set());
  const [selectedTrendyol, setSelectedTrendyol] = useState(null);
  const [saving, setSaving] = useState(false);

  // Attribute state
  const [requiredAttributes, setRequiredAttributes] = useState([]);
  const [attributeMappings, setAttributeMappings] = useState({});
  const [attrLoading, setAttrLoading] = useState(false);
  const [aiMatching, setAiMatching] = useState(false);

  // XML Source Filter
  const [xmlSources, setXmlSources] = useState([]);
  const [filterXmlSource, setFilterXmlSource] = useState('');
  const [categoryAiCost, setCategoryAiCost] = useState(0.5);

  // Two tabs per XML source: mapping of whole XML categories, and a category for each single product
  const [params, setParams] = useSearchParams();
  const [showReset, setShowReset] = useState(false);
  const [resetToken, setResetToken] = useState(0);

  // Free suggestions for the XML categories of the chosen source; `key` says which connection + source they belong to
  const [sug, setSug] = useState({ key: '', rows: [], loading: false });
  const formRef = useRef(null);

  useEffect(() => {
    fetchConnections();
    fetchXmlSources();
    api.get('/credits/prices').then(r => setCategoryAiCost(r.data.categoryAiCost ?? 0.5)).catch(() => {});
  }, []);

  // The Trendyol category tree depends only on the connection …
  useEffect(() => {
    if (selectedConn) fetchTrendyolTree(selectedConn.id);
  }, [selectedConn]);

  // … but local categories and mappings belong to ONE XML source, so nothing is loaded until one is chosen
  useEffect(() => {
    setSelectedLocal('');
    setSelectedTrendyol(null);
    setCatSearch('');
    if (selectedConn && filterXmlSource && filterXmlSource !== 'none') loadSourceData(selectedConn.id, filterXmlSource);
    else { setLocalCategories([]); setMappings([]); }
  }, [selectedConn, filterXmlSource]);

  useEffect(() => {
    if (!selectedTrendyol || !selectedConn) {
      setRequiredAttributes([]);
      setAttributeMappings({});
      return;
    }
    const fetchAttrs = async () => {
      setAttrLoading(true);
      try {
        const res = await api.get(`/marketplace/connections/${selectedConn.id}/categories/${selectedTrendyol.id}/attributes`);
        const attrs = res.data?.categoryAttributes || [];
        const required = attrs.filter(a => a.required);
        setRequiredAttributes(required);
        
        // Varsayılan boş değerleri set et
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
  }, [selectedTrendyol, selectedConn]);

  const fetchXmlSources = async () => {
    try {
      const res = await api.get('/xml-sources');
      // Sadece kullanıcının kendi eklediği (globalProviderId'si olmayan) XML'leri göster
      const customSources = res.data.filter(s => !s.globalProviderId);
      setXmlSources(customSources);
    } catch {}
  };

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const trendyolConns = res.data.filter(c => c.marketplaceType === 'trendyol');
      setConnections(trendyolConns);
      if (trendyolConns.length > 0) setSelectedConn(trendyolConns[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const fetchTrendyolTree = async (connId) => {
    setCatLoading(true);
    try {
      const catRes = await api.get(`/marketplace/connections/${connId}/categories`);
      setTrendyolCategories(catRes.data?.categories || catRes.data || []);
    } catch { toast.error('Trendyol kategorileri yüklenemedi'); }
    finally { setCatLoading(false); }
  };

  const fetchMappings = async (connId, xmlId) => {
    const res = await api.get(`/marketplace/connections/${connId}/category-mappings`, { params: { xmlSourceId: xmlId } });
    setMappings(res.data);
  };

  const loadSourceData = async (connId, xmlId) => {
    loadSuggestions(connId, xmlId);   // not awaited: the page is usable without it
    try {
      const [localRes] = await Promise.all([
        api.get('/marketplace/local-categories', { params: { xmlSourceId: xmlId } }),
        fetchMappings(connId, xmlId),
      ]);
      setLocalCategories(localRes.data);
    } catch { toast.error('Veriler yüklenemedi'); }
  };

  const loadSuggestions = (connId, xmlId) => {
    const key = `${connId}:${xmlId}`;
    setSug({ key, rows: [], loading: true });
    api.get(`/marketplace/connections/${connId}/product-categories/category-suggestions`, { params: { xmlSourceId: xmlId } })
      .then((r) => setSug((prev) => (prev.key === key ? { key, rows: r.data?.categories || [], loading: false } : prev)))
      .catch(() => setSug((prev) => (prev.key === key ? { key, rows: [], loading: false } : prev)));   // suggestions are a help, never an error
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

  // Mapped lookup
  const mappedLookup = useMemo(() => {
    const map = {};
    for (const m of mappings) {
      map[m.localCategory] = m;
    }
    return map;
  }, [mappings]);

  // A click on a suggestion fills the form (XML category + Trendyol category); the user checks the required attributes and saves
  const handlePickSuggestion = (category, s) => {
    setSelectedLocal(category);
    setSelectedTrendyol({ id: s.id, name: s.name, fullPath: s.path });
    setCatSearch(s.name);
    if (formRef.current && formRef.current.scrollIntoView) formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSaveMapping = async () => {
    if (!selectedLocal || !selectedTrendyol || !selectedConn) return;
    
    // Check if all required attributes are mapped
    const unmappedAttr = requiredAttributes.find(a => !attributeMappings[a.attribute.id]?.valueId && !attributeMappings[a.attribute.id]?.valueName);
    if (unmappedAttr) {
      toast.error(`"${unmappedAttr.attribute.name}" özelliği zorunludur.`);
      return;
    }

    setSaving(true);
    try {
      await api.post(`/marketplace/connections/${selectedConn.id}/category-mappings`, {
        xmlSourceId: filterXmlSource,
        localCategory: selectedLocal,
        marketplaceCategoryId: selectedTrendyol.id,
        marketplaceCategoryName: selectedTrendyol.fullPath || selectedTrendyol.name,
        attributes: attributeMappings
      });
      toast.success('Kategori eşleştirmesi kaydedildi');
      setSelectedLocal('');
      setSelectedTrendyol(null);
      setCatSearch('');
      await fetchMappings(selectedConn.id, filterXmlSource);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Kaydetme hatası');
    } finally { setSaving(false); }
  };

  const handleAiMatch = async () => {
    if (!selectedConn) return;
    const unmapped = localCategories.filter(c => !mappedLookup[c]);
    if (unmapped.length === 0) {
      toast('Tüm kategoriler zaten eşleştirilmiş.');
      return;
    }
    setAiMatching(true);
    try {
      const res = await api.post('/ai/category-match', {
        xmlCategories: unmapped,
        connectionId: selectedConn.id
      });
      const matches = res.data.matches || {};
      const aiMatched = Object.values(matches).filter(Boolean).length;
      if (aiMatched === 0) {
        toast.error(`AI hiçbir kategori eşleştiremedi. Kategori isimleri Trendyol'daki kategorilerle çok farklı olabilir.`);
        setAiMatching(false);
        return;
      }
      let added = 0;
      let saveErrors = 0;
      for (const [cat, match] of Object.entries(matches)) {
        if (!match) continue;
        try {
          await api.post(`/marketplace/connections/${selectedConn.id}/category-mappings`, {
            xmlSourceId: filterXmlSource,
            localCategory: cat,
            marketplaceCategoryId: match.id,
            marketplaceCategoryName: match.path,
            attributes: match.attributes || {}
          });
          added++;
        } catch (saveErr) {
          saveErrors++;
          console.error('[AI Save Error]', cat, saveErr?.response?.data || saveErr.message);
        }
      }
      await fetchMappings(selectedConn.id, filterXmlSource);
      if (saveErrors > 0) {
        toast.error(`${added} kaydedildi, ${saveErrors} kaydedilemedi. Konsola bakın.`);
      } else {
        toast.success(`${added} / ${unmapped.length} kategori otomatik eşleştirildi.`);
      }
    } catch (err) {
      toast.error('AI eşleştirme hatası: ' + (err.response?.data?.error || err.message));
    } finally {
      setAiMatching(false);
    }
  };

  const handleDeleteMapping = async (m) => {
    if (!window.confirm(`“${m.localCategory}” eşleştirmesi silinsin mi?`)) return;
    try {
      await api.delete(`/marketplace/category-mappings/${m.id}`);
      await fetchMappings(selectedConn.id, filterXmlSource);
      toast.success('Eşleştirme silindi');
    } catch (err) { toast.error(err.response?.data?.error || 'Silinemedi'); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Kategori Eşleştirme</h1><p>Pazaryeri kategori eşleştirmesi için önce bir Trendyol bağlantısı ekleyin</p></div>
        <div className="card">
          <div className="empty-state">
            <AlertCircle size={48} className="empty-icon" />
            <h3>Trendyol bağlantısı bulunamadı</h3>
            <p>Pazaryeri sayfasından bir Trendyol bağlantısı oluşturun</p>
          </div>
        </div>
      </div>
    );
  }

  const selectedXmlSource = xmlSources.find(s => s.id === filterXmlSource);
  const isGlobalXml = selectedXmlSource && selectedXmlSource.globalProviderId;
  const tab = filterXmlSource === 'none' || params.get('tab') === 'products' ? 'products' : 'mapping';
  const setTab = (t) => setParams(t === 'products' ? { tab: 'products' } : {}, { replace: true });
  const sourceName = filterXmlSource === 'none' ? 'Elle eklenen ürünler' : (selectedXmlSource ? selectedXmlSource.name : '');

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Kategori Eşleştirme</h1>
          <p>XML ürün kategorilerinizi Trendyol kategorileriyle eşleştirin</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {connections.length > 0 && (
            <select className="form-select" style={{ width: 220 }}
              value={selectedConn?.id || ''}
              onChange={e => setSelectedConn(connections.find(c => c.id === e.target.value))}
            >
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.marketplaceType} ({c.marketplaceType})</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Step 1: the XML source comes first – categories and mappings are per source */}
      <div className="card" style={{ marginBottom: 20, padding: 20, border: filterXmlSource ? undefined : '1px solid var(--accent-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ width: 24, height: 24, borderRadius: 12, background: 'var(--accent-primary)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>1</span>
          <strong style={{ fontSize: 15 }}>Önce XML kaynağını seçin</strong>
        </div>
        {xmlSources.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
            Henüz kendi eklediğiniz bir XML kaynağı yok. Kategori eşleştirmesi bir XML kaynağına bağlıdır: önce <a href="/xml-sources">XML Kaynakları</a> sayfasından bir kaynak ekleyip ürünleri çekin.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="form-select" aria-label="XML kaynağı" style={{ maxWidth: 420 }} value={filterXmlSource} onChange={e => setFilterXmlSource(e.target.value)}>
                <option value="">XML kaynağı seçin…</option>
                {xmlSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="none">Elle eklenen ürünler (yalnızca ürün bazlı kategori)</option>
              </select>
              {filterXmlSource && (
                <button className="btn btn-secondary" onClick={() => setShowReset(true)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <RotateCcw size={14} /> Kategorileri sıfırla
                </button>
              )}
            </div>
            <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>
              Eşleştirmeler seçtiğiniz XML’e kaydedilir; o XML silinince eşleştirmeleri de silinir. Aynı adlı kategori başka bir XML’de ayrıca eşleştirilir.
            </p>
          </>
        )}
      </div>

      {!filterXmlSource && xmlSources.length > 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          <FolderTree size={40} style={{ opacity: 0.4, marginBottom: 10 }} />
          <div>Devam etmek için yukarıdan bir XML kaynağı seçin.</div>
        </div>
      )}

      {filterXmlSource && (
        <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button role="tab" aria-selected={tab === 'mapping'} className={`btn ${tab === 'mapping' ? 'btn-primary' : 'btn-secondary'}`} disabled={filterXmlSource === 'none'} onClick={() => setTab('mapping')}>Kategori eşleştirme</button>
          <button role="tab" aria-selected={tab === 'products'} className={`btn ${tab === 'products' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('products')}>Ürün bazlı kategori</button>
        </div>
      )}

      {filterXmlSource && tab === 'products' && selectedConn && (
        <ProductCategoriesSection key={`${selectedConn.id}:${filterXmlSource}`} connId={selectedConn.id} srcId={filterXmlSource} reloadToken={resetToken} />
      )}

      {/* Step 2: the mapping form (only once a source is chosen) */}
      {filterXmlSource && tab === 'mapping' && (() => {
        if (isGlobalXml) {
          return (
            <div className="card" style={{ marginBottom: 20, padding: 32, textAlign: 'center', background: 'rgba(59,130,246,0.03)' }}>
              <FolderTree size={48} style={{ color: 'var(--accent-primary)', marginBottom: 16, opacity: 0.5, display: 'inline-block' }} />
              <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent-primary)', marginBottom: 8 }}>
                ✨ Ayarlar Tedarikçi Havuzundan Eklendi
              </h3>
              <p style={{ color: 'var(--text-secondary)', maxWidth: 500, margin: '0 auto' }}>
                Bu XML kaynağı global havuzdan eklendiği için kategori eşleştirmeleri sistem yöneticisi tarafından merkezi olarak yönetilmektedir. Burada ek bir işlem yapmanıza gerek yoktur.
              </p>
            </div>
          );
        }

        return (
          <div className="card" ref={formRef} style={{ marginBottom: 20, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Link2 size={18} style={{ color: 'var(--accent-primary)' }} />
                Yeni Eşleştirme
              </h3>
              <button
                className="btn btn-secondary"
                onClick={handleAiMatch}
                disabled={aiMatching || !selectedConn}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {aiMatching ? <Loader2 size={14} className="spinning" /> : <Wand2 size={14} />}
                {aiMatching ? 'AI Eşleştiriyor...' : `AI ile Otomatik Eşleştir${categoryAiCost > 0 ? ` (${categoryAiCost} kredi/kategori)` : ''}`}
              </button>
            </div>

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
              {localCategories.map(cat => (
                <option key={cat} value={cat} style={{
                  color: mappedLookup[cat] ? 'var(--success)' : undefined
                }}>
                  {cat} {mappedLookup[cat] ? '✓' : ''}
                </option>
              ))}
            </select>
            {selectedLocal && mappedLookup[selectedLocal] && (
              <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', fontSize: 12 }}>
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>Mevcut eşleştirme:</span>
                <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>{mappedLookup[selectedLocal].marketplaceCategoryName}</span>
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
              />
            </div>

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
                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 30px rgba(0,0,0,0.3)'
              }}>
                {catLoading ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Loader2 size={18} className="spinning" />
                  </div>
                ) : filteredCategories.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    Kategori bulunamadı
                  </div>
                ) : (
                  filteredCategories.map(cat => (
                    <button
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
                        placeholder={`${attr.attribute.name} girin veya XML alan adını {alan} yazın`}
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
            className="btn btn-primary"
            onClick={handleSaveMapping}
            disabled={!selectedLocal || !selectedTrendyol || saving}
          >
            {saving ? <Loader2 size={14} className="spinning" /> : <Check size={14} />}
            Eşleştirmeyi Kaydet
          </button>
        </div>
      </div>
        );
      })()}

      {filterXmlSource && tab === 'mapping' && !isGlobalXml && (
        <CategorySuggestions
          rows={(sug.key === `${selectedConn?.id}:${filterXmlSource}` ? sug.rows : []).filter((r) => !mappedLookup[r.category])}
          loading={sug.key === `${selectedConn?.id}:${filterXmlSource}` && sug.loading}
          onPick={handlePickSuggestion}
          onOpenProducts={() => setTab('products')}
        />
      )}

      {filterXmlSource && tab === 'mapping' && !isGlobalXml && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>
            Bu XML’in eşleştirmeleri ({mappings.length}) · eşleşmeyen kategori: {localCategories.filter(c => !mappedLookup[c]).length}
          </h3>
          {mappings.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Bu XML için henüz eşleştirme yok.</p>
          ) : (
            <div className="table-container">
              <table>
                <thead><tr><th>XML kategorisi</th><th>Trendyol kategorisi</th><th></th></tr></thead>
                <tbody>
                  {mappings.map(m => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 500 }}>{m.localCategory}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{m.marketplaceCategoryName || m.marketplaceCategoryId}</td>
                      <td style={{ textAlign: 'right' }}>
                        {m.isGlobal ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>merkezi</span>
                          : <button className="btn btn-danger btn-sm" onClick={() => handleDeleteMapping(m)}>Sil</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showReset && selectedConn && (
        <ResetDialog connId={selectedConn.id} srcId={filterXmlSource} srcName={sourceName} mappingCount={isGlobalXml ? 0 : mappings.length}
          onClose={() => setShowReset(false)}
          onDone={() => { setShowReset(false); setResetToken((t) => t + 1); if (filterXmlSource !== 'none') fetchMappings(selectedConn.id, filterXmlSource).catch(() => {}); }} />
      )}

    </div>
  );
}
