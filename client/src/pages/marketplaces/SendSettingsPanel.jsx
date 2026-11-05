import { useState, useEffect } from 'react';
import { Settings2, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

/**
 * Per-marketplace send settings. They shape what goes OUT (stock, title, images, brand) and which
 * products are held back; the products stored in the system are never changed by them.
 */
const EMPTY = {
  minStock: '', maxStock: '', requireImage: false,
  titlePrefix: '', titleSuffix: '', titleCase: 'none', maxImages: '',
};
const toForm = (s = {}) => {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) {
    const v = s[k];
    if (v === null || v === undefined) continue;
    f[k] = v;
  }
  return f;
};
const toBody = (f) => {
  const num = (v) => (v === '' || v === null || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    minStock: num(f.minStock), maxStock: num(f.maxStock),
    titlePrefix: f.titlePrefix, titleSuffix: f.titleSuffix, titleCase: f.titleCase, maxImages: num(f.maxImages),
  };
};

const Row = ({ label, children, hint }) => (
  <div className="form-group" style={{ margin: 0 }}>
    <label className="form-label">{label}</label>
    {children}
    {hint && <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>{hint}</small>}
  </div>
);

export default function SendSettingsPanel({ connectionId, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [summary, setSummary] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!connectionId) return undefined;
    let alive = true;
    api.get(`/marketplace/connections/${connectionId}/send-settings`)
      .then((res) => { if (alive) { setForm(toForm(res.data.settings)); setSummary(res.data.summary || []); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [connectionId]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/marketplace/connections/${connectionId}/send-settings`, { settings: toBody(form) });
      setForm(toForm(res.data.settings)); setSummary(res.data.summary || []);
      toast.success('Gönderim ayarları kaydedildi');
      if (onSaved) onSaved();
    } catch (e) { toast.error(e.response?.data?.error || 'Kaydedilemedi'); }
    finally { setSaving(false); }
  };

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 14 };
  const h = { fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', margin: '14px 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' };

  return (
    <div data-testid="send-settings" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '12px 18px', marginBottom: 14 }}>
      <button type="button" onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', padding: 0, width: '100%', textAlign: 'left' }}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Settings2 size={16} />
        <strong style={{ fontSize: 14 }}>Gönderim ayarları</strong>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {summary.length ? summary.join(' · ') : 'Hiç ayar yok — ürünler olduğu gibi gönderilir'}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}>
            Bu ayarlar yalnızca bu pazaryerine giden veriyi etkiler; sistemdeki ürünleriniz değişmez. Boş alanlar uygulanmaz.
          </p>

          <div style={h}>Stok</div>
          <div style={grid}>
            <Row label="En az stok" hint="Bunun altındaki stok 0 olarak gönderilir"><input type="number" min="0" className="form-input" value={form.minStock} onChange={set('minStock')} /></Row>
            <Row label="En fazla stok" hint="Stok bu değerle sınırlanır"><input type="number" min="0" className="form-input" value={form.maxStock} onChange={set('maxStock')} /></Row>
          </div>

          <div style={h}>Görsel</div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 6 }}>
            <input type="checkbox" checked={form.requireImage} onChange={set('requireImage')} /> Görseli olmayan ürünleri gönderme
          </label>

          <div style={h}>Başlık ve görsel</div>
          <div style={grid}>
            <Row label="Başlık başına ekle"><input className="form-input" placeholder="ör: Yeni Sezon " value={form.titlePrefix} onChange={set('titlePrefix')} /></Row>
            <Row label="Başlık sonuna ekle"><input className="form-input" placeholder="ör:  - Hızlı Kargo" value={form.titleSuffix} onChange={set('titleSuffix')} /></Row>
            <Row label="Harf düzeni">
              <select className="form-select" value={form.titleCase} onChange={set('titleCase')}>
                <option value="none">Olduğu gibi</option><option value="upper">BÜYÜK HARF</option>
                <option value="lower">küçük harf</option><option value="title">Her Kelime Büyük</option>
              </select>
            </Row>
            <Row label="En fazla görsel"><input type="number" min="1" className="form-input" placeholder="ör: 8" value={form.maxImages} onChange={set('maxImages')} /></Row>
          </div>

          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Kaydediliyor…' : 'Ayarları kaydet'}</button>
        </div>
      )}
    </div>
  );
}
