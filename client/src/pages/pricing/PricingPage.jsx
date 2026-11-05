import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Tags, ToggleLeft, ToggleRight, Edit2, TrendingUp, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

/**
 * Fiyat şablonları – kısa form + canlı "ne kadar kazanırım" özeti.
 * Hesabın tamamı sunucudaki fiyat motorunda yapılır (ürünler gönderilirken kullanılan aynı motor).
 */

const ROUNDINGS = [
  { key: 'none', label: 'Değiştirme' },
  { key: 'ending:0.9', label: 'Sonu .90 olsun (129,90)' },
  { key: 'ending:0.99', label: 'Sonu .99 olsun (129,99)' },
  { key: 'int', label: 'Tam sayıya yuvarla (130)' },
];

const MODE_LABELS = {
  percent_of_purchase: 'Yüzde kâr',
  fixed: 'Sabit kâr',
  percent_of_cost: 'Maliyetin yüzdesi',
  margin_on_price: 'Satış fiyatı marjı',
};

import TierTable, { emptyTiers, rowsToTiers, tiersToRows } from './TierTable';

const EMPTY_FORM = {
  name: '', connectionId: '', xmlChoice: '',
  minPurchasePrice: '', maxPurchasePrice: '',
  shippingCost: '', otherCost: '', commissionPct: '',
  profitMode: 'percent_of_purchase', value: '', rounding: 'none',
  shippingRows: [], profitRows: [], // empty = single amount / single rate (tables closed)
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
  return {
    name: r.name || '',
    connectionId: c.connectionId || '',
    xmlChoice: srcIds.length > 1 ? '__keep' : (srcIds[0] || ''),
    minPurchasePrice: c.minPurchasePrice ?? '',
    maxPurchasePrice: c.maxPurchasePrice ?? '',
    shippingCost: c.shippingCost ?? '',
    otherCost: c.packagingCost ?? '',
    commissionPct: c.commissionPct ?? '',
    profitMode: c.profitMode || (legacy && r.type === 'fixed' ? 'fixed' : 'percent_of_purchase'),
    value: r.value ?? '',
    rounding,
    shippingRows: tiersToRows(c.shippingTiers, 'cost'),
    profitRows: tiersToRows(c.profitTiers, 'value'),
    _keep: {
      xmlSourceIds: srcIds, extraCost: c.extraCost ?? 0, extraPct: c.extraPct ?? 0,
      minPrice: c.minPrice ?? null, maxPrice: c.maxPrice ?? null, priority: r.priority ?? 0,
      hadFilters: !!((c.categories && c.categories.length) || (c.brands && c.brands.length)),
    },
  };
}

function formToPayload(f) {
  const keep = f._keep || {};
  const [rm, re] = f.rounding.includes(':') ? f.rounding.split(':') : [f.rounding, null];
  const xmlSourceIds = f.xmlChoice === '__keep' ? (keep.xmlSourceIds || []) : (f.xmlChoice ? [f.xmlChoice] : []);
  const conditions = {
    connectionId: f.connectionId || null,
    xmlSourceIds,
    // categories / brands are no longer part of a template
    categories: [], brands: [],
    minPurchasePrice: num(f.minPurchasePrice),
    maxPurchasePrice: num(f.maxPurchasePrice),
    shippingCost: num(f.shippingCost) ?? 0,
    packagingCost: num(f.otherCost) ?? 0,
    extraCost: keep.extraCost ?? 0,
    commissionPct: num(f.commissionPct) ?? 0,
    extraPct: keep.extraPct ?? 0,
    commissionBasis: 'gross', // commission on the VAT-inclusive sale price, as the marketplace charges it
    vatRate: null,            // sale VAT comes from the product's XML source
    profitMode: f.profitMode,
    roundingMode: rm,
    roundingEnding: re ? parseFloat(re) : null,
    minPrice: keep.minPrice ?? null,
    maxPrice: keep.maxPrice ?? null,
    shippingTiers: rowsToTiers(f.shippingRows, 'cost').tiers,
    profitTiers: rowsToTiers(f.profitRows, 'value').tiers,
  };
  return { name: f.name, type: 'percentage', value: num(f.value) ?? 0, applyTo: 'price_template', priority: keep.priority ?? 0, conditions };
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
  const [samplePrice, setSamplePrice] = useState('100');
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
  };

  const payload = useMemo(() => formToPayload(form), [form]);

  // Sale VAT used by the preview = the VAT chosen when the XML source was added
  const previewVat = useMemo(() => {
    const ids = form.xmlChoice && form.xmlChoice !== '__keep' ? [form.xmlChoice] : (form.xmlChoice === '__keep' ? form._keep?.xmlSourceIds || [] : xmlSources.map((x) => x.id));
    return xmlSources.find((x) => ids.includes(x.id))?.defaultVatRate ?? 20;
  }, [form.xmlChoice, form._keep, xmlSources]);

  // Live numbers from the server pricing engine (debounced)
  useEffect(() => {
    if (!showModal) return undefined;
    const my = ++reqId.current;
    const t = setTimeout(async () => {
      if (form.value === '' && !profitTiersOn) { setPreview(null); setSummary(null); setPreviewError(''); return; }
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
  }, [payload, samplePrice, showModal, previewVat]); // eslint-disable-line react-hooks/exhaustive-deps

  const openModal = (rule = null) => {
    if (rule) { setEditingId(rule.id); setForm(ruleToForm(rule)); }
    else { setEditingId(null); setForm({ ...EMPTY_FORM }); }
    setPreview(null); setSummary(null); setPreviewError('');
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingId(null); setForm({ ...EMPTY_FORM }); };

  const handleSave = async (e) => {
    e.preventDefault();
    const shipInc = rowsToTiers(form.shippingRows, 'cost').incomplete, profInc = rowsToTiers(form.profitRows, 'value').incomplete;
    if (shipInc) return toast.error('Kargo tablosundaki tüm alanları doldurun ya da tabloyu kapatın');
    if (profInc) return toast.error('Kâr tablosundaki tüm alanları doldurun ya da tabloyu kapatın');
    if (form.value === '' && !profitTiersOn) return toast.error('Kâr değerini girin');
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
  const rowsIncomplete = rowsToTiers(form.shippingRows, 'cost').incomplete || rowsToTiers(form.profitRows, 'value').incomplete;
  const profitTiersOn = payload.conditions.profitTiers.length > 0;
  const modes = [
    { key: 'percent_of_purchase', title: 'Yüzde kâr', hint: 'Alış fiyatının yüzdesi kadar kâr' },
    { key: 'fixed', title: 'Sabit kâr', hint: 'Her üründe aynı tutar (₺)' },
  ];
  // an older template may use a method that is no longer offered – keep it visible so it is not changed by accident
  if (!modes.some((m) => m.key === form.profitMode)) modes.push({ key: form.profitMode, title: MODE_LABELS[form.profitMode] || form.profitMode, hint: 'Eski şablondan' });

  const profitLabel = (r) => {
    const c = parseConds(r);
    if (r.applyTo === 'marketplace_xml') return r.type === 'fixed' ? `+₺${r.value}` : `%${r.value}`;
    if (Array.isArray(c.profitTiers) && c.profitTiers.length > 1) return 'Kademeli';
    return c.profitMode === 'fixed' ? `₺${r.value}` : `%${r.value}`;
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
    return <span style={{ fontSize: 12 }}>{parts.length ? parts.join(' + ') : '—'}</span>;
  };

  const earnClass = (n) => (n > 0 ? 'var(--success)' : n < 0 ? 'var(--danger)' : 'var(--text-muted)');

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Fiyat Şablonları</h1>
          <p>Alış fiyatından satış fiyatını hesaplar ve ne kadar kazanacağınızı gösterir. Ürünlerin gönderilebilmesi için en az bir şablon gerekir.</p>
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
            <p>Giderlerinizi ve istediğiniz kârı girin, satış fiyatını ve kazancınızı görün.</p>
            <button className="btn btn-primary" onClick={() => openModal()}><Plus size={16} /> İlk Şablonu Ekle</button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead><tr><th>Şablon</th><th>Kâr</th><th>Giderler</th><th>Kapsam</th><th>Durum</th><th>İşlem</th></tr></thead>
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
                  <td>{renderCosts(r)}</td>
                  <td>{renderScope(r)}</td>
                  <td>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.isActive ? 'var(--success)' : 'var(--text-muted)' }} onClick={() => toggleActive(r.id, r.isActive)}>
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
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: '95%' }}>
            <div className="modal-header">
              <h3>{editingId ? 'Şablonu Düzenle' : 'Fiyat Şablonu Ekle'}</h3>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(300px,1fr)', gap: 24, maxHeight: '75vh', overflowY: 'auto' }}>
                {/* ---------- form ---------- */}
                <div>
                  <div className="form-group">
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

                  <div className="form-group">
                    <label className="form-label">Alış fiyatı aralığı (₺) <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— boşsa tüm fiyatlar</span></label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="number" min="0" step="0.01" className="form-input" placeholder="en az" value={form.minPurchasePrice} onChange={(e) => set({ minPurchasePrice: e.target.value })} />
                      <span style={{ color: 'var(--text-muted)' }}>–</span>
                      <input type="number" min="0" step="0.01" className="form-input" placeholder="en çok" value={form.maxPurchasePrice} onChange={(e) => set({ maxPurchasePrice: e.target.value })} />
                    </div>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, margin: '18px 0 8px' }}>Giderleriniz</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    <div className="form-group"><label className="form-label">Kargo (₺)</label>
                      <input type="number" min="0" step="0.01" className="form-input" value={form.shippingCost} disabled={form.shippingRows.length > 0} onChange={(e) => set({ shippingCost: e.target.value })} />
                      <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Faturada ödediğiniz tutar (KDV dahil)</small></div>
                    <div className="form-group"><label className="form-label">Paketleme/diğer (₺)</label>
                      <input type="number" min="0" step="0.01" className="form-input" value={form.otherCost} onChange={(e) => set({ otherCost: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Komisyon (%)</label>
                      <input type="number" min="0" max="90" step="0.1" className="form-input" value={form.commissionPct} onChange={(e) => set({ commissionPct: e.target.value })} /></div>
                  </div>

                  <div style={{ marginBottom: 6 }}>
                    {form.shippingRows.length === 0 ? (
                      <button type="button" data-testid="open-shipping-tiers" onClick={() => set({ shippingRows: emptyTiers() })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: 12, padding: 0, fontFamily: 'inherit' }}>
                        Kargo, satış fiyatına göre değişiyor mu? (ör. barem)
                      </button>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                          Kargonuzu satış fiyatına göre yazın. Sistem, ürünün satış fiyatına uyan satırı kendisi seçer.
                        </div>
                        <TierTable testId="shipping-tiers" rows={form.shippingRows} onChange={(rows) => set({ shippingRows: rows })}
                          limitLabel="Satış fiyatı (KDV dahil)" valueLabel="Kargo ücretim" valueUnit="₺" />
                        <button type="button" onClick={() => set({ shippingRows: [] })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 0, fontFamily: 'inherit' }}>
                          Tabloyu kapat, tek tutar kullan
                        </button>
                      </>
                    )}
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, margin: '18px 0 8px' }}>Kârınız</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    {modes.map((m) => (
                      <button key={m.key} type="button" onClick={() => set({ profitMode: m.key })}
                        style={{ flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                          border: form.profitMode === m.key ? '2px solid var(--accent-primary)' : '2px solid var(--border-color)',
                          background: form.profitMode === m.key ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{m.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.hint}</div>
                      </button>
                    ))}
                  </div>
                  <div className="form-group">
                    <label className="form-label">{form.profitMode === 'fixed' ? 'Ürün başına kâr (₺) *' : 'Kâr oranı (%) *'}</label>
                    <input type="number" min="0" step="0.01" className="form-input" value={form.value} disabled={form.profitRows.length > 0} onChange={(e) => set({ value: e.target.value })} required={form.profitRows.length === 0} />
                  </div>
                  {form.profitRows.length === 0 ? (
                    <button type="button" data-testid="open-profit-tiers" onClick={() => set({ profitRows: emptyTiers() })}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: 12, padding: 0, marginBottom: 12, fontFamily: 'inherit' }}>
                      Kâr, alış fiyatına göre değişsin
                    </button>
                  ) : (
                    <div style={{ marginBottom: 12 }}>
                      <TierTable testId="profit-tiers" rows={form.profitRows} onChange={(rows) => set({ profitRows: rows })}
                        limitLabel="Alış fiyatı" valueLabel={form.profitMode === 'fixed' ? 'Kâr (₺)' : 'Kâr oranı'} valueUnit={form.profitMode === 'fixed' ? '₺' : '%'} />
                      <button type="button" onClick={() => set({ profitRows: [] })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 0, fontFamily: 'inherit' }}>
                        Tabloyu kapat, tek oran kullan
                      </button>
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label">Fiyat sonu</label>
                    <select className="form-select" value={form.rounding} onChange={(e) => set({ rounding: e.target.value })}>
                      {ROUNDINGS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </select>
                  </div>

                  {editingId && form._keep?.hadFilters && (
                    <div style={{ fontSize: 12, color: 'var(--warning)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      Bu şablonda eski bir kategori/marka filtresi vardı. Kaydedince kaldırılır ve şablon seçtiğiniz tüm ürünlere uygulanır.
                    </div>
                  )}
                </div>

                {/* ---------- earnings ---------- */}
                <div>
                  <div style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <TrendingUp size={18} style={{ color: 'var(--success)' }} />
                      <strong style={{ fontSize: 14 }}>Ne kadar kazanırsınız?</strong>
                    </div>

                    <label className="form-label">Örnek ürün — alış fiyatı (₺)</label>
                    <input type="number" min="0" step="0.01" className="form-input" value={samplePrice} onChange={(e) => setSamplePrice(e.target.value)} />

                    {rowsIncomplete && <p style={{ color: 'var(--warning)', fontSize: 12, marginTop: 10 }}>Kademe tablosunu tamamlayınca hesap buna göre güncellenir.</p>}
                    {previewError && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>{previewError}</p>}
                    {!preview && !previewError && <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 10 }}>Kâr değerini girince satış fiyatı ve kazancınız burada görünür.</p>}

                    {preview && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                          <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '10px 12px' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Satış fiyatı</div>
                            <div style={{ fontSize: 22, fontWeight: 800 }}>₺{money(preview.price)}</div>
                          </div>
                          <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '10px 12px' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Net kazancınız</div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: earnClass(preview.profit) }}>₺{money(preview.profit)}</div>
                            <div style={{ fontSize: 11, color: earnClass(preview.profit) }}>alışın %{preview.profitPct}’i · satış fiyatının %{preview.marginOnPricePct}’i</div>
                          </div>
                        </div>
                        {[
                          ['Satış fiyatı (KDV dahil)', `₺${money(preview.price)}`],
                          [`KDV (%${previewVat})`, `−₺${money(preview.vatAmount)}`],
                          ['Komisyon', `−₺${money(preview.commissionAmount)}`],
                          ['Kargo ve diğer giderler', `−₺${money(preview.fixedCosts)}`],
                          ['Alış fiyatı', `−₺${money(preview.purchase)}`],
                        ].map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{k}</span><span>{v}</span>
                          </div>
                        ))}
                        {(preview.shippingTier || preview.profitTier) && (
                          <div data-testid="tier-used" style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>
                            {preview.shippingTier ? `Uygulanan kargo: ${preview.shippingTier}. satır (₺${money(preview.shippingCost)})` : ''}
                            {preview.shippingTier && preview.profitTier ? ' · ' : ''}
                            {preview.profitTier ? `Uygulanan kâr: ${preview.profitTier}. satır` : ''}
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, padding: '8px 0 0', marginTop: 6, borderTop: '1px solid var(--border-color)' }}>
                          <span>Elinize kalan</span><span style={{ color: earnClass(preview.profit) }}>₺{money(preview.profit)}</span>
                        </div>
                      </div>
                    )}

                    {summary && (
                      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-color)', fontSize: 13 }}>
                        {summary.covered === 0 ? (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {summary.total === 0 ? 'Henüz ürününüz yok; ürün ekleyince toplam kazanç burada görünür.' : 'Bu ayarlarla eşleşen ürün yok.'}
                          </span>
                        ) : (
                          <>
                            <div style={{ color: 'var(--text-secondary)' }}>Ürünlerinizden <strong>{summary.covered}</strong> / {summary.total} tanesine uygulanır. Hepsi satılırsa:</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: earnClass(summary.totalProfit), margin: '4px 0' }}>₺{money(summary.totalProfit)} toplam kazanç</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              Ürün başına ortalama ₺{money(summary.avgProfit)} (en az ₺{money(summary.minProfit)}, en çok ₺{money(summary.maxProfit)}) · ortalama satış fiyatı ₺{money(summary.avgPrice)}
                            </div>
                            {summary.losing > 0 && (
                              <div style={{ marginTop: 8, color: 'var(--danger)', display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12 }}>
                                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                {summary.losing} üründe zarar edersiniz (giderler kârı aşıyor).
                              </div>
                            )}
                            {summary.unpriced > 0 && (
                              <div style={{ marginTop: 6, color: 'var(--warning)', fontSize: 12 }}>{summary.unpriced} ürün için fiyat hesaplanamadı (komisyon çok yüksek olabilir).</div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 0' }}>
                      Satış KDV’si ürünün XML kaynağındaki orandan alınır; komisyon KDV dahil satış fiyatı üzerinden hesaplanır. Rakamlar tahmindir (iade, indirim ve kampanyalar dahil değil).
                    </p>
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
