import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Tags, ToggleLeft, ToggleRight, Edit2, Calculator, Info } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

/**
 * Fiyat şablonları.
 * Tüm hesaplama sunucudaki fiyat motorunda yapılır (aynı motor ürünleri gönderirken de kullanılır);
 * bu sayfa yalnızca kuralı tanımlar ve motordan canlı önizleme ister.
 */

const PROFIT_MODES = [
  { key: 'percent_of_purchase', label: 'Alış fiyatının %’si kadar kâr', hint: 'Alış 100₺, değer 30 → 30₺ kâr (maliyetlerden bağımsız).' },
  { key: 'percent_of_cost', label: 'Toplam maliyetin %’si kadar kâr', hint: 'Alış + kargo + paketleme + ek gider üzerinden yüzde kâr.' },
  { key: 'margin_on_price', label: 'Satış fiyatında hedef kâr marjı (%)', hint: 'Komisyon ve giderler düşüldükten sonra satış fiyatının %’si net kalır.' },
  { key: 'fixed', label: 'Sabit kâr (₺)', hint: 'Her ürüne sabit tutar eklenir.' },
];

const ROUNDINGS = [
  { key: 'none', label: 'Yuvarlama yok' },
  { key: 'ending:0.9', label: 'Sonu .90 olsun (örn: 129,90)' },
  { key: 'ending:0.99', label: 'Sonu .99 olsun (örn: 129,99)' },
  { key: 'ending:0.5', label: 'Sonu .50 olsun (örn: 129,50)' },
  { key: 'int', label: 'Yukarı tam sayıya yuvarla (örn: 130)' },
];

const EMPTY_FORM = {
  name: '', priority: '0',
  connectionId: '', xmlSourceIds: [], categories: [], brands: '',
  minPurchasePrice: '', maxPurchasePrice: '',
  shippingCost: '', packagingCost: '', extraCost: '', commissionPct: '', extraPct: '',
  profitMode: 'percent_of_purchase', value: '',
  rounding: 'none', minPrice: '', maxPrice: '',
};

const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(parseFloat(v)) ? null : parseFloat(v));
const fmt = (n) => (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formToPayload(f) {
  const [rm, re] = f.rounding.includes(':') ? f.rounding.split(':') : [f.rounding, null];
  const conditions = {
    connectionId: f.connectionId || null,
    xmlSourceIds: f.xmlSourceIds,
    categories: f.categories,
    brands: f.brands.split(',').map((x) => x.trim()).filter(Boolean),
    minPurchasePrice: num(f.minPurchasePrice),
    maxPurchasePrice: num(f.maxPurchasePrice),
    shippingCost: num(f.shippingCost) ?? 0,
    packagingCost: num(f.packagingCost) ?? 0,
    extraCost: num(f.extraCost) ?? 0,
    commissionPct: num(f.commissionPct) ?? 0,
    extraPct: num(f.extraPct) ?? 0,
    vatRate: null, // sale VAT comes from the product's XML source (chosen when the source was added)
    profitMode: f.profitMode,
    roundingMode: rm,
    roundingEnding: re ? parseFloat(re) : null,
    minPrice: num(f.minPrice),
    maxPrice: num(f.maxPrice),
  };
  return { name: f.name, type: 'percentage', value: num(f.value) ?? 0, applyTo: 'price_template', priority: parseInt(f.priority) || 0, conditions };
}

function ruleToForm(r) {
  let c = {};
  try { c = r.conditions ? JSON.parse(r.conditions) : {}; } catch { c = {}; }
  const legacyStandard = r.applyTo === 'marketplace_xml';
  const srcIds = c.xmlSourceIds && c.xmlSourceIds.length ? c.xmlSourceIds : (c.xmlSourceId ? [c.xmlSourceId] : []);
  let rounding = 'none';
  if (c.roundingMode === 'int') rounding = 'int';
  else if (c.roundingMode === 'ending') rounding = `ending:${c.roundingEnding ?? 0.9}`;
  return {
    ...EMPTY_FORM,
    name: r.name || '',
    priority: String(r.priority ?? 0),
    connectionId: c.connectionId || '',
    xmlSourceIds: srcIds,
    categories: c.categories || [],
    brands: (c.brands || []).join(', '),
    minPurchasePrice: c.minPurchasePrice ?? '',
    maxPurchasePrice: c.maxPurchasePrice ?? '',
    shippingCost: c.shippingCost ?? '',
    packagingCost: c.packagingCost ?? '',
    extraCost: c.extraCost ?? '',
    commissionPct: c.commissionPct ?? '',
    extraPct: c.extraPct ?? '',
    // legacy fixed-amount rules map to the fixed profit mode
    profitMode: c.profitMode || (legacyStandard && r.type === 'fixed' ? 'fixed' : 'percent_of_purchase'),
    value: r.value ?? '',
    rounding,
    minPrice: c.minPrice ?? '',
    maxPrice: c.maxPrice ?? '',
  };
}

function Section({ title, children, hint }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  );
}

export default function PricingPage() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [xmlSources, setXmlSources] = useState([]);
  const [connections, setConnections] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [catSearch, setCatSearch] = useState('');
  const [samplePrice, setSamplePrice] = useState('100');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [coverage, setCoverage] = useState(null);
  const reqId = useRef(0);

  useEffect(() => { fetchRules(); fetchOptions(); }, []);

  const fetchOptions = async () => {
    try {
      const [xmlRes, connRes, catRes] = await Promise.all([
        api.get('/xml-sources'),
        api.get('/marketplace/connections'),
        api.get('/marketplace/local-categories').catch(() => ({ data: [] })),
      ]);
      setXmlSources(xmlRes.data);
      setConnections(connRes.data);
      // categories arrive as "Kadın|Bileklik|" – offer the individual levels
      const set = new Set();
      for (const c of catRes.data || []) String(c).split('|').map((x) => x.trim()).filter(Boolean).forEach((x) => set.add(x));
      setCategoryOptions([...set].sort((a, b) => a.localeCompare(b, 'tr')));
    } catch { /* options are optional */ }
  };

  const fetchRules = async () => {
    try {
      const res = await api.get('/pricing');
      setRules(res.data);
    } catch { toast.error('Kurallar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const payload = useMemo(() => formToPayload(form), [form]);

  // The preview uses the sale VAT of the chosen XML source (or the first one) – same rule the engine applies to real products
  const previewVat = useMemo(() => {
    const ids = form.xmlSourceIds.length ? form.xmlSourceIds : xmlSources.map((x) => x.id);
    const src = xmlSources.find((x) => ids.includes(x.id));
    return src?.defaultVatRate ?? 20;
  }, [form.xmlSourceIds, xmlSources]);

  // live preview from the server pricing engine (debounced)
  useEffect(() => {
    if (!showModal) return undefined;
    const my = ++reqId.current;
    const t = setTimeout(async () => {
      const purchase = num(samplePrice);
      if (!purchase || purchase <= 0 || form.value === '') { setPreview(null); setPreviewError(''); return; }
      try {
        const res = await api.post('/pricing/calculate', { purchasePrice: purchase, value: payload.value, conditions: { ...payload.conditions, vatRate: previewVat } });
        if (my === reqId.current) { setPreview(res.data); setPreviewError(''); }
      } catch (err) {
        if (my === reqId.current) { setPreview(null); setPreviewError(err.response?.data?.error || 'Hesaplanamadı'); }
      }
      try {
        const cov = await api.post('/pricing/coverage', { conditions: payload.conditions });
        if (my === reqId.current) setCoverage(cov.data);
      } catch { /* optional */ }
    }, 350);
    return () => clearTimeout(t);
  }, [payload, samplePrice, showModal, previewVat]); // eslint-disable-line react-hooks/exhaustive-deps

  const openModal = (rule = null) => {
    if (rule) { setEditingId(rule.id); setForm(ruleToForm(rule)); }
    else { setEditingId(null); setForm({ ...EMPTY_FORM }); }
    setPreview(null); setCoverage(null); setPreviewError(''); setCatSearch('');
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditingId(null); setForm({ ...EMPTY_FORM }); };

  const handleSave = async (e) => {
    e.preventDefault();
    if (form.value === '') return toast.error('Kâr değeri zorunludur');
    const min = num(form.minPurchasePrice), max = num(form.maxPurchasePrice);
    if (min !== null && max !== null && min > max) return toast.error('Alış fiyatı aralığında en düşük değer en yüksekten büyük olamaz');
    try {
      if (editingId) {
        await api.put(`/pricing/${editingId}`, payload);
        toast.success('Şablon güncellendi');
      } else {
        await api.post('/pricing', payload);
        toast.success('Fiyat şablonu eklendi');
      }
      closeModal();
      fetchRules();
    } catch (err) { toast.error(err.response?.data?.error || 'Hata'); }
  };

  const toggleActive = async (id, currentState) => {
    try { await api.put(`/pricing/${id}`, { isActive: !currentState }); fetchRules(); }
    catch { toast.error('Güncelleme hatası'); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const id = deleteConfirm;
    setDeleteConfirm(null);
    try { await api.delete(`/pricing/${id}`); toast.success('Kural silindi'); fetchRules(); }
    catch { toast.error('Silme hatası'); }
  };

  const toggleIn = (key, value) => setForm((f) => ({
    ...f, [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value],
  }));

  const visibleCategories = categoryOptions.filter((c) => c.toLowerCase().includes(catSearch.toLowerCase())).slice(0, 80);

  const renderScope = (r) => {
    let c = {};
    try { c = r.conditions ? JSON.parse(r.conditions) : {}; } catch { c = {}; }
    const conn = c.connectionId ? connections.find((x) => x.id === c.connectionId) : null;
    const srcIds = c.xmlSourceIds && c.xmlSourceIds.length ? c.xmlSourceIds : (c.xmlSourceId ? [c.xmlSourceId] : []);
    const srcNames = srcIds.map((id) => xmlSources.find((x) => x.id === id)?.name || '—');
    const hasRange = c.minPurchasePrice != null || c.maxPurchasePrice != null;
    const lines = [];
    lines.push(<div key="conn"><strong>Pazaryeri:</strong> {conn ? (conn.supplierName || conn.marketplaceType) : 'Tümü'}</div>);
    if (srcNames.length) lines.push(<div key="src"><strong>Kaynak:</strong> {srcNames.join(', ')}</div>);
    if (c.categories?.length) lines.push(<div key="cat"><strong>Kategori:</strong> {c.categories.join(', ')}</div>);
    if (c.brands?.length) lines.push(<div key="br"><strong>Marka:</strong> {c.brands.join(', ')}</div>);
    if (hasRange) lines.push(<div key="rng"><strong>Alış aralığı:</strong> {c.minPurchasePrice != null ? `₺${c.minPurchasePrice}` : '—'} – {c.maxPurchasePrice != null ? `₺${c.maxPurchasePrice}` : '—'}</div>);
    return <div style={{ fontSize: 12, lineHeight: 1.7 }}>{lines}</div>;
  };

  const renderCosts = (r) => {
    let c = {};
    try { c = r.conditions ? JSON.parse(r.conditions) : {}; } catch { c = {}; }
    const parts = [];
    const fixed = (Number(c.shippingCost) || 0) + (Number(c.packagingCost) || 0) + (Number(c.extraCost) || 0);
    if (fixed > 0) parts.push(`Sabit gider ₺${fmt(fixed)}`);
    const pct = (Number(c.commissionPct) || 0) + (Number(c.extraPct) || 0);
    if (pct > 0) parts.push(`Komisyon/gider %${pct}`);
    if (c.vatRate !== null && c.vatRate !== undefined && c.vatRate !== '' && Number(c.vatRate) > 0) parts.push(`KDV %${c.vatRate}`);
    if (c.roundingMode === 'ending') parts.push(`Sonu .${String(Math.round((c.roundingEnding ?? 0.9) * 100)).padStart(2, '0')}`);
    if (c.roundingMode === 'int') parts.push('Tam sayı');
    return <span style={{ fontSize: 12 }}>{parts.length ? parts.join(' · ') : '—'}</span>;
  };

  const profitLabel = (r) => {
    let c = {};
    try { c = r.conditions ? JSON.parse(r.conditions) : {}; } catch { c = {}; }
    if (r.applyTo === 'marketplace_xml') return r.type === 'fixed' ? `+₺${r.value}` : `%${r.value}`;
    if (c.profitMode === 'fixed') return `₺${r.value}`;
    return `%${r.value}`;
  };

  const inputStyle = { width: '100%' };

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Fiyat Şablonları</h1>
          <p>Alış fiyatından pazaryeri satış fiyatını hesaplayan kuralları yönetin. Birden fazla şablon eşleşirse önce öncelik sayısı küçük olan, sonra kapsamı daha dar olan uygulanır.</p>
        </div>
        <button className="btn btn-primary" onClick={() => openModal()}><Plus size={16} /> Şablon Ekle</button>
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : rules.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Tags size={48} className="empty-icon" />
            <h3>Henüz fiyat şablonu yok</h3>
            <p>Ürünlerin Trendyol’a gönderilebilmesi için en az bir şablon gerekir.</p>
            <button className="btn btn-primary" onClick={() => openModal()}><Plus size={16} /> İlk Şablonu Ekle</button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr><th>Şablon</th><th>Kâr</th><th>Kapsam</th><th>Maliyet / Yuvarlama</th><th>Öncelik</th><th>Durum</th><th>İşlem</th></tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>
                    {r.name}
                    {r.applyTo === 'marketplace_xml' && (
                      <span className="badge badge-warning" style={{ marginLeft: 8, fontSize: 10, verticalAlign: 'middle' }} title="Eski tip kural. Düzenleyip kaydederseniz yeni şablona dönüşür.">Eski tip</span>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>{profitLabel(r)}</td>
                  <td>{renderScope(r)}</td>
                  <td>{renderCosts(r)}</td>
                  <td>{r.priority}</td>
                  <td>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.isActive ? 'var(--success)' : 'var(--text-muted)' }}
                      onClick={() => toggleActive(r.id, r.isActive)}>
                      {r.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                    </button>
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openModal(r)}><Edit2 size={14} /></button>
                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(r.id)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980, width: '95%' }}>
            <div className="modal-header">
              <h3>{editingId ? 'Şablonu Düzenle' : 'Fiyat Şablonu Ekle'}</h3>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(280px,1fr)', gap: 24, maxHeight: '75vh', overflowY: 'auto' }}>
                <div>
                  <div className="grid grid-2">
                    <div className="form-group">
                      <label className="form-label">Şablon adı *</label>
                      <input className="form-input" placeholder="ör: 1–100₺ arası %30 kâr" value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Öncelik</label>
                      <input type="number" className="form-input" value={form.priority}
                        onChange={(e) => setForm({ ...form, priority: e.target.value })} />
                    </div>
                  </div>

                  <Section title="1. Hangi ürünlere uygulansın?" hint="Boş bıraktığınız her filtre ‘hepsi’ anlamına gelir.">
                    <div className="grid grid-2">
                      <div className="form-group">
                        <label className="form-label">Pazaryeri bağlantısı</label>
                        <select className="form-select" value={form.connectionId} onChange={(e) => setForm({ ...form, connectionId: e.target.value })}>
                          <option value="">Tümü</option>
                          {connections.map((c) => <option key={c.id} value={c.id}>{c.supplierName || c.marketplaceType} ({c.marketplaceType})</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Markalar (virgülle)</label>
                        <input className="form-input" placeholder="ör: Nike, Adidas" value={form.brands}
                          onChange={(e) => setForm({ ...form, brands: e.target.value })} />
                      </div>
                    </div>
                    {xmlSources.length > 0 && (
                      <div className="form-group">
                        <label className="form-label">XML kaynakları</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                          {xmlSources.map((s) => (
                            <label key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                              <input type="checkbox" checked={form.xmlSourceIds.includes(s.id)} onChange={() => toggleIn('xmlSourceIds', s.id)} /> {s.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    {categoryOptions.length > 0 && (
                      <div className="form-group">
                        <label className="form-label">Kategoriler {form.categories.length > 0 && <span style={{ color: 'var(--text-muted)' }}>({form.categories.length} seçili)</span>}</label>
                        <input className="form-input" placeholder="Kategori ara…" value={catSearch} onChange={(e) => setCatSearch(e.target.value)} style={{ marginBottom: 6 }} />
                        <div style={{ maxHeight: 130, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, padding: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                          {visibleCategories.map((c) => (
                            <label key={c} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 12 }}>
                              <input type="checkbox" checked={form.categories.includes(c)} onChange={() => toggleIn('categories', c)} /> {c}
                            </label>
                          ))}
                          {visibleCategories.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sonuç yok</span>}
                        </div>
                      </div>
                    )}
                    <div className="form-group">
                      <label className="form-label">Alış fiyatı aralığı (₺, KDV dahil alış)</label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="number" min="0" step="0.01" className="form-input" placeholder="En az" value={form.minPurchasePrice}
                          onChange={(e) => setForm({ ...form, minPurchasePrice: e.target.value })} style={inputStyle} />
                        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>ile</span>
                        <input type="number" min="0" step="0.01" className="form-input" placeholder="En çok" value={form.maxPurchasePrice}
                          onChange={(e) => setForm({ ...form, maxPurchasePrice: e.target.value })} style={inputStyle} />
                      </div>
                    </div>
                  </Section>

                  <Section title="2. Giderler" hint="Sabit giderler alış fiyatına eklenir; yüzdeler satış fiyatından düşülür. Satış KDV’si ürünün XML kaynağındaki orandan alınır (XML eklenirken belirlenir).">
                    <div className="grid grid-2">
                      <div className="form-group"><label className="form-label">Kargo (₺)</label>
                        <input type="number" min="0" step="0.01" className="form-input" value={form.shippingCost} onChange={(e) => setForm({ ...form, shippingCost: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">Paketleme (₺)</label>
                        <input type="number" min="0" step="0.01" className="form-input" value={form.packagingCost} onChange={(e) => setForm({ ...form, packagingCost: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">Ek sabit gider (₺)</label>
                        <input type="number" min="0" step="0.01" className="form-input" value={form.extraCost} onChange={(e) => setForm({ ...form, extraCost: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">Pazaryeri komisyonu (%)</label>
                        <input type="number" min="0" max="100" step="0.1" className="form-input" value={form.commissionPct} onChange={(e) => setForm({ ...form, commissionPct: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">Diğer yüzde gider (%) — reklam, ödeme vb.</label>
                        <input type="number" min="0" max="100" step="0.1" className="form-input" value={form.extraPct} onChange={(e) => setForm({ ...form, extraPct: e.target.value })} /></div>

                    </div>
                  </Section>

                  <Section title="3. Kâr">
                    <div className="grid grid-2">
                      <div className="form-group">
                        <label className="form-label">Kâr yöntemi</label>
                        <select className="form-select" value={form.profitMode} onChange={(e) => setForm({ ...form, profitMode: e.target.value })}>
                          {PROFIT_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">{form.profitMode === 'fixed' ? 'Kâr tutarı (₺) *' : 'Kâr oranı (%) *'}</label>
                        <input type="number" min="0" step="0.01" className="form-input" value={form.value}
                          onChange={(e) => setForm({ ...form, value: e.target.value })} required />
                      </div>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6 }}>{PROFIT_MODES.find((m) => m.key === form.profitMode)?.hint}</p>
                  </Section>

                  <Section title="4. Yuvarlama ve sınırlar">
                    <div className="grid grid-2">
                      <div className="form-group"><label className="form-label">Fiyat sonu</label>
                        <select className="form-select" value={form.rounding} onChange={(e) => setForm({ ...form, rounding: e.target.value })}>
                          {ROUNDINGS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select></div>
                      <div className="form-group" />
                      <div className="form-group"><label className="form-label">En düşük satış fiyatı (₺)</label>
                        <input type="number" min="0" step="0.01" className="form-input" value={form.minPrice} onChange={(e) => setForm({ ...form, minPrice: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">En yüksek satış fiyatı (₺)</label>
                        <input type="number" min="0" step="0.01" className="form-input" value={form.maxPrice} onChange={(e) => setForm({ ...form, maxPrice: e.target.value })} /></div>
                    </div>
                  </Section>
                </div>

                {/* Live preview */}
                <div>
                  <div style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Calculator size={18} style={{ color: 'var(--accent-primary)' }} />
                      <strong style={{ fontSize: 14 }}>Canlı önizleme</strong>
                    </div>
                    <label className="form-label">Örnek alış fiyatı (₺)</label>
                    <input type="number" min="0" step="0.01" className="form-input" value={samplePrice} onChange={(e) => setSamplePrice(e.target.value)} />
                    {previewError && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>{previewError}</p>}
                    {!preview && !previewError && <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 10 }}>Kâr değerini girince satış fiyatı burada hesaplanır.</p>}
                    {preview && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 12 }}>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Satış fiyatı</div>
                          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent-primary)' }}>₺{fmt(preview.price)}</div>
                        </div>
                        {[
                          ['Alış fiyatı', `₺${fmt(preview.purchase)}`],
                          ['Sabit giderler', `₺${fmt(preview.fixedCosts)}`],
                          ['Komisyon + gider %', `−₺${fmt(preview.commissionAmount)}`],
                          ['Kâr', `₺${fmt(preview.profit)}`],
                          [`KDV (%${previewVat})`, `₺${fmt(preview.vatAmount)}`],
                        ].map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {coverage && (
                      <div style={{ marginTop: 14, fontSize: 12, display: 'flex', gap: 6, alignItems: 'flex-start', color: 'var(--text-secondary)' }}>
                        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span>Bu şablonun kapsamı <strong>{coverage.covered}</strong> / {coverage.total} ürün.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>İptal</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Güncelle' : 'Kaydet'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header"><h3>Şablonu Sil</h3><button className="modal-close" onClick={() => setDeleteConfirm(null)}>×</button></div>
            <div className="modal-body"><p>Bu fiyat şablonunu silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</p></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>İptal</button>
              <button className="btn btn-danger" onClick={handleDelete}>Evet, Sil</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
