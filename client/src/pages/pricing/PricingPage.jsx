import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Tags, ToggleLeft, ToggleRight, Edit2, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import CoveragePanel from './CoveragePanel';
import TierTable, { emptyTiers, rowsToTiers, tiersToRows } from './TierTable';

/**
 * Fiyat şablonları – tek ekran, iki şablon türü:
 *   Tek kâr       : tüm ürünlere aynı kâr (yüzde ya da tutar)
 *   Kademeli kâr  : alış fiyatına göre farklı kâr (yüzde ya da tutar, istediğiniz kadar kademe)
 * Maliyetler her ikisinde de aynı ve tek değerlidir: kargo, diğer gider, komisyon.
 * Hesabın tamamı sunucudaki fiyat motorunda yapılır (ürünler gönderilirken kullanılan aynı motor).
 */

const ROUNDINGS = [
  { key: 'none', label: 'Değiştirme' },
  { key: 'ending:0.9', label: 'Sonu .90 olsun (129,90)' },
  { key: 'ending:0.99', label: 'Sonu .99 olsun (129,99)' },
  { key: 'int', label: 'Tam sayıya yuvarla (130)' },
];

const UNITS = [
  { key: 'percent_of_purchase', label: 'Yüzde (%)' },
  { key: 'fixed', label: 'Tutar (₺)' },
];

// Older versions of the screen could store these; the current screen does not offer them
const MODE_LABELS = {
  percent_of_cost: 'maliyetin yüzdesi',
  margin_on_price: 'satış fiyatı marjı',
  margin_on_gross: 'net marj',
};

const EMPTY_FORM = {
  name: '', connectionId: '', xmlChoice: '',
  minPurchasePrice: '', maxPurchasePrice: '', // only kept when an existing template has them
  shippingCost: '', otherCost: '', commissionPct: '',
  mode: 'single',                 // 'single' | 'tiered'
  unit: 'percent_of_purchase',    // 'percent_of_purchase' | 'fixed'
  value: '',                      // single profit
  profitRows: [],                 // tiered profit rows
  rounding: 'none',
};

const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(parseFloat(v)) ? null : parseFloat(v));
const money = (n) => (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseConds(rule) {
  try { return rule.conditions ? JSON.parse(rule.conditions) : {}; } catch { return {}; }
}

function ruleToForm(r) {
  const c = parseConds(r);
  const legacy = r.applyTo === 'marketplace_xml';
  const srcIds = c.xmlSourceIds && c.xmlSourceIds.length ? c.xmlSourceIds : (c.xmlSourceId ? [c.xmlSourceId] : []);
  let rounding = 'none';
  if (c.roundingMode === 'int') rounding = 'int';
  else if (c.roundingMode === 'ending') rounding = `ending:${c.roundingEnding ?? 0.9}`;

  const mode0 = c.profitMode || (legacy && r.type === 'fixed' ? 'fixed' : 'percent_of_purchase');
  const supportedMode = mode0 === 'fixed' || mode0 === 'percent_of_purchase';
  const profitRows = tiersToRows(c.profitTiers, 'value');
  const hasShippingTable = Array.isArray(c.shippingTiers) && c.shippingTiers.length > 1;

  // Settings this screen does not show: told to the user, dropped when the template is saved
  const legacyNotes = [];
  if (legacy) legacyNotes.push('eski tip kural');
  if (hasShippingTable) legacyNotes.push('sipariş tutarına göre kademeli kargo');
  if (!supportedMode) legacyNotes.push(`kâr yöntemi: ${MODE_LABELS[mode0] || mode0}`);
  if ((c.categories && c.categories.length) || (c.brands && c.brands.length)) legacyNotes.push('kategori/marka filtresi');

  return {
    name: r.name || '',
    connectionId: c.connectionId || '',
    xmlChoice: srcIds.length > 1 ? '__keep' : (srcIds[0] || ''),
    minPurchasePrice: c.minPurchasePrice ?? '',
    maxPurchasePrice: c.maxPurchasePrice ?? '',
    shippingCost: hasShippingTable ? '' : (c.shippingCost ?? ''),
    otherCost: c.packagingCost ?? '',
    commissionPct: c.commissionPct ?? '',
    mode: profitRows.length > 0 ? 'tiered' : 'single',
    unit: mode0 === 'fixed' ? 'fixed' : 'percent_of_purchase',
    value: r.value ?? '',
    profitRows,
    rounding,
    _keep: {
      xmlSourceIds: srcIds, extraCost: c.extraCost ?? 0, extraPct: c.extraPct ?? 0,
      minPrice: c.minPrice ?? null, maxPrice: c.maxPrice ?? null, priority: r.priority ?? 0,
      legacyNotes,
    },
  };
}

function formToPayload(f) {
  const keep = f._keep || {};
  const [rm, re] = f.rounding.includes(':') ? f.rounding.split(':') : [f.rounding, null];
  const xmlSourceIds = f.xmlChoice === '__keep' ? (keep.xmlSourceIds || []) : (f.xmlChoice ? [f.xmlChoice] : []);
  const tiered = f.mode === 'tiered';
  const conditions = {
    connectionId: f.connectionId || null,
    xmlSourceIds,
    categories: [], brands: [],
    minPurchasePrice: num(f.minPurchasePrice),
    maxPurchasePrice: num(f.maxPurchasePrice),
    shippingCost: num(f.shippingCost) ?? 0,
    packagingCost: num(f.otherCost) ?? 0,
    extraCost: keep.extraCost ?? 0,
    commissionPct: num(f.commissionPct) ?? 0,
    extraPct: keep.extraPct ?? 0,
    commissionBasis: 'gross', // commission on the sale price the customer pays, as marketplaces charge it
    vatRate: null,            // sale VAT comes from the product's XML source
    profitMode: f.unit,
    roundingMode: rm,
    roundingEnding: re ? parseFloat(re) : null,
    minPrice: keep.minPrice ?? null,
    maxPrice: keep.maxPrice ?? null,
    shippingTiers: [],
    profitTiers: tiered ? rowsToTiers(f.profitRows, 'value').tiers : [],
  };
  return { name: f.name, type: 'percentage', value: tiered ? 0 : (num(f.value) ?? 0), applyTo: 'price_template', priority: keep.priority ?? 0, conditions };
}

function Choice({ active, title, hint, onClick, testId }) {
  return (
    <button type="button" data-testid={testId} aria-pressed={active} onClick={onClick}
      style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)',
        border: active ? '2px solid var(--accent-primary)' : '2px solid var(--border-color)',
        background: active ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)' }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
    </button>
  );
}

const sectionTitle = { fontSize: 13, fontWeight: 700, margin: '18px 0 8px' };
const hintStyle = { fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 };

export default function PricingPage() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [xmlSources, setXmlSources] = useState([]);
  const [connections, setConnections] = useState([]);
  const [samplePrice, setSamplePrice] = useState('');
  const [ruleSummaries, setRuleSummaries] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [summary, setSummary] = useState(null);
  const reqId = useRef(0);

  useEffect(() => { fetchRules(); fetchOptions(); }, []);

  const fetchOptions = async () => {
    try {
      const [xmlRes, connRes] = await Promise.all([api.get('/xml-sources'), api.get('/marketplace/connections')]);
      setXmlSources(xmlRes.data);
      setConnections(connRes.data);
    } catch { /* optional lists */ }
  };

  const fetchRules = async () => {
    try { setRules((await api.get('/pricing')).data); }
    catch { toast.error('Şablonlar yüklenemedi'); }
    finally { setLoading(false); }
    api.get('/pricing/summaries').then((r) => setRuleSummaries(r.data)).catch(() => setRuleSummaries(null));
  };

  const payload = useMemo(() => formToPayload(form), [form]);
  const tiered = form.mode === 'tiered';
  const rowsIncomplete = tiered && rowsToTiers(form.profitRows, 'value').incomplete;
  const profitReady = tiered ? payload.conditions.profitTiers.length > 0 : form.value !== '';

  // Sale VAT used by the single-price try-out = the VAT chosen when the XML source was added
  const previewVat = useMemo(() => {
    const ids = form.xmlChoice && form.xmlChoice !== '__keep' ? [form.xmlChoice] : (form.xmlChoice === '__keep' ? form._keep?.xmlSourceIds || [] : xmlSources.map((x) => x.id));
    return xmlSources.find((x) => ids.includes(x.id))?.defaultVatRate ?? 20;
  }, [form.xmlChoice, form._keep, xmlSources]);

  // Live numbers from the server pricing engine (debounced)
  useEffect(() => {
    if (!showModal) return undefined;
    const my = ++reqId.current;
    const t = setTimeout(async () => {
      if (!profitReady) { setPreview(null); setSummary(null); setPreviewError(''); return; }
      const purchase = num(samplePrice);
      if (purchase && purchase > 0) {
        try {
          const res = await api.post('/pricing/calculate', { purchasePrice: purchase, value: payload.value, conditions: { ...payload.conditions, vatRate: previewVat } });
          if (my === reqId.current) { setPreview(res.data); setPreviewError(''); }
        } catch (err) {
          if (my === reqId.current) { setPreview(null); setPreviewError(err.response?.data?.error || 'Hesaplanamadı'); }
        }
      } else if (my === reqId.current) setPreview(null);
      try {
        const res = await api.post('/pricing/coverage', { value: payload.value, conditions: payload.conditions });
        if (my === reqId.current) setSummary(res.data);
      } catch { /* optional */ }
    }, 350);
    return () => clearTimeout(t);
  }, [payload, samplePrice, showModal, previewVat, profitReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const openModal = (rule = null) => {
    if (rule) { setEditingId(rule.id); setForm(ruleToForm(rule)); }
    else { setEditingId(null); setForm({ ...EMPTY_FORM }); }
    setPreview(null); setSummary(null); setPreviewError('');
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingId(null); setForm({ ...EMPTY_FORM }); };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Şablon adını yazın');
    if (tiered && rowsIncomplete) return toast.error('Kâr tablosundaki tüm alanları doldurun');
    if (!tiered && form.value === '') return toast.error('Kâr değerini girin');
    const min = num(form.minPurchasePrice), max = num(form.maxPurchasePrice);
    if (min !== null && max !== null && min > max) return toast.error('Alış fiyatı aralığında en düşük değer en yüksekten büyük olamaz');
    try {
      if (editingId) { await api.put(`/pricing/${editingId}`, payload); toast.success('Şablon güncellendi'); }
      else { await api.post('/pricing', payload); toast.success('Şablon eklendi'); }
      closeModal();
      fetchRules();
    } catch (err) { toast.error(err.response?.data?.error || 'Hata'); }
  };

  const toggleActive = async (id, current) => {
    try { await api.put(`/pricing/${id}`, { isActive: !current }); fetchRules(); }
    catch { toast.error('Güncelleme hatası'); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const id = deleteConfirm; setDeleteConfirm(null);
    try { await api.delete(`/pricing/${id}`); toast.success('Şablon silindi'); fetchRules(); }
    catch { toast.error('Silme hatası'); }
  };

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setMode = (mode) => set(mode === 'tiered' ? { mode, profitRows: form.profitRows.length ? form.profitRows : emptyTiers() } : { mode });

  const profitLabel = (r) => {
    const c = parseConds(r);
    if (r.applyTo === 'marketplace_xml') return r.type === 'fixed' ? `Tek kâr +₺${r.value}` : `Tek kâr %${r.value}`;
    const fixed = c.profitMode === 'fixed';
    if (Array.isArray(c.profitTiers) && c.profitTiers.length > 1) return `Kademeli kâr (${fixed ? 'tutar' : 'yüzde'})`;
    if (c.profitMode === 'margin_on_gross' || c.profitMode === 'margin_on_price') return `Net marj %${r.value}`;
    return fixed ? `Tek kâr ₺${r.value}` : `Tek kâr %${r.value}`;
  };

  const renderScope = (r) => {
    const c = parseConds(r);
    const conn = c.connectionId ? connections.find((x) => x.id === c.connectionId) : null;
    const srcIds = c.xmlSourceIds && c.xmlSourceIds.length ? c.xmlSourceIds : (c.xmlSourceId ? [c.xmlSourceId] : []);
    const names = srcIds.map((id) => xmlSources.find((x) => x.id === id)?.name || '—');
    const parts = [conn ? (conn.supplierName || conn.marketplaceType) : 'Tüm pazaryerleri', names.length ? names.join(', ') : 'Tüm XML’ler'];
    if (c.minPurchasePrice != null || c.maxPurchasePrice != null) parts.push(`alış ₺${c.minPurchasePrice ?? 0} – ${c.maxPurchasePrice != null ? '₺' + c.maxPurchasePrice : '∞'}`);
    if ((c.categories && c.categories.length) || (c.brands && c.brands.length)) parts.push('eski kategori/marka filtresi');
    return <span style={{ fontSize: 12 }}>{parts.join(' · ')}</span>;
  };

  const renderCosts = (r) => {
    const c = parseConds(r);
    const fixed = (Number(c.shippingCost) || 0) + (Number(c.packagingCost) || 0) + (Number(c.extraCost) || 0);
    const parts = [];
    if (Array.isArray(c.shippingTiers) && c.shippingTiers.length > 1) parts.push(`kademeli kargo + ₺${money((Number(c.packagingCost) || 0) + (Number(c.extraCost) || 0))} diğer`);
    else if (fixed > 0) parts.push(`₺${money(fixed)} sabit`);
    const pct = (Number(c.commissionPct) || 0) + (Number(c.extraPct) || 0);
    if (pct > 0) parts.push(`%${pct} komisyon`);
    return parts.length ? parts.join(' + ') : '—';
  };

  const earnClass = (n) => (n > 0 ? 'var(--success)' : n < 0 ? 'var(--danger)' : 'var(--text-muted)');
  const sum = (id) => ruleSummaries?.rules?.[id];
  const legacyNotes = editingId ? (form._keep?.legacyNotes || []) : [];
  const hasRange = form.minPurchasePrice !== '' || form.maxPurchasePrice !== '';

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Fiyat Şablonları</h1>
          <p>Alış fiyatından satış fiyatını hesaplar ve tüm ürünlerinizde ne kadar kazanacağınızı gösterir. Ürünlerin gönderilebilmesi için en az bir şablon gerekir.</p>
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
            <p>Giderlerinizi ve istediğiniz kârı girin, tüm ürünlerinizde satış fiyatını ve kazancınızı görün.</p>
            <button className="btn btn-primary" onClick={() => openModal()}><Plus size={16} /> İlk Şablonu Ekle</button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead><tr><th>Şablon</th><th>Uygulandığı yer</th><th style={{ textAlign: 'right' }}>Ürün</th><th style={{ textAlign: 'right' }}>Net marj</th><th style={{ textAlign: 'right' }}>Toplam kazanç</th><th>Durum</th><th>İşlem</th></tr></thead>
            <tbody>
              {rules.map((r) => {
                const sm = sum(r.id);
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>
                        {r.name}
                        {r.applyTo === 'marketplace_xml' && (
                          <span className="badge badge-warning" style={{ marginLeft: 8, fontSize: 10, verticalAlign: 'middle' }} title="Eski tip kural. Düzenleyip kaydederseniz yeni şablona dönüşür.">Eski tip</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{profitLabel(r)} · giderler {renderCosts(r)}</div>
                    </td>
                    <td>{renderScope(r)}</td>
                    <td style={{ textAlign: 'right' }}>{r.applyTo === 'marketplace_xml' ? '—' : sm ? sm.covered : '…'}</td>
                    <td style={{ textAlign: 'right' }}>{sm ? `%${sm.marginOnPricePct}` : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: sm ? earnClass(sm.totalProfit) : undefined }}>
                      {sm ? `₺${money(sm.totalProfit)}` : '—'}
                      {sm && sm.losing > 0 && <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 400 }}>{sm.losing} üründe zarar</div>}
                    </td>
                    <td>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.isActive ? 'var(--success)' : 'var(--text-muted)' }} onClick={() => toggleActive(r.id, r.isActive)}>
                        {r.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                      </button>
                    </td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" data-testid={`edit-${r.id}`} onClick={() => openModal(r)}><Edit2 size={14} /></button>
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(r.id)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980, width: '95vw' }}>
            <div className="modal-header">
              <h3>{editingId ? 'Şablonu Düzenle' : 'Fiyat Şablonu Ekle'}</h3>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(340px,1.1fr)', gap: 24, maxHeight: '75vh', overflowY: 'auto' }}>
                {/* ---------- one screen: template type, where, costs, profit ---------- */}
                <div data-testid="template-form">
                  <div style={{ ...sectionTitle, marginTop: 0 }}>Şablon türü</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Choice testId="mode-single" active={!tiered} title="Tek kâr" hint="Tüm ürünlere aynı kâr" onClick={() => setMode('single')} />
                    <Choice testId="mode-tiered" active={tiered} title="Kademeli kâr" hint="Alış fiyatına göre farklı kâr" onClick={() => setMode('tiered')} />
                  </div>

                  <div className="form-group" style={{ marginTop: 16 }}>
                    <label className="form-label">Şablon adı *</label>
                    <input className="form-input" placeholder="ör: Genel fiyat" value={form.name} onChange={(e) => set({ name: e.target.value })} required />
                  </div>
                  <div className="grid grid-2">
                    <div className="form-group">
                      <label className="form-label">Pazaryeri</label>
                      <select className="form-select" value={form.connectionId} onChange={(e) => set({ connectionId: e.target.value })}>
                        <option value="">Hepsi</option>
                        {connections.map((c) => <option key={c.id} value={c.id}>{c.supplierName || c.marketplaceType}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">XML kaynağı</label>
                      <select className="form-select" value={form.xmlChoice} onChange={(e) => set({ xmlChoice: e.target.value })}>
                        <option value="">Hepsi</option>
                        {form.xmlChoice === '__keep' && <option value="__keep">Seçili {form._keep?.xmlSourceIds?.length} kaynak (korunuyor)</option>}
                        {xmlSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                  {hasRange && (
                    <div data-testid="range-note" style={{ ...hintStyle, marginBottom: 8 }}>
                      Bu şablon yalnızca alış fiyatı ₺{form.minPurchasePrice === '' ? 0 : form.minPurchasePrice} – {form.maxPurchasePrice === '' ? '∞' : `₺${form.maxPurchasePrice}`} olan ürünlere uygulanır.{' '}
                      <button type="button" onClick={() => set({ minPurchasePrice: '', maxPurchasePrice: '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: 11.5, padding: 0, fontFamily: 'inherit' }}>Sınırı kaldır</button>
                    </div>
                  )}

                  <div style={sectionTitle}>Maliyetlerim</div>
                  <div style={{ ...hintStyle, marginBottom: 8 }}>Her sipariş için ödediğiniz tutarları yazın. Satış fiyatı bunları ve kârınızı karşılayacak şekilde hesaplanır.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    <div className="form-group"><label className="form-label">Kargo (₺)</label>
                      <input type="number" min="0" step="0.01" className="form-input" data-testid="cost-shipping" value={form.shippingCost} onChange={(e) => set({ shippingCost: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Diğer gider (₺)</label>
                      <input type="number" min="0" step="0.01" className="form-input" data-testid="cost-other" value={form.otherCost} onChange={(e) => set({ otherCost: e.target.value })} />
                      <small style={hintStyle}>paketleme, hizmet bedeli vb.</small></div>
                    <div className="form-group"><label className="form-label">Komisyon (%)</label>
                      <input type="number" min="0" max="90" step="0.01" className="form-input" data-testid="cost-commission" value={form.commissionPct} onChange={(e) => set({ commissionPct: e.target.value })} />
                      <small style={hintStyle}>satış fiyatının %’si</small></div>
                  </div>

                  <div style={sectionTitle}>Kârım</div>
                  <div style={{ ...hintStyle, marginBottom: 8 }}>Kâr, tüm giderler düşüldükten sonra elinize kalan net tutardır.</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    {UNITS.map((u) => (
                      <button key={u.key} type="button" data-testid={`unit-${u.key}`} onClick={() => set({ unit: u.key })}
                        style={{ flex: 1, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-primary)',
                          border: form.unit === u.key ? '2px solid var(--accent-primary)' : '2px solid var(--border-color)',
                          background: form.unit === u.key ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)' }}>{u.label}</button>
                    ))}
                  </div>

                  {!tiered ? (
                    <div className="form-group">
                      <label className="form-label">{form.unit === 'fixed' ? 'Ürün başına kâr (₺) *' : 'Kâr oranı (%) *'}</label>
                      <input type="number" min="0" step="0.01" className="form-input" data-testid="profit-value" value={form.value} onChange={(e) => set({ value: e.target.value })} required />
                      <small style={hintStyle}>
                        {form.unit === 'fixed'
                          ? 'Her üründe aynı tutar. Örnek: 25 yazarsanız her üründen net 25 ₺ kalır.'
                          : 'Alış fiyatının yüzdesi. Örnek: alış 100 ₺, oran %30 → net 30 ₺ kalır.'}
                      </small>
                    </div>
                  ) : (
                    <div data-testid="tiered-profit">
                      <div style={{ ...hintStyle, marginBottom: 8 }}>
                        Ürünün alış fiyatına uyan satır uygulanır. Her satıra alış fiyatının üst sınırını ve kârı yazın; son satır “üstü”dür. İstediğiniz kadar satır ekleyebilirsiniz.
                        Örnek: 100 ₺’ye kadar %40 · 300 ₺’ye kadar %30 · üstü %20.
                      </div>
                      <TierTable testId="profit-tiers" rows={form.profitRows} onChange={(rows) => set({ profitRows: rows })}
                        limitLabel="Alış fiyatı" valueLabel={form.unit === 'fixed' ? 'Kâr (₺)' : 'Kâr oranı'} valueUnit={form.unit === 'fixed' ? '₺' : '%'} />
                    </div>
                  )}

                  <div className="form-group" style={{ marginTop: 14 }}>
                    <label className="form-label">Fiyat sonu</label>
                    <select className="form-select" data-testid="rounding" value={form.rounding} onChange={(e) => set({ rounding: e.target.value })}>
                      {ROUNDINGS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </select>
                  </div>

                  {legacyNotes.length > 0 && (
                    <div data-testid="legacy-warning" style={{ fontSize: 12, color: 'var(--warning)', display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 10 }}>
                      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>Bu şablonda bu ekranda bulunmayan ayarlar var ({legacyNotes.join(', ')}). Kaydederseniz bu ayarlar kaldırılır ve fiyatlar değişebilir; sağdaki tablo yeni halini gösterir.</span>
                    </div>
                  )}
                </div>

                {/* ---------- result over the real products ---------- */}
                <div>
                  <div style={{ position: 'sticky', top: 0 }}>
                    <CoveragePanel summary={summary} preview={preview} previewError={previewError} samplePrice={samplePrice}
                      setSamplePrice={setSamplePrice} previewVat={previewVat} rowsIncomplete={rowsIncomplete} />
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
