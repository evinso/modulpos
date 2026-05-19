import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Tags, ToggleLeft, ToggleRight, Calculator, TrendingUp, Package, Percent, Truck, Save, Edit2 } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const EMPTY_FORM = {
  name: '', value: '',
  ruleMode: 'price_range',
  minPurchasePrice: '', maxPurchasePrice: '',
  shippingCost: '', commissionPct: '', vatRate: '0',
  type: 'percentage', connectionId: '', xmlSourceId: ''
};

function PriceCalculator({ onSaveAsRule }) {
  const [calc, setCalc] = useState({
    purchasePrice: '', marginPct: '', shippingCost: '', commissionPct: '', vatRate: '0',
  });

  const result = useMemo(() => {
    const purchase = parseFloat(calc.purchasePrice) || 0;
    const margin   = parseFloat(calc.marginPct) || 0;
    const shipping = parseFloat(calc.shippingCost) || 0;
    const comm     = parseFloat(calc.commissionPct) || 0;
    const vat      = parseFloat(calc.vatRate) || 0;
    if (purchase <= 0) return null;
    const totalCost  = purchase + shipping;
    const profit     = purchase * (margin / 100);
    const factor     = comm > 0 ? 1 - comm / 100 : 1;
    const priceNoVat = factor > 0 ? (totalCost + profit) / factor : totalCost + profit;
    const selling    = priceNoVat * (1 + vat / 100);
    const commAmt    = selling * (comm / 100);
    const vatAmt     = priceNoVat * (vat / 100);
    const netProfit  = selling - commAmt - vatAmt - totalCost;
    const netPct     = (netProfit / purchase) * 100;
    const breakEven  = factor > 0 ? totalCost / factor * (1 + vat / 100) : totalCost * (1 + vat / 100);
    return { selling, commAmt, vatAmt, netProfit, netPct, totalCost, breakEven };
  }, [calc]);

  const fmt = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const inp = {
    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
    borderRadius: 8, padding: '10px 12px', fontSize: 14,
    color: 'var(--text-primary)', width: '100%', outline: 'none',
  };
  const lbl = { fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 6, display: 'block' };

  return (
    <div className="card" style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Calculator size={20} style={{ color: 'var(--accent-primary)' }} />
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Kâr Marjı Hesaplayıcı</h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>Hesapladıktan sonra kural olarak kaydedebilirsiniz</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lbl}><Package size={13} style={{ display: 'inline', marginRight: 5 }} />Alış Fiyatı (₺)</label>
            <input type="number" min="0" step="0.01" style={inp} placeholder="Örn: 50"
              value={calc.purchasePrice} onChange={e => setCalc({ ...calc, purchasePrice: e.target.value })} />
          </div>
          <div>
            <label style={lbl}><TrendingUp size={13} style={{ display: 'inline', marginRight: 5 }} />Hedef Kâr Marjı (%)</label>
            <input type="number" min="0" step="0.1" style={inp} placeholder="Örn: 30"
              value={calc.marginPct} onChange={e => setCalc({ ...calc, marginPct: e.target.value })} />
          </div>
          <div>
            <label style={lbl}><Truck size={13} style={{ display: 'inline', marginRight: 5 }} />Kargo Ücreti (₺)</label>
            <input type="number" min="0" step="0.01" style={inp} placeholder="Örn: 25"
              value={calc.shippingCost} onChange={e => setCalc({ ...calc, shippingCost: e.target.value })} />
          </div>
          <div>
            <label style={lbl}><Percent size={13} style={{ display: 'inline', marginRight: 5 }} />Komisyon Oranı (%)</label>
            <input type="number" min="0" max="100" step="0.1" style={inp} placeholder="Örn: 12"
              value={calc.commissionPct} onChange={e => setCalc({ ...calc, commissionPct: e.target.value })} />
          </div>
          <div>
            <label style={lbl}>KDV Oranı (%)</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={calc.vatRate}
              onChange={e => setCalc({ ...calc, vatRate: e.target.value })}>
              <option value="0">%0 — KDV Yok</option>
              <option value="1">%1</option>
              <option value="10">%10</option>
              <option value="20">%20</option>
            </select>
          </div>
        </div>

        <div>
          {!result ? (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--bg-secondary)', borderRadius: 12, flexDirection: 'column', gap: 10,
              color: 'var(--text-muted)', fontSize: 13, minHeight: 200
            }}>
              <Calculator size={32} style={{ opacity: 0.4 }} />
              Alış fiyatı girerek hesaplamayı başlatın
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(99,102,241,0.06))',
                border: '1px solid rgba(99,102,241,0.25)', borderRadius: 12, padding: '16px 20px',
              }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Önerilen Satış Fiyatı</p>
                <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-primary)' }}>₺{fmt(result.selling)}</p>
              </div>

              <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                {[
                  { label: 'Toplam Maliyet (Alış + Kargo)', value: `₺${fmt(result.totalCost)}`, color: 'var(--text-primary)' },
                  { label: 'Komisyon Tutarı', value: `-₺${fmt(result.commAmt)}`, color: 'var(--danger)' },
                  ...(parseFloat(calc.vatRate) > 0 ? [{ label: `KDV (%${calc.vatRate})`, value: `-₺${fmt(result.vatAmt)}`, color: 'var(--warning)' }] : []),
                  { label: 'Net Kâr', value: `₺${fmt(result.netProfit)}`, color: result.netProfit >= 0 ? 'var(--success)' : 'var(--danger)' },
                  { label: 'Kâr Oranı', value: `%${result.netPct.toFixed(1)}`, color: result.netPct >= 0 ? 'var(--success)' : 'var(--danger)', bold: true },
                ].map(({ label, value, color, bold }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                    <span style={{ color, fontWeight: bold ? 700 : 600 }}>{value}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Başabaş Noktası (Karsız Minimum)</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>₺{fmt(result.breakEven)}</span>
              </div>

              <button className="btn btn-secondary" style={{ fontSize: 13, marginTop: 2 }}
                onClick={() => onSaveAsRule(calc)}>
                <Save size={14} /> Bu Hesaplamayı Kural Olarak Kaydet
              </button>
            </div>
          )}
        </div>
      </div>
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

  useEffect(() => { fetchRules(); fetchOptions(); }, []);

  const fetchOptions = async () => {
    try {
      const [xmlRes, connRes] = await Promise.all([
        api.get('/xml-sources'),
        api.get('/marketplace/connections')
      ]);
      setXmlSources(xmlRes.data);
      setConnections(connRes.data);
    } catch {}
  };

  const fetchRules = async () => {
    try {
      const res = await api.get('/pricing');
      setRules(res.data);
    } catch { toast.error('Kurallar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const openModal = (prefill = null) => {
    if (prefill && prefill.id) {
      // Editing existing rule — prefill is a rule object from the API
      const conds = prefill.conditions ? JSON.parse(prefill.conditions) : {};
      const isRange = prefill.applyTo === 'price_range';
      setEditingId(prefill.id);
      setForm({
        ...EMPTY_FORM,
        ruleMode: isRange ? 'price_range' : 'standard',
        name: prefill.name || '',
        value: prefill.value ?? '',
        type: prefill.type || 'percentage',
        connectionId: conds.connectionId || '',
        xmlSourceId: conds.xmlSourceId || '',
        minPurchasePrice: conds.minPurchasePrice ?? '',
        maxPurchasePrice: conds.maxPurchasePrice ?? '',
        shippingCost: conds.shippingCost ?? '',
        commissionPct: conds.commissionPct ?? '',
        vatRate: String(conds.vatRate ?? '0'),
      });
    } else if (prefill) {
      // Pre-fill from calculator result
      setEditingId(null);
      setForm({
        ...EMPTY_FORM,
        ruleMode: 'price_range',
        value: prefill.marginPct || '',
        shippingCost: prefill.shippingCost || '',
        commissionPct: prefill.commissionPct || '',
        vatRate: prefill.vatRate || '0',
        name: prefill.marginPct ? `%${prefill.marginPct} Kâr Marjı Kuralı` : '',
      });
    } else {
      setEditingId(null);
      setForm({ ...EMPTY_FORM });
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      let conditions, applyTo;
      if (form.ruleMode === 'price_range') {
        conditions = {
          minPurchasePrice: form.minPurchasePrice !== '' ? parseFloat(form.minPurchasePrice) : null,
          maxPurchasePrice: form.maxPurchasePrice !== '' ? parseFloat(form.maxPurchasePrice) : null,
          shippingCost: parseFloat(form.shippingCost) || 0,
          commissionPct: parseFloat(form.commissionPct) || 0,
          vatRate: parseFloat(form.vatRate) || 0,
          connectionId: form.connectionId || null,
          xmlSourceId: form.xmlSourceId || null,
        };
        applyTo = 'price_range';
      } else {
        conditions = { connectionId: form.connectionId, xmlSourceId: form.xmlSourceId };
        applyTo = 'marketplace_xml';
      }
      const payload = { name: form.name, type: form.type || 'percentage', value: parseFloat(form.value), applyTo, conditions };
      if (editingId) {
        await api.put(`/pricing/${editingId}`, payload);
        toast.success('Kural güncellendi');
      } else {
        await api.post('/pricing', payload);
        toast.success('Fiyatlandırma kuralı eklendi');
      }
      closeModal();
      fetchRules();
    } catch (err) { toast.error(err.response?.data?.error || 'Hata'); }
  };

  const toggleActive = async (id, currentState) => {
    try {
      await api.put(`/pricing/${id}`, { isActive: !currentState });
      fetchRules();
    } catch { toast.error('Güncelleme hatası'); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const id = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await api.delete(`/pricing/${id}`);
      toast.success('Kural silindi');
      fetchRules();
    } catch { toast.error('Silme hatası'); }
  };

  const renderConditionCell = (r) => {
    try {
      const conds = r.conditions ? JSON.parse(r.conditions) : null;
      if (conds && (conds.minPurchasePrice != null || conds.maxPurchasePrice != null)) {
        const min = conds.minPurchasePrice != null ? `₺${conds.minPurchasePrice}` : '—';
        const max = conds.maxPurchasePrice != null ? `₺${conds.maxPurchasePrice}` : '—';
        const conn = conds.connectionId ? connections.find(x => x.id === conds.connectionId) : null;
        const src  = conds.xmlSourceId  ? xmlSources.find(x => x.id === conds.xmlSourceId)  : null;
        return (
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            <div><strong>XML Fiyat Aralığı:</strong> {min} — {max}</div>
            {conn && <div><strong>Pazaryeri:</strong> {conn.supplierName || conn.marketplaceType}</div>}
            {src  && <div><strong>Kaynak:</strong> {src.name}</div>}
            {conds.shippingCost > 0 && <div><strong>Kargo:</strong> ₺{conds.shippingCost}</div>}
            {conds.commissionPct > 0 && <div><strong>Komisyon:</strong> %{conds.commissionPct}</div>}
            {conds.vatRate > 0 && <div><strong>KDV:</strong> %{conds.vatRate}</div>}
          </div>
        );
      }
      if (conds && conds.connectionId && conds.xmlSourceId) {
        const c = connections.find(x => x.id === conds.connectionId);
        const x = xmlSources.find(x => x.id === conds.xmlSourceId);
        return (
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            <div><strong>Pazaryeri:</strong> {c?.supplierName || c?.marketplaceType || conds.connectionId}</div>
            <div><strong>Kaynak:</strong> {x?.name || conds.xmlSourceId}</div>
          </div>
        );
      }
    } catch {}
    return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Tüm Ürünler</span>;
  };

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>Fiyatlandırma Kuralları</h1><p>Kâr marjı ve fiyatlandırma kurallarınızı yönetin</p></div>
        <button className="btn btn-primary" onClick={() => openModal()}><Plus size={16} /> Kural Ekle</button>
      </div>

      <PriceCalculator onSaveAsRule={openModal} />

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : rules.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Tags size={48} className="empty-icon" />
            <h3>Henüz fiyatlandırma kuralı yok</h3>
            <p>Hesaplayıcıdan "Kural Olarak Kaydet" butonuna tıklayarak veya manuel olarak kural ekleyin</p>
            <button className="btn btn-primary" onClick={() => openModal()}><Plus size={16} /> İlk Kuralı Ekle</button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Kural Adı</th>
                <th>Kâr Marjı</th>
                <th>Koşullar</th>
                <th>Durum</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>
                    {r.name}
                    {r.applyTo === 'price_range' && (
                      <span className="badge badge-primary" style={{ marginLeft: 8, fontSize: 10, verticalAlign: 'middle' }}>Fiyat Aralığı</span>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>%{r.value}</td>
                  <td>{renderConditionCell(r)}</td>
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

      {/* ADD RULE MODAL */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3>{editingId ? 'Kuralı Düzenle' : 'Fiyatlandırma Kuralı Ekle'}</h3>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">

                {/* Rule mode toggle */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                  {[
                    { key: 'price_range', label: '📊 Fiyat Aralığı Kuralı' },
                    { key: 'standard',    label: '🔗 Bağlantı Bazlı Kural' },
                  ].map(({ key, label }) => (
                    <button key={key} type="button"
                      onClick={() => setForm({ ...form, ruleMode: key })}
                      style={{
                        flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                        border: form.ruleMode === key ? '2px solid var(--accent-primary)' : '2px solid var(--border-color)',
                        background: form.ruleMode === key ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)',
                        color: form.ruleMode === key ? 'var(--accent-primary)' : 'var(--text-secondary)',
                        fontWeight: 600,
                      }}>
                      {label}
                    </button>
                  ))}
                </div>

                <div className="form-group">
                  <label className="form-label">Kural Adı *</label>
                  <input className="form-input" placeholder="ör: 1–100₺ Arası %30 Marj"
                    value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                </div>

                {form.ruleMode === 'price_range' ? (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>
                        Alış Fiyatı Aralığı (₺)
                      </label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="number" min="0" step="0.01" className="form-input"
                          placeholder="Min (örn: 1)"
                          value={form.minPurchasePrice}
                          onChange={e => setForm({ ...form, minPurchasePrice: e.target.value })}
                          style={{ flex: 1 }} />
                        <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: 13 }}>ile</span>
                        <input type="number" min="0" step="0.01" className="form-input"
                          placeholder="Max (örn: 100)"
                          value={form.maxPurchasePrice}
                          onChange={e => setForm({ ...form, maxPurchasePrice: e.target.value })}
                          style={{ flex: 1 }} />
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
                        Boş bırakırsanız o taraf sınırsız olur. XML Fiyat alanına göre eşleştirilir.
                      </p>
                    </div>

                    <div className="grid grid-2">
                      <div className="form-group">
                        <label className="form-label">Pazaryeri Bağlantısı</label>
                        <select className="form-select" value={form.connectionId}
                          onChange={e => setForm({ ...form, connectionId: e.target.value })}>
                          <option value="">Tümü (Bağlantıdan Bağımsız)</option>
                          {connections.map(c => (
                            <option key={c.id} value={c.id}>{c.supplierName || c.marketplaceType} ({c.marketplaceType})</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">XML Kaynağı</label>
                        <select className="form-select" value={form.xmlSourceId}
                          onChange={e => setForm({ ...form, xmlSourceId: e.target.value })}>
                          <option value="">Tümü (Kaynaktan Bağımsız)</option>
                          {xmlSources.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-2">
                      <div className="form-group">
                        <label className="form-label">Kâr Marjı (%) *</label>
                        <input type="number" min="0" step="0.1" className="form-input" placeholder="Örn: 30"
                          value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Kargo Ücreti (₺)</label>
                        <input type="number" min="0" step="0.01" className="form-input" placeholder="Örn: 25"
                          value={form.shippingCost} onChange={e => setForm({ ...form, shippingCost: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Komisyon Oranı (%)</label>
                        <input type="number" min="0" max="100" step="0.1" className="form-input" placeholder="Örn: 12"
                          value={form.commissionPct} onChange={e => setForm({ ...form, commissionPct: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">KDV Oranı (%)</label>
                        <select className="form-select" value={form.vatRate}
                          onChange={e => setForm({ ...form, vatRate: e.target.value })}>
                          <option value="0">%0 — KDV Yok</option>
                          <option value="1">%1</option>
                          <option value="10">%10</option>
                          <option value="20">%20</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-2">
                      <div className="form-group">
                        <label className="form-label">Tür</label>
                        <select className="form-select" value={form.type}
                          onChange={e => setForm({ ...form, type: e.target.value })}>
                          <option value="percentage">Yüzde (%)</option>
                          <option value="fixed">Sabit Tutar (₺)</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Değer *</label>
                        <input type="number" className="form-input"
                          placeholder={form.type === 'percentage' ? '20' : '50'}
                          value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} required />
                      </div>
                    </div>
                    <div className="grid grid-2">
                      <div className="form-group">
                        <label className="form-label">Pazaryeri Bağlantısı *</label>
                        <select className="form-select" value={form.connectionId}
                          onChange={e => setForm({ ...form, connectionId: e.target.value })} required>
                          <option value="">Seçiniz...</option>
                          {connections.map(c => (
                            <option key={c.id} value={c.id}>{c.supplierName || c.marketplaceType} ({c.marketplaceType})</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">XML Kaynağı *</label>
                        <select className="form-select" value={form.xmlSourceId}
                          onChange={e => setForm({ ...form, xmlSourceId: e.target.value })} required>
                          <option value="">Seçiniz...</option>
                          {xmlSources.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>İptal</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Güncelle' : 'Kaydet'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>Kuralı Sil</h3>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Bu fiyatlandırma kuralını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</p>
            </div>
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
