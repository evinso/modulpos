import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Tags, ToggleLeft, ToggleRight, Edit2, AlertTriangle } from 'lucide-react';
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

import CoveragePanel from './CoveragePanel';
import { TabStrip, Explain, Example, OptionCard, Cards, ROUNDING_HELP } from './FormTabs';
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
  const [samplePrice, setSamplePrice] = useState('');
  const [tab, setTab] = useState('general');
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
      if (purchase && purchase > 0 && form.value !== '') {
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
    if (rule) {
      setEditingId(rule.id); setForm(ruleToForm(rule));
    } else { setEditingId(null); setForm({ ...EMPTY_FORM }); }
    setTab('general');
    setPreview(null); setSummary(null); setPreviewError('');
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingId(null); setForm({ ...EMPTY_FORM }); };

  const handleSave = async (e) => {
    e.preventDefault();
    const shipInc = rowsToTiers(form.shippingRows, 'cost').incomplete, profInc = rowsToTiers(form.profitRows, 'value').incomplete;
    if (!form.name.trim()) { setTab('general'); return toast.error('Şablon adını yazın (Genel menüsü)'); }
    if (shipInc) { setTab('costs'); return toast.error('Kargo tablosundaki tüm alanları doldurun ya da "Her ürün için aynı tutar"ı seçin'); }
    if (profInc) { setTab('profit'); return toast.error('Kâr tablosundaki tüm alanları doldurun ya da başka bir kâr yöntemi seçin'); }
    if (form.value === '' && !profitTiersOn) { setTab('profit'); return toast.error('Kâr değerini girin (Kâr menüsü)'); }
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

  const sum = (id) => ruleSummaries?.rules?.[id];
  const shipIncomplete = rowsToTiers(form.shippingRows, 'cost').incomplete;
  const profitMissing = rowsToTiers(form.profitRows, 'value').incomplete || (form.profitRows.length === 0 && form.value === '');

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
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Kâr {profitLabel(r)} · giderler {renderCosts(r)}</div>
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
                      <button className="btn btn-secondary btn-sm" onClick={() => openModal(r)}><Edit2 size={14} /></button>
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
                {/* ---------- form: one menu per topic, each shows only what its chosen method needs ---------- */}
                <div>
                  <TabStrip active={tab} onChange={setTab} flags={{ costs: shipIncomplete, profit: profitMissing }}
                    tabs={[{ key: 'general', label: 'Genel' }, { key: 'costs', label: 'Giderler' }, { key: 'profit', label: 'Kâr' }, { key: 'rounding', label: 'Fiyat sonu' }]} />

                  {tab === 'general' && (
                    <div data-testid="pane-general">
                      <Explain title="Bu şablon ne işe yarar?">
                        Şablon, XML’den gelen <strong>alış fiyatını</strong> alır; kargo, komisyon, KDV ve kârınızı karşılayacak <strong>satış fiyatını</strong> hesaplar.
                        Bu menüde şablonun hangi ürünlere uygulanacağını seçersiniz. Hiçbir şey seçmezseniz tüm ürünlerinize uygulanır.
                        Sağ taraf, seçimlerinizin tüm ürünlerinizde ne kazandıracağını anında gösterir.
                      </Explain>
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
                      <Example>Her pazaryeri için ayrı fiyat istiyorsanız (komisyonlar farklıdır) her pazaryerine ayrı şablon oluşturun.</Example>
                      <div className="form-group">
                        <label className="form-label">Yalnızca şu alış fiyatındaki ürünlere uygula (₺) <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— boşsa hepsi</span></label>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input type="number" min="0" step="0.01" className="form-input" placeholder="en az" value={form.minPurchasePrice} onChange={(e) => set({ minPurchasePrice: e.target.value })} />
                          <span style={{ color: 'var(--text-muted)' }}>–</span>
                          <input type="number" min="0" step="0.01" className="form-input" placeholder="en çok" value={form.maxPurchasePrice} onChange={(e) => set({ maxPurchasePrice: e.target.value })} />
                        </div>
                      </div>
                      <Example>
                        Örnek: 0–100 ₺ arası ürünler için bir şablon, 100 ₺ üstü için başka bir şablon yapabilirsiniz. Aralıkları çakıştırmamaya özen gösterin;
                        bir ürüne birden fazla şablon uyarsa önce daha dar kapsamlı (pazaryeri/XML seçilmiş), eşitse daha önce oluşturulan şablon kullanılır.
                        Her ürünü tek şablon karşılıyorsa bu alanı boş bırakın. Kâr oranını fiyata göre değiştirmek için <em>Kâr</em> menüsündeki kademeli seçeneği kullanmak daha kolaydır.
                      </Example>
                    </div>
                  )}

                  {tab === 'costs' && (
                    <div data-testid="pane-costs">
                      <Explain title="Giderler nedir?">
                        Satış fiyatı, ürünün size maliyeti ile kârınızın üstüne bu giderleri ekleyerek bulunur. Tutarları faturada ödediğiniz gibi (KDV dahil) yazın.
                        <strong> Komisyon</strong> pazaryerinin satıştan kestiği yüzdedir ve KDV dahil satış fiyatı üzerinden alınır. Satış KDV’sini ayrıca girmeniz gerekmez;
                        ürünün XML kaynağını eklerken seçtiğiniz KDV oranı kullanılır.
                      </Explain>

                      <div style={{ fontWeight: 700, fontSize: 13, margin: '0 0 6px' }}>Kargo ücreti nasıl hesaplansın?</div>
                      <Cards>
                        <OptionCard testId="ship-single" active={form.shippingRows.length === 0} title="Her ürün için aynı tutar"
                          desc="Kargo ücretiniz satış fiyatına göre değişmiyorsa bunu seçin."
                          onClick={() => set({ shippingRows: [] })} />
                        <OptionCard testId="ship-tiers" active={form.shippingRows.length > 0} title="Satış fiyatına göre değişsin (barem)"
                          desc="Pazaryeri kargoyu sipariş tutarına göre basamaklandırıyorsa (ör. Trendyol) bunu seçin."
                          onClick={() => form.shippingRows.length === 0 && set({ shippingRows: emptyTiers() })} />
                      </Cards>

                      {form.shippingRows.length === 0 ? (
                        <div className="form-group">
                          <label className="form-label">Kargo ücreti (₺)</label>
                          <input type="number" min="0" step="0.01" className="form-input" value={form.shippingCost} onChange={(e) => set({ shippingCost: e.target.value })} />
                          <Example>Örnek: her pakete 60 ₺ kargo ödüyorsanız 60 yazın.</Example>
                        </div>
                      ) : (
                        <>
                          <Explain title="Barem (kademeli kargo) nasıl çalışır?">
                            Pazaryerleri kargo ücretini siparişin tutarına göre sabitler: tutar düşükse ücret düşük, tutar belirli bir sınırı aşınca bir üst basamağa geçer.
                            Satış fiyatını bulmak için kargo ücretini bilmek gerekir, kargo ücretini bilmek için de satış fiyatı gerekir. Sistem bunu sizin yerinize çözer:
                            satırları sırayla dener ve ürünün satış fiyatının gerçekten uyduğu satırı seçer. Böylece “düşük kargo varsaydım, fiyat yükselince zarar ettim” durumu olmaz.
                            <br /><strong>Nasıl doldurulur:</strong> her satıra satış fiyatının üst sınırını ve o aralıktaki kargo ücretinizi yazın. Son satır “üstü”dür, sınır yazılmaz.
                            Rakamları satıcı panelinizden ya da kargo sözleşmenizden alın; sistem hazır tarife içermez çünkü sözleşmeler ve fiyatlar değişir.
                          </Explain>
                          <Example>Örnek tablo (rakamlar yalnızca örnektir): 200 ₺’ye kadar → 46 ₺ · 350 ₺’ye kadar → 84 ₺ · üstü → 190 ₺. Satış fiyatı 314 ₺ çıkan ürün için 2. satır (84 ₺) kullanılır.</Example>
                          <TierTable testId="shipping-tiers" rows={form.shippingRows} onChange={(rows) => set({ shippingRows: rows })}
                            limitLabel="Satış fiyatı (KDV dahil)" valueLabel="Kargo ücretim" valueUnit="₺" />
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>En fazla 3 satır. Sınırlar küçükten büyüğe gitmeli. Tüm alanlar dolu olmalı.</div>
                        </>
                      )}

                      <div className="grid grid-2" style={{ marginTop: 10 }}>
                        <div className="form-group"><label className="form-label">Paketleme / diğer gider (₺)</label>
                          <input type="number" min="0" step="0.01" className="form-input" value={form.otherCost} onChange={(e) => set({ otherCost: e.target.value })} />
                          <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Koli, bant, etiket gibi ürün başına giderler.</small></div>
                        <div className="form-group"><label className="form-label">Komisyon (%)</label>
                          <input type="number" min="0" max="90" step="0.1" className="form-input" value={form.commissionPct} onChange={(e) => set({ commissionPct: e.target.value })} />
                          <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Pazaryerinin kategoriye göre kestiği oran.</small></div>
                      </div>
                    </div>
                  )}

                  {tab === 'profit' && (
                    <div data-testid="pane-profit">
                      <Explain title="Kâr nedir?">
                        Burada yazdığınız kâr <strong>net kârdır</strong>: kargo, paketleme, komisyon ve KDV düşüldükten sonra cebinizde kalan tutar.
                        Sistem satış fiyatını bu kârı garanti edecek şekilde hesaplar. Aşağıdan kârı nasıl belirleyeceğinizi seçin.
                      </Explain>
                      <Cards>
                        <OptionCard testId="profit-percent" active={form.profitRows.length === 0 && form.profitMode === 'percent_of_purchase'} title="Yüzde kâr"
                          desc="Alış fiyatınızın belli bir yüzdesi kadar kazanın. Her ürün için aynı oran."
                          onClick={() => set({ profitRows: [], profitMode: 'percent_of_purchase' })} />
                        <OptionCard testId="profit-fixed" active={form.profitRows.length === 0 && form.profitMode === 'fixed'} title="Sabit TL kâr"
                          desc="Her üründe aynı tutarı kazanın, ürün ucuz da olsa pahalı da olsa."
                          onClick={() => set({ profitRows: [], profitMode: 'fixed' })} />
                        <OptionCard testId="profit-tiered" active={form.profitRows.length > 0} title="Alış fiyatına göre kademeli"
                          desc="Ucuz ürünlerde yüksek, pahalı ürünlerde düşük oran gibi fiyata göre farklı kâr belirleyin."
                          onClick={() => form.profitRows.length === 0 && set({ profitRows: emptyTiers(), profitMode: form.profitMode === 'fixed' ? 'fixed' : 'percent_of_purchase' })} />
                        {form.profitRows.length === 0 && form.profitMode !== 'percent_of_purchase' && form.profitMode !== 'fixed' && (
                          <OptionCard active title={MODE_LABELS[form.profitMode] || form.profitMode} desc="Eski şablondan geldi. Yukarıdaki seçeneklerden birini seçerseniz değişir." onClick={() => {}} />
                        )}
                      </Cards>

                      {form.profitRows.length === 0 && form.profitMode === 'percent_of_purchase' && (
                        <div className="form-group">
                          <label className="form-label">Kâr oranı (%) *</label>
                          <input type="number" min="0" step="0.01" className="form-input" value={form.value} onChange={(e) => set({ value: e.target.value })} required />
                          <Example>Örnek: alış fiyatı 100 ₺, oran %30 → giderler ve komisyon karşılandıktan sonra elinizde 30 ₺ kalır. Satış fiyatı bunu sağlayacak şekilde hesaplanır.</Example>
                        </div>
                      )}
                      {form.profitRows.length === 0 && form.profitMode === 'fixed' && (
                        <div className="form-group">
                          <label className="form-label">Ürün başına kâr (₺) *</label>
                          <input type="number" min="0" step="0.01" className="form-input" value={form.value} onChange={(e) => set({ value: e.target.value })} required />
                          <Example>Örnek: 25 yazarsanız 40 ₺’lik ürün de 400 ₺’lik ürün de size net 25 ₺ bırakır.</Example>
                        </div>
                      )}
                      {form.profitRows.length > 0 && (
                        <>
                          <Explain title="Kademeli kâr nasıl çalışır?">
                            Ürünün <strong>alış fiyatına</strong> uyan satır seçilir ve o satırdaki kâr uygulanır. Her satıra alış fiyatının üst sınırını ve o aralıktaki kârı yazın;
                            son satır “üstü”dür. Çok ürünlü XML’lerde ucuz ürünlerde kargo ve komisyon payı büyük olduğu için orayı yüksek, pahalı ürünleri daha düşük tutmak yaygın bir yöntemdir.
                            <br />Kârı yüzde mi sabit TL mi olarak yazacağınızı aşağıdan seçin.
                          </Explain>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                            {[['percent_of_purchase', 'Yüzde (%)'], ['fixed', 'Sabit TL (₺)']].map(([k, l]) => (
                              <button key={k} type="button" data-testid={`unit-${k}`} onClick={() => set({ profitMode: k })}
                                style={{ flex: 1, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-primary)',
                                  border: form.profitMode === k ? '2px solid var(--accent-primary)' : '2px solid var(--border-color)',
                                  background: form.profitMode === k ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)' }}>{l}</button>
                            ))}
                          </div>
                          <Example>Örnek tablo: 100 ₺’ye kadar → %40 · 300 ₺’ye kadar → %30 · üstü → %20. Alışı 80 ₺ olan ürün 1. satırdan %40 kâr (32 ₺) bırakır.</Example>
                          <TierTable testId="profit-tiers" rows={form.profitRows} onChange={(rows) => set({ profitRows: rows })}
                            limitLabel="Alış fiyatı" valueLabel={form.profitMode === 'fixed' ? 'Kâr (₺)' : 'Kâr oranı'} valueUnit={form.profitMode === 'fixed' ? '₺' : '%'} />
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>En fazla 3 satır. Sınırlar küçükten büyüğe gitmeli. Tüm alanlar dolu olmalı.</div>
                        </>
                      )}
                    </div>
                  )}

                  {tab === 'rounding' && (
                    <div data-testid="pane-rounding">
                      <Explain title="Fiyat sonu nedir?">
                        Hesaplanan satış fiyatı 129,37 ₺ gibi düzensiz çıkabilir. Pazaryerinde daha düzgün görünmesi için fiyatın sonunu belirleyebilirsiniz.
                        Yuvarlama her zaman <strong>yukarı</strong> doğrudur, yani fiyat hiçbir zaman hesaplanandan düşük olmaz ve kârınız azalmaz.
                      </Explain>
                      <Cards>
                        {ROUNDINGS.map((r) => (
                          <OptionCard key={r.key} testId={`round-${r.key}`} active={form.rounding === r.key} title={r.label} desc={ROUNDING_HELP[r.key]} onClick={() => set({ rounding: r.key })} />
                        ))}
                      </Cards>
                    </div>
                  )}

                  {editingId && form._keep?.hadFilters && (
                    <div style={{ fontSize: 12, color: 'var(--warning)', display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 10 }}>
                      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      Bu şablonda eski bir kategori/marka filtresi vardı. Kaydedince kaldırılır ve şablon seçtiğiniz tüm ürünlere uygulanır.
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
