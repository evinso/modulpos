import { useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const EMPTY = { sku: '', barcode: '', title: '', price: '', stock: '', brand: '', category: '', description: '', status: 'active', vatRate: '20' };

export default function ProductFormModal({ product, onClose, onSaved }) {
  const editing = !!product;
  const fromXml = !!product?.xmlSourceId;
  const [form, setForm] = useState(editing ? {
    sku: product.sku, barcode: product.barcode || '', title: product.title, price: product.price, stock: product.stock,
    brand: product.brand || '', category: product.category || '', description: product.description || '',
    status: product.status || 'active', vatRate: String(product.vatRate ?? 20),
  } : EMPTY);
  const [saving, setSaving] = useState(false);
  const [descTouched, setDescTouched] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(), barcode: form.barcode, brand: form.brand, category: form.category,
        // an untouched description is not sent, so it can never be overwritten by accident
        ...(!editing || descTouched ? { description: form.description } : {}),
        price: parseFloat(form.price) || 0, stock: parseInt(form.stock, 10) || 0, status: form.status, vatRate: parseInt(form.vatRate, 10),
      };
      if (editing) await api.put(`/products/${product.id}`, body);
      else await api.post('/products', { ...body, sku: form.sku.trim() });
      toast.success(editing ? 'Ürün güncellendi' : 'Ürün eklendi');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Kaydedilemedi'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <h3>{editing ? 'Ürünü düzenle' : 'Yeni ürün ekle'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={save}>
          <div className="modal-body">
            {fromXml && (
              <div style={{ fontSize: 12, color: 'var(--info)', background: 'rgba(6,182,212,0.07)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
                Bu ürün bir XML kaynağından geliyor. Elle yaptığınız <strong>satış fiyatı</strong> değişikliği senkronlarda korunur; başlık, stok, marka gibi alanlar XML’de değişirse yeniden XML değerine döner.
              </div>
            )}
            <div className="grid grid-2">
              <div className="form-group"><label className="form-label">SKU *</label>
                <input className="form-input" value={form.sku} onChange={(e) => set({ sku: e.target.value })} required disabled={editing} /></div>
              <div className="form-group"><label className="form-label">Barkod</label>
                <input className="form-input" value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} /></div>
            </div>
            <div className="form-group"><label className="form-label">Ürün adı * <span style={{ color: form.title.length > 100 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 400 }}>({form.title.length}/100)</span></label>
              <input className="form-input" value={form.title} onChange={(e) => set({ title: e.target.value })} required /></div>
            <div className="grid grid-2">
              <div className="form-group"><label className="form-label">Fiyat (₺)</label>
                <input type="number" min="0" step="0.01" className="form-input" value={form.price} onChange={(e) => set({ price: e.target.value })} /></div>
              <div className="form-group"><label className="form-label">Stok</label>
                <input type="number" min="0" step="1" className="form-input" value={form.stock} onChange={(e) => set({ stock: e.target.value })} /></div>
            </div>
            <div className="grid grid-2">
              <div className="form-group"><label className="form-label">Marka</label>
                <input className="form-input" value={form.brand} onChange={(e) => set({ brand: e.target.value })} /></div>
              <div className="form-group"><label className="form-label">Kategori</label>
                <input className="form-input" value={form.category} onChange={(e) => set({ category: e.target.value })} /></div>
            </div>
            <div className="grid grid-2">
              <div className="form-group"><label className="form-label">Durum</label>
                <select className="form-select" value={form.status} onChange={(e) => set({ status: e.target.value })}>
                  <option value="active">Aktif</option><option value="passive">Pasif</option>
                </select></div>
              <div className="form-group"><label className="form-label">Satış KDV’si</label>
                <select className="form-select" value={form.vatRate} onChange={(e) => set({ vatRate: e.target.value })}>
                  <option value="0">%0</option><option value="1">%1</option><option value="10">%10</option><option value="20">%20</option>
                </select></div>
            </div>
            <div className="form-group"><label className="form-label">Açıklama</label>
              <textarea className="form-textarea" rows={5} value={form.description} onChange={(e) => { setDescTouched(true); set({ description: e.target.value }); }} /></div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>İptal</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Kaydediliyor…' : editing ? 'Güncelle' : 'Kaydet'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
