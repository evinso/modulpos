import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { RULE0, RuleEditor, SKU_MODES, BAR_MODES, ruleBody } from '../products/XmlHandImportModal';

const muted = { fontSize: 11.5, color: 'var(--text-muted)' };
const FIELD = { price: 'Fiyat', stock: 'Stok', brand: 'Marka', vatRate: 'KDV', status: 'Durum', category: 'Kategori yazısı', title: 'Ad', sku: 'Stok kodu', barcode: 'Barkod' };
const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const errText = (e, fb) => (e && e.response && e.response.data && e.response.data.error) || fb;

/**
 * ONE change for many hand-added products. Every part is switched on by its own tick; "Önizle" shows how many products change, what they look like before and after and which cannot be changed (and why);
 * only then "Uygula" writes. Any change of the form asks for a new preview first.
 */
export default function BulkEditModal({ target, count, pk, onClose, onDone }) {
  const [on, setOn] = useState({});
  const [f, setF] = useState({ priceMode: 'set', price: '', stockMode: 'set', stock: '', brand: '', vatRate: '20', status: 'active', categoryText: '', titlePrefix: '', titleSuffix: '', titleFind: '', titleReplace: '', sku: { ...RULE0 }, barcode: { ...RULE0 } });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [pv, setPv] = useState(null);                              // { key, data } the preview of THIS form
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const tick = (k) => (e) => setOn((x) => ({ ...x, [k]: e.target.checked }));

  const patch = useMemo(() => {
    const p = {};
    if (on.price) p.price = { mode: f.priceMode, value: f.price };
    if (on.stock) p.stock = { mode: f.stockMode, value: f.stock };
    if (on.brand) p.brand = f.brand;
    if (on.vatRate) p.vatRate = Number(f.vatRate);
    if (on.status) p.status = f.status;
    if (on.category) p.categoryText = f.categoryText.trim() ? f.categoryText : null;
    if (on.title) p.title = { prefix: f.titlePrefix, suffix: f.titleSuffix, find: f.titleFind, replace: f.titleReplace };
    if (on.codes) p.codes = { sku: ruleBody(f.sku), barcode: ruleBody(f.barcode) };
    return p;
  }, [on, f]);
  const key = JSON.stringify(patch);
  const fresh = pv && pv.key === key;
  const anyOn = Object.values(on).some(Boolean);

  const run = async (dryRun) => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/hand-products/bulk', { ...target, patch, dryRun });
      if (dryRun) setPv({ key, data: r.data });
      else { toast.success(`${r.data.applied} ürün güncellendi`); onDone(r.data); }
    } catch (e) { setError(errText(e, 'İşlem yapılamadı')); if (dryRun) setPv(null); }
    finally { setBusy(false); }
  };

  const Part = ({ k, title, children, hint }) => (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: 10, opacity: on[k] ? 1 : 0.75 }}>
      <label className="check" style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 13 }}><input type="checkbox" checked={!!on[k]} onChange={tick(k)} /> {title}</label>
      {on[k] && <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>{children}</div>}
      {on[k] && hint && <small style={{ ...muted, display: 'block', marginTop: 6 }}>{hint}</small>}
    </div>
  );
  const d = pv && pv.data;
  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()} style={{ zIndex: 1100 }}>
      <div className="modal" data-testid="bulk-edit" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <div className="modal-header"><h3>Toplu düzenle: {count} ürün</h3><button className="modal-close" onClick={() => !busy && onClose()}>×</button></div>
        <div className="modal-body" style={{ display: 'grid', gap: 10, maxHeight: '72vh', overflowY: 'auto' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Değiştirmek istediğiniz bölümleri işaretleyin; işaretlemediğiniz alanlara dokunulmaz. Önce <strong>Önizle</strong>: neyin değişeceğini görür, sonra uygularsınız.</div>

          <Part k="price" title={`${pk.label} (₺)`} hint={`${pk.what} Fiyatı 0 olan ürüne yüzde uygulanmaz (0 kalır). Pazaryeri satış fiyatı “Elle eklenen ürünler” fiyat şablonuyla hesaplanır.`}>
            <select className="form-input" style={{ width: 210 }} value={f.priceMode} onChange={(e) => set({ priceMode: e.target.value })}><option value="set">Hepsine şu tutarı yaz</option><option value="percent">Mevcut tutarı yüzde olarak değiştir</option></select>
            <input type="number" step="0.01" className="form-input" style={{ width: 130 }} placeholder={f.priceMode === 'set' ? 'ör. 120' : 'ör. 10 (zam) ya da -5'} aria-label="Fiyat değeri" value={f.price} onChange={(e) => set({ price: e.target.value })} />
          </Part>
          <Part k="stock" title="Stok">
            <select className="form-input" style={{ width: 210 }} value={f.stockMode} onChange={(e) => set({ stockMode: e.target.value })}><option value="set">Hepsine şu stoğu yaz</option><option value="add">Mevcut stoğa ekle / çıkar</option></select>
            <input type="number" step="1" className="form-input" style={{ width: 130 }} placeholder={f.stockMode === 'set' ? 'ör. 10' : 'ör. 5 ya da -2'} aria-label="Stok değeri" value={f.stock} onChange={(e) => set({ stock: e.target.value })} />
          </Part>
          <Part k="brand" title="Marka"><input className="form-input" style={{ width: 260 }} placeholder="Marka adı" aria-label="Marka değeri" value={f.brand} onChange={(e) => set({ brand: e.target.value })} /></Part>
          <Part k="vatRate" title="Satış KDV oranı"><select className="form-input" style={{ width: 120 }} aria-label="KDV değeri" value={f.vatRate} onChange={(e) => set({ vatRate: e.target.value })}>{[0, 1, 8, 10, 18, 20].map((v) => <option key={v} value={v}>%{v}</option>)}</select></Part>
          <Part k="status" title="Durum"><select className="form-input" style={{ width: 160 }} aria-label="Durum değeri" value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="active">Aktif</option><option value="passive">Pasif</option></select></Part>
          <Part k="category" title="Kategori yazısı (serbest metin)" hint="Trendyol kategorisi değildir; yalnızca sizin gruplamanız içindir. Boş bırakırsanız temizlenir. Trendyol kategorisi için “Trendyol kategorisi” sekmesi."><input className="form-input" style={{ width: 320 }} placeholder="ör. Ev / Mutfak" aria-label="Kategori yazısı değeri" value={f.categoryText} onChange={(e) => set({ categoryText: e.target.value })} /></Part>
          <Part k="title" title="Ürün adı: ek yaz ya da metin değiştir" hint="Başa/sona eklenir; “bul” doluysa adın içinde geçen yer “yerine” yazılanla değişir (boş = siler).">
            <input className="form-input" style={{ width: 150 }} placeholder="Başına yaz" aria-label="Ad başı" value={f.titlePrefix} onChange={(e) => set({ titlePrefix: e.target.value })} />
            <input className="form-input" style={{ width: 150 }} placeholder="Sonuna yaz" aria-label="Ad sonu" value={f.titleSuffix} onChange={(e) => set({ titleSuffix: e.target.value })} />
            <input className="form-input" style={{ width: 150 }} placeholder="Bu metni bul" aria-label="Ad bul" value={f.titleFind} onChange={(e) => set({ titleFind: e.target.value })} />
            <input className="form-input" style={{ width: 150 }} placeholder="Yerine bunu yaz" aria-label="Ad yerine" value={f.titleReplace} onChange={(e) => set({ titleReplace: e.target.value })} />
          </Part>
          <Part k="codes" title="Stok kodu ve barkod" hint="Pazaryerine gönderilmiş ürünlerin kodları değişmez (değişirse pazaryerinde yeni ürün olur). Başka üründe olan bir kod verilen ürünün kodu değişmez; önizleme bunları söyler.">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%' }}>
              <RuleEditor label="Stok kodu (SKU)" modes={SKU_MODES} value={f.sku} onChange={(v) => set({ sku: v })} testid="bulk-sku-mode" />
              <RuleEditor label="Barkod" modes={BAR_MODES} value={f.barcode} onChange={(v) => set({ barcode: v })} testid="bulk-barcode-mode" />
            </div>
          </Part>

          {error && <div data-testid="bulk-error" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          {d && fresh && (
            <div data-testid="bulk-preview" style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: 10, background: 'var(--bg-tertiary)' }}>
              <div style={{ fontSize: 13 }}><strong>{d.matched}</strong> ürün seçili · <strong style={{ color: d.changed ? 'var(--success, #16a34a)' : 'var(--warning)' }}>{d.changed}</strong> üründe değişiklik olacak{d.problemCount > 0 && <> · <span style={{ color: 'var(--warning)' }}>{d.problemCount} üründe bir kısım yapılamıyor</span></>}</div>
              {d.rows.length > 0 && (
                <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 8 }}>
                  <table className="table" style={{ width: '100%', fontSize: 12 }}>
                    <thead><tr><th>Ürün</th><th>Değişiklik (önce → sonra)</th></tr></thead>
                    <tbody>{d.rows.map((r) => <tr key={r.id} data-testid="bulk-row"><td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</td><td>{Object.keys(r.after).map((k) => <div key={k}>{FIELD[k] || k}: <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{fmt(r.before[k])}</span> → <strong>{fmt(r.after[k])}</strong></div>)}</td></tr>)}</tbody>
                  </table>
                  {d.changed > d.rows.length && <small style={muted}>İlk {d.rows.length} ürün gösteriliyor.</small>}
                </div>
              )}
              {d.problems.length > 0 && <ul data-testid="bulk-problems" style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 12, color: 'var(--warning)' }}>{d.problems.slice(0, 8).map((p) => <li key={p.id}>{p.title}: {p.reason}</li>)}{d.problemCount > 8 && <li>… ve {d.problemCount - 8} ürün daha</li>}</ul>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
          <button type="button" className="btn btn-secondary" data-testid="bulk-preview-go" disabled={busy || !anyOn} onClick={() => run(true)}>{busy && !fresh ? <><Loader2 size={14} className="spinning" /> …</> : 'Önizle'}</button>
          <button type="button" className="btn btn-primary" data-testid="bulk-apply" disabled={busy || !fresh || !d || d.changed === 0} onClick={() => run(false)} title={!fresh ? 'Önce önizleyin (değişiklik yaptıysanız yeniden)' : ''}>{d && fresh ? `${d.changed} ürüne uygula` : 'Uygula'}</button>
        </div>
      </div>
    </div>
  );
}
