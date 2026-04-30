import { useState, useEffect } from 'react';
import { Plus, Trash2, Tags, ToggleLeft, ToggleRight } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function PricingPage() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'percentage', value: '', applyTo: 'all', applyValue: '' });

  useEffect(() => { fetchRules(); }, []);

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
      await api.post('/pricing', { ...form, value: parseFloat(form.value) });
      toast.success('Fiyatlandırma kuralı eklendi');
      setShowModal(false);
      setForm({ name: '', type: 'percentage', value: '', applyTo: 'all', applyValue: '' });
      fetchRules();
    } catch (err) { toast.error(err.response?.data?.error || 'Hata'); }
  };

  const toggleActive = async (id, currentState) => {
    try {
      await api.put(`/pricing/${id}`, { isActive: !currentState });
      fetchRules();
    } catch { toast.error('Güncelleme hatası'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Bu kuralı silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/pricing/${id}`);
      toast.success('Kural silindi');
      fetchRules();
    } catch { toast.error('Hata'); }
  };

  const typeLabels = { percentage: 'Yüzde', fixed: 'Sabit Tutar', formula: 'Formül' };

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>Fiyatlandırma Kuralları</h1><p>Kâr marjı ve fiyatlandırma kurallarınızı yönetin</p></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Kural Ekle</button>
      </div>

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
                  <td>{r.applyTo === 'all' ? 'Tüm Ürünler' : `${r.applyTo}: ${r.applyValue}`}</td>
                  <td>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.isActive ? 'var(--success)' : 'var(--text-muted)' }} onClick={() => toggleActive(r.id, r.isActive)}>
                      {r.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                    </button>
                  </td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => handleDelete(r.id)}><Trash2 size={14} /></button></td>
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
                <div className="form-group">
                  <label className="form-label">Uygulanacak Alan</label>
                  <select className="form-select" value={form.applyTo} onChange={e => setForm({...form, applyTo: e.target.value})}>
                    <option value="all">Tüm Ürünler</option>
                    <option value="category">Belirli Kategori</option>
                    <option value="brand">Belirli Marka</option>
                  </select>
                </div>
                {form.applyTo !== 'all' && (
                  <div className="form-group"><label className="form-label">{form.applyTo === 'category' ? 'Kategori Adı' : 'Marka Adı'}</label><input className="form-input" value={form.applyValue} onChange={e => setForm({...form, applyValue: e.target.value})} /></div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>İptal</button>
                <button type="submit" className="btn btn-primary">Kaydet</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
