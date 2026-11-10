import { useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';

/**
 * "Order service fee" of one XML source: what the supplier of this source charges per product after an order is placed.
 * It only applies to products that came from THIS source; the orders profit panel subtracts it. 0 = none.
 */
export default function ServiceFeeEditor({ source, onSaved }) {
  const current = Number(source.orderServiceFee) || 0;
  const [value, setValue] = useState(String(current || ''));
  const [saving, setSaving] = useState(false);
  const changed = Number(value || 0) !== current;

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/xml-sources/${source.id}`, { orderServiceFee: value === '' ? 0 : value });
      toast.success(Number(value) > 0 ? `Hizmet bedeli kaydedildi: ${Number(value).toLocaleString('tr-TR')} ₺ / ürün` : 'Hizmet bedeli kaldırıldı');
      onSaved && onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Kaydedilemedi'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ marginBottom: 14, padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Sipariş sonrası hizmet bedeli</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input type="number" min="0" step="0.01" className="form-input" aria-label={`Hizmet bedeli ${source.name}`} style={{ width: 110, padding: '4px 8px', fontSize: 13 }}
          value={value} placeholder="0" onChange={(e) => setValue(e.target.value)} />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>₺ / ürün</span>
        <button className="btn btn-primary btn-sm" disabled={saving || !changed} onClick={save}>Kaydet</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
        Sipariş verdikten sonra bu kaynaktaki her ürün için tedarikçiye ödediğiniz tutar. Yalnızca bu XML kaynağının ürünleri için geçerlidir; Siparişler → Kârlılık sekmesinde gider olarak düşülür.
      </div>
    </div>
  );
}
