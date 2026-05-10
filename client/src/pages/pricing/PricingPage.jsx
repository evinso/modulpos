import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Tags, ToggleLeft, ToggleRight, Calculator, TrendingUp, Package, Percent, Truck } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

function PriceCalculator() {
  const [calc, setCalc] = useState({
    purchasePrice: '',
    marginPct: '',
    shippingCost: '',
    commissionPct: '',
    vatRate: '0',
  });

  const result = useMemo(() => {
    const purchase = parseFloat(calc.purchasePrice) || 0;
    const margin = parseFloat(calc.marginPct) || 0;
    const shipping = parseFloat(calc.shippingCost) || 0;
    const commission = parseFloat(calc.commissionPct) || 0;
    const vat = parseFloat(calc.vatRate) || 0;

    if (purchase <= 0) return null;

    const totalCost = purchase + shipping;
    const targetProfit = purchase * (margin / 100);
    const commissionFactor = 1 - commission / 100;
    const sellingPriceBeforeVat = commissionFactor > 0
      ? (totalCost + targetProfit) / commissionFactor
      : totalCost + targetProfit;
    const sellingPrice = sellingPriceBeforeVat * (1 + vat / 100);
    const commissionAmount = sellingPrice * (commission / 100);
    const vatAmount = sellingPriceBeforeVat * (vat / 100);
    const netProfit = sellingPrice - commissionAmount - vatAmount - totalCost;
    const netMarginPct = purchase > 0 ? (netProfit / purchase) * 100 : 0;
    const breakEven = commissionFactor > 0 ? totalCost / commissionFactor * (1 + vat / 100) : totalCost * (1 + vat / 100);

    return { sellingPrice, commissionAmount, vatAmount, netProfit, netMarginPct, totalCost, breakEven };
  }, [calc]);

  const fmt = (n) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const inputStyle = {
    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
    borderRadius: 8, padding: '10px 12px', fontSize: 14,
    color: 'var(--text-primary)', width: '100%', outline: 'none',
  };
  const labelStyle = { fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 6, display: 'block' };

  return (
    <div className="card" style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Calculator size={20} style={{ color: 'var(--accent-primary)' }} />
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Kâr Marjı Hesaplayıcı</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}><Package size={13} style={{ display: 'inline', marginRight: 5 }} />Alış Fiyatı (₺)</label>
            <input type="number" min="0" step="0.01" style={inputStyle} placeholder="Örn: 50"
              value={calc.purchasePrice} onChange={e => setCalc({ ...calc, purchasePrice: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}><TrendingUp size={13} style={{ display: 'inline', marginRight: 5 }} />Hedef Kâr Marjı (%)</label>
            <input type="number" min="0" step="0.1" style={inputStyle} placeholder="Örn: 30"
              value={calc.marginPct} onChange={e => setCalc({ ...calc, marginPct: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}><Truck size={13} style={{ display: 'inline', marginRight: 5 }} />Kargo Ücreti (₺)</label>
            <input type="number" min="0" step="0.01" style={inputStyle} placeholder="Örn: 25"
              value={calc.shippingCost} onChange={e => setCalc({ ...calc, shippingCost: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}><Percent size={13} style={{ display: 'inline', marginRight: 5 }} />Komisyon Oranı (%) </label>
            <input type="number" min="0" max="100" step="0.1" style={inputStyle} placeholder="Örn: 12"
              value={calc.commissionPct} onChange={e => setCalc({ ...calc, commissionPct: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>KDV Oranı (%)</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={calc.vatRate}
              onChange={e => setCalc({ ...calc, vatRate: e.target.value })}>
              <option value="0">%0 — KDV Yok</option>
              <option value="1">%1</option>
              <option value="10">%10</option>
              <option value="20">%20</option>
            </select>
          </div>
        </div>

        {/* Results */}
        <div>
          {!result ? (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--bg-secondary)', borderRadius: 12, flexDirection: 'column', gap: 10,
              color: 'var(--text-muted)', fontSize: 13
            }}>
              <Calculator size={32} style={{ opacity: 0.4 }} />
              Alış fiyatı girerek hesaplamayı başlatın
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Main selling price */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(99,102,241,0.06))',
                border: '1px solid rgba(99,102,241,0.25)', borderRadius: 12, padding: '16px 20px',
              }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Önerilen Satış Fiyatı</p>
                <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-primary)' }}>₺{fmt(result.sellingPrice)}</p>
              </div>

              {/* Breakdown */}
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                {[
                  { label: 'Toplam Maliyet (Alış + Kargo)', value: `₺${fmt(result.totalCost)}`, color: 'var(--text-primary)' },
                  { label: 'Komisyon Tutarı', value: `-₺${fmt(result.commissionAmount)}`, color: 'var(--danger)' },
                  ...(parseFloat(calc.vatRate) > 0 ? [{ label: `KDV (%${calc.vatRate})`, value: `-₺${fmt(result.vatAmount)}`, color: 'var(--warning)' }] : []),
                  { label: 'Net Kâr', value: `₺${fmt(result.netProfit)}`, color: result.netProfit >= 0 ? 'var(--success)' : 'var(--danger)' },
                  { label: 'Kâr Oranı', value: `%${result.netMarginPct.toFixed(1)}`, color: result.netMarginPct >= 0 ? 'var(--success)' : 'var(--danger)', bold: true },
                ].map(({ label, value, color, bold }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                    <span style={{ color, fontWeight: bold ? 700 : 600 }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Break-even */}
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Başabaş Noktası (Karsız Minimum Fiyat)</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>₺{fmt(result.breakEven)}</span>
              </div>
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
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'percentage', value: '', applyTo: 'marketplace_xml', connectionId: '', xmlSourceId: '' });
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

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      const payload = { 
        ...form, 
        value: parseFloat(form.value),
        conditions: { connectionId: form.connectionId, xmlSourceId: form.xmlSourceId }
      };
      await api.post('/pricing', payload);
      toast.success('Fiyatlandırma kuralı eklendi');
      setShowModal(false);
      setForm({ name: '', type: 'percentage', value: '', applyTo: 'marketplace_xml', connectionId: '', xmlSourceId: '' });
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

  const typeLabels = { percentage: 'Yüzde', fixed: 'Sabit Tutar', formula: 'Formül' };

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>Fiyatlandırma Kuralları</h1><p>Kâr marjı ve fiyatlandırma kurallarınızı yönetin</p></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Kural Ekle</button>
      </div>

      <PriceCalculator />

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : rules.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Tags size={48} className="empty-icon" />
            <h3>Henüz fiyatlandırma kuralı yok</h3>
            <p>Kâr marjı ve fiyat artırım kuralları ekleyerek otomatik fiyatlandırma yapın</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> İlk Kuralı Ekle</button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead><tr><th>Kural Adı</th><th>Tür</th><th>Değer</th><th>Uygulanır</th><th>Durum</th><th>İşlem</th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td><span className="badge badge-primary">{typeLabels[r.type] || r.type}</span></td>
                  <td style={{ fontWeight: 600 }}>{r.type === 'percentage' ? `%${r.value}` : `₺${r.value}`}</td>
                  <td>
                    {(() => {
                      try {
                        const conds = r.conditions ? JSON.parse(r.conditions) : null;
                        if (conds && conds.connectionId && conds.xmlSourceId) {
                          const c = connections.find(x => x.id === conds.connectionId);
                          const x = xmlSources.find(x => x.id === conds.xmlSourceId);
                          return (
                            <div style={{ fontSize: 12 }}>
                              <div><strong>Pazaryeri:</strong> {c?.supplierName || c?.marketplaceType || conds.connectionId}</div>
                              <div><strong>Kaynak:</strong> {x?.name || conds.xmlSourceId}</div>
                            </div>
                          );
                        }
                      } catch(e) {}
                      return r.applyTo === 'all' ? 'Tüm Ürünler' : r.applyTo;
                    })()}
                  </td>
                  <td>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.isActive ? 'var(--success)' : 'var(--text-muted)' }} onClick={() => toggleActive(r.id, r.isActive)}>
                      {r.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                    </button>
                  </td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(r.id)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Fiyatlandırma Kuralı Ekle</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleAdd}>
              <div className="modal-body">
                <div className="form-group"><label className="form-label">Kural Adı *</label><input className="form-input" placeholder="ör: %20 Kâr Marjı" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
                <div className="grid grid-2">
                  <div className="form-group">
                    <label className="form-label">Tür</label>
                    <select className="form-select" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                      <option value="percentage">Yüzde (%)</option>
                      <option value="fixed">Sabit Tutar (₺)</option>
                    </select>
                  </div>
                  <div className="form-group"><label className="form-label">Değer *</label><input type="number" className="form-input" placeholder={form.type === 'percentage' ? '20' : '50'} value={form.value} onChange={e => setForm({...form, value: e.target.value})} required /></div>
                </div>
                <div className="grid grid-2">
                  <div className="form-group">
                    <label className="form-label">Pazaryeri Bağlantısı *</label>
                    <select className="form-select" value={form.connectionId} onChange={e => setForm({...form, connectionId: e.target.value})} required>
                      <option value="">Seçiniz...</option>
                      {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.marketplaceType} ({c.marketplaceType})</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">XML Kaynağı *</label>
                    <select className="form-select" value={form.xmlSourceId} onChange={e => setForm({...form, xmlSourceId: e.target.value})} required>
                      <option value="">Seçiniz...</option>
                      {xmlSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>İptal</button>
                <button type="submit" className="btn btn-primary">Kaydet</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== DELETE CONFIRM MODAL ===== */}
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
