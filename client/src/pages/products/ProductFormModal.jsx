import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';

const EMPTY = { sku: '', barcode: '', title: '', price: '', stock: '', brand: '', category: '', description: '', status: 'active', vatRate: '20', images: '' };

/** The picture addresses of a product as the list/detail return them (a JSON text or an array) -> one address per line. */
function imageLines(images) {
  let list = images;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  return Array.isArray(list) ? list.filter((u) => typeof u === 'string').join('\n') : '';
}

export default function ProductFormModal({ product, onClose, onSaved }) {
  const editing = !!product;
  const fromXml = !!product?.xmlSourceId;
  // Added by hand (no XML source, no feed price): its "price" is the NET amount the owner wants to keep per sale; the marketplace price is
  // worked out backwards from it by the price template of the scope "Elle eklenen ürünler" (see pricingEngine.js netExplain).
  const hand = editing ? (!product.xmlSourceId && !(Number(product.xmlPrice) > 0)) : true;
  const [form, setForm] = useState(editing ? {
    sku: product.sku, barcode: product.barcode || '', title: product.title, price: product.price, stock: product.stock,
    brand: product.brand || '', category: product.category || '', description: product.description || '',
    status: product.status || 'active', vatRate: String(product.vatRate ?? 20), images: imageLines(product.images),
  } : EMPTY);
  const [hasTemplate, setHasTemplate] = useState(true);     // is there an active template that prices hand-added products?
  const [saving, setSaving] = useState(false);
  const [descTouched, setDescTouched] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!hand) return undefined;
    let off = false;
    api.get('/pricing').then((r) => {
      if (off) return;
      const ok = (r.data || []).some((rule) => {
        if (!rule.isActive || rule.applyTo !== 'price_template') return false;
        let c = {}; try { c = rule.conditions ? JSON.parse(rule.conditions) : {}; } catch { /* ignore */ }
        const ids = c.xmlSourceIds && c.xmlSourceIds.length ? c.xmlSourceIds : (c.xmlSourceId ? [c.xmlSourceId] : []);
        return ids.length === 0 || ids.includes('none');
      });
      setHasTemplate(ok);
    }).catch(() => { /* the note is only a hint */ });
    return () => { off = true; };
  }, [hand]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const urls = form.images.split(/\r?\n/).map((u) => u.trim()).filter(Boolean);
      if (hand) {
        if (urls.length === 0) { toast.error('En az bir görsel adresi yazın (Trendyol görselsiz ürün kabul etmez)'); setSaving(false); return; }
        const bad = urls.find((u) => !/^https?:\/\/\S+$/i.test(u));
        if (bad) { toast.error(`Görsel adresi http:// ya da https:// ile başlamalı: ${bad.slice(0, 50)}`); setSaving(false); return; }
        if (!(parseFloat(form.price) > 0)) { toast.error('Elinize kalacak net tutarı yazın'); setSaving(false); return; }
      }
      const body = {
        ...(hand ? { images: urls } : {}),
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
            {hand && (
              <div data-testid="hand-note" style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
                Elle eklediğiniz üründe yazdığınız tutar, <strong>satıştan sonra size kalması gereken net tutardır</strong>. Pazaryerinde satılacak fiyat, kargo, komisyon, hizmet bedeli, stopaj ve KDV bu tutarın üstüne eklenerek hesaplanır.
                {!hasTemplate && (
                  <div data-testid="no-template-note" style={{ color: 'var(--warning)', marginTop: 6 }}>
                    Bu fiyatın hesaplanması için henüz “Elle eklenen ürünler” fiyat şablonu yok. <Link to="/pricing" onClick={onClose}>Fiyat Şablonları</Link> sayfasında, XML kaynağı olarak “Elle eklenen ürünler”i seçip kargo ve komisyonu yazarak bir şablon ekleyin; yoksa ürünün fiyatı hesaplanamaz ve gönderilemez.
                  </div>
                )}
              </div>
            )}
            {fromXml && (
              <div style={{ fontSize: 12, color: 'var(--info)', background: 'rgba(6,182,212,0.07)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
                Bu ürün bir XML kaynağından geliyor. Elle yaptığınız <strong>satış fiyatı</strong> değişikliği senkronlarda korunur; başlık, stok, marka gibi alanlar XML’de değişirse yeniden XML değerine döner.
              </div>
            )}
            <div className="grid grid-2">
              <div className="form-group"><label className="form-label">SKU *</label>
                <input className="form-input" value={form.sku} onChange={(e) => set({ sku: e.target.value })} required disabled={editing} /></div>
              <div className="form-group"><label className="form-label">Barkod{hand ? ' *' : ''}</label>
                <input className="form-input" value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} required={hand} />
                {hand && <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Trendyol barkodsuz ürün kabul etmez</small>}</div>
            </div>
            <div className="form-group"><label className="form-label">Ürün adı * <span style={{ color: form.title.length > 100 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 400 }}>({form.title.length}/100)</span></label>
              <input className="form-input" value={form.title} onChange={(e) => set({ title: e.target.value })} required /></div>
            <div className="grid grid-2">
              <div className="form-group"><label className="form-label">{hand ? 'Elime kalacak net tutar (₺) *' : 'Fiyat (₺)'}</label>
                <input type="number" min="0" step="0.01" className="form-input" data-testid="net-price" value={form.price} onChange={(e) => set({ price: e.target.value })} required={hand} />
                {hand && <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Satıştan sonra, kargo-komisyon-stopaj-KDV düşüldükten sonra elinize geçmesini istediğiniz tutar. Pazaryeri fiyatı buna göre hesaplanır.</small>}</div>
              <div className="form-group"><label className="form-label">Stok</label>
                <input type="number" min="0" step="1" className="form-input" value={form.stock} onChange={(e) => set({ stock: e.target.value })} /></div>
            </div>
            <div className="grid grid-2">
              <div className="form-group"><label className="form-label">Marka{hand ? ' *' : ''}</label>
                <input className="form-input" value={form.brand} onChange={(e) => set({ brand: e.target.value })} required={hand} />
                {hand && <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Trendyol’daki marka adıyla yazın</small>}</div>
              <div className="form-group"><label className="form-label">Kategori{hand ? ' (kendi notunuz)' : ''}</label>
                <input className="form-input" value={form.category} onChange={(e) => set({ category: e.target.value })} />
                {hand && <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Trendyol kategorisini “Kategori eşleştirme › Ürün bazlı kategori” sekmesinden seçersiniz</small>}</div>
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
            {hand && (
              <div className="form-group"><label className="form-label">Görsel adresleri * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(her satıra bir adres, ilki ana görsel)</span></label>
                <textarea className="form-textarea" rows={4} data-testid="image-urls" placeholder={'https://.../urun-1.jpg\nhttps://.../urun-2.jpg'} value={form.images} onChange={(e) => set({ images: e.target.value })} />
                <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Resmin internetteki doğrudan adresi (http:// ya da https:// ile başlayan); en fazla 12.</small></div>
            )}
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
