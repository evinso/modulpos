import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Link, Save, X, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

export default function GlobalXmlAdminPage() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    format: 'xml',
    description: '',
    logo: '',
    mappingConfig: '',
    isActive: true
  });

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const res = await api.get('/global-xml/all');
      setProviders(res.data);
    } catch (error) {
      toast.error('Global XML listesi alınamadı');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (provider = null) => {
    if (provider) {
      setFormData({
        name: provider.name,
        url: provider.url,
        format: provider.format,
        description: provider.description || '',
        logo: provider.logo || '',
        mappingConfig: provider.mappingConfig || '',
        isActive: provider.isActive
      });
      setEditingProvider(provider);
    } else {
      setFormData({
        name: '',
        url: '',
        format: 'xml',
        description: '',
        logo: '',
        mappingConfig: '',
        isActive: true
      });
      setEditingProvider(null);
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      // Validate mapping config JSON
      let parsedMapping = null;
      if (formData.mappingConfig && formData.mappingConfig.trim() !== '') {
        try {
          parsedMapping = JSON.parse(formData.mappingConfig);
        } catch (e) {
          toast.error('Mapping Config geçerli bir JSON olmalıdır');
          setSaving(false);
          return;
        }
      }

      const payload = { ...formData, mappingConfig: parsedMapping };

      if (editingProvider) {
        await api.put(`/global-xml/${editingProvider.id}`, payload);
        toast.success('Global XML güncellendi');
      } else {
        await api.post('/global-xml', payload);
        toast.success('Global XML oluşturuldu');
      }
      
      setIsModalOpen(false);
      fetchProviders();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Bu global XML sağlayıcısını silmek istediğinize emin misiniz?')) return;
    
    try {
      await api.delete(`/global-xml/${id}`);
      toast.success('Silindi');
      fetchProviders();
    } catch (error) {
      toast.error('Silme başarısız');
    }
  };

  return (
    <div className="global-xml-admin">
      <div className="page-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>Global XML Tedarikçileri (Sistem Geneli)</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Kullanıcıların tek tıkla ekleyebileceği hazır XML tedarikçilerini yönetin.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
          <Plus size={16} /> Yeni Tedarikçi Ekle
        </button>
      </div>

      <div className="table-container">
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>Yükleniyor...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Durum</th>
                <th>Tedarikçi Adı</th>
                <th>URL</th>
                <th>Format</th>
                <th>Açıklama</th>
                <th style={{ textAlign: 'right' }}>İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    Henüz hiç global tedarikçi eklenmemiş.
                  </td>
                </tr>
              ) : (
                providers.map(p => (
                  <tr key={p.id}>
                    <td>
                      <span className={`badge ${p.isActive ? 'badge-success' : 'badge-danger'}`}>
                        {p.isActive ? 'Aktif' : 'Pasif'}
                      </span>
                    </td>
                    <td style={{ fontWeight: '500' }}>{p.name}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a href={p.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }}>
                        {p.url}
                      </a>
                    </td>
                    <td>{p.format.toUpperCase()}</td>
                    <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                      {p.description}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleOpenModal(p)} style={{ marginRight: '8px' }}>
                        <Edit2 size={14} />
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p.id)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', 
          alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: '800px', padding: '0', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="table-header" style={{ flexShrink: 0 }}>
              <h3>{editingProvider ? 'Tedarikçi Düzenle' : 'Yeni Global Tedarikçi'}</h3>
              <button className="text-btn" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>
            
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              <form id="providerForm" onSubmit={handleSave}>
                <div className="grid grid-2" style={{ marginBottom: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Tedarikçi Adı</label>
                    <input type="text" className="form-input" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Örn: X Bilişim" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">XML URL</label>
                    <input type="url" className="form-input" required value={formData.url} onChange={e => setFormData({...formData, url: e.target.value})} placeholder="https://..." />
                  </div>
                </div>

                <div className="grid grid-2" style={{ marginBottom: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Format</label>
                    <select className="form-select" value={formData.format} onChange={e => setFormData({...formData, format: e.target.value})}>
                      <option value="xml">XML</option>
                      <option value="json">JSON</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Logo URL (Opsiyonel)</label>
                    <input type="url" className="form-input" value={formData.logo} onChange={e => setFormData({...formData, logo: e.target.value})} placeholder="https://..." />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label">Açıklama (Kullanıcılara Gösterilecek)</label>
                  <textarea className="form-textarea" style={{ minHeight: '60px' }} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="XML kaynağı hakkında bilgi..." />
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label">Hazır Tag/Alan Eşleştirmesi (Mapping Config - JSON)</label>
                  <div style={{ marginBottom: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    Bu alan, kullanıcı bu XML'i mağazasına eklediğinde otomatik olarak yüklenecek olan sütun eşleştirmeleridir.
                  </div>
                  <textarea 
                    className="form-textarea" 
                    style={{ minHeight: '200px', fontFamily: 'monospace' }} 
                    value={formData.mappingConfig} 
                    onChange={e => setFormData({...formData, mappingConfig: e.target.value})} 
                    placeholder='{"sku": "StokKodu", "title": "UrunAdi", "price": "Fiyat", "stock": "Miktar", ...}' 
                  />
                </div>

                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" id="isActive" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} />
                  <label htmlFor="isActive" style={{ fontSize: '14px', fontWeight: '500' }}>Aktif (Kullanıcılar Görebilir)</label>
                </div>
              </form>
            </div>

            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>İptal</button>
              <button type="submit" form="providerForm" className="btn btn-primary" disabled={saving}>
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
