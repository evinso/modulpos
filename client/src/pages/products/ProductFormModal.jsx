import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, X, Loader2, FolderTree } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import CategoryPicker from '../marketplaces/productcat/CategoryPicker';
import { fileToUploadData, ACCEPT } from './imageTools';
import { storeBrandOf } from './storeBrand';
import RequiredAttributes from './RequiredAttributes';
import TrendyolImport from './TrendyolImport';

const EMPTY = { sku: '', barcode: '', title: '', price: '', stock: '', brand: '', category: '', description: '', status: 'active', vatRate: '20', images: '' };

/** The picture addresses of a product as the list/detail return them (a JSON text or an array) -> one address per line. */
function imageLines(images) {
  let list = images;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  return Array.isArray(list) ? list.filter((u) => typeof u === 'string').join('\n') : '';
}

const MAX_IMAGES = 12;
const linesOf = (text) => String(text || '').split(/\r?\n/).map((u) => u.trim()).filter(Boolean);

export default function ProductFormModal({ product, connection = null, onClose, onSaved }) {
  const editing = !!product;
  const fromXml = !!product?.xmlSourceId;
  // Added by hand (no XML source, no feed price): its "price" is the NET amount the owner wants to keep per sale; the marketplace price is
  // worked out backwards from it by the price template of the scope "Elle eklenen ürünler" (see pricingEngine.js netExplain).
  const hand = editing ? (!product.xmlSourceId && !(Number(product.xmlPrice) > 0)) : true;
  // The brand of the Trendyol store settings is filled in for a NEW product ("Kendi markam": fixed, it is used for every product anyway; "XML markası": the fallback, editable)
  const storeBrand = hand ? storeBrandOf(connection) : null;
  const [form, setForm] = useState(editing ? {
    sku: product.sku, barcode: product.barcode || '', title: product.title, price: product.price, stock: product.stock,
    brand: product.brand || '', category: product.category || '', description: product.description || '',
    status: product.status || 'active', vatRate: String(product.vatRate ?? 20), images: imageLines(product.images),
  } : { ...EMPTY, brand: storeBrand ? storeBrand.name : '' });
  const [hasTemplate, setHasTemplate] = useState(true);     // is there an active template that prices hand-added products?
  const [saving, setSaving] = useState(false);
  const [descTouched, setDescTouched] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // The Trendyol category is chosen right here (product-level category: it wins over any XML-category mapping); needs a Trendyol connection
  const trendyol = hand && !!connection && connection.marketplaceType === 'trendyol';
  const [cat, setCat] = useState(null);                       // { id, name, path } chosen in this form
  const [showPicker, setShowPicker] = useState(false);
  const currentCat = editing && product.pricing && product.pricing.mapName ? product.pricing.mapName : '';

  // The required attributes of the chosen category load right here (first answers from a Trendyol page, the title, the default answers)
  const [attrState, setAttrState] = useState({ loading: false, unavailable: false, attributes: [] });
  const [attrValues, setAttrValues] = useState({});            // { [attributeId]: { valueId, valueName, from, custom? } }
  const [hints, setHints] = useState([]);                      // [{ name, value }] of an imported Trendyol page
  const [imported, setImported] = useState(null);              // what the last import said (price, brand, whether the category is a guess)
  const attrSeq = useRef(0);

  /** Loads the attribute form of a category. `keep`: keep what the owner already chose and only fill the empty ones. */
  const loadAttributes = async (categoryId, extra = {}, keep = false) => {
    if (!connection) return;
    const mine = ++attrSeq.current;
    setAttrState((st) => ({ ...st, loading: true }));
    try {
      const { data } = await api.post(`/marketplace/connections/${connection.id}/product-categories/attribute-form`, {
        categoryId, title: extra.title ?? form.title, description: extra.description ?? form.description, hints: extra.hints ?? hints,
      });
      if (mine !== attrSeq.current) return;
      setAttrState({ loading: false, unavailable: !!data.unavailable, attributes: data.attributes || [] });
      setAttrValues((cur) => {
        const next = keep ? { ...cur } : {};
        for (const a of data.attributes || []) {
          const have = cur[a.id] && (cur[a.id].valueId || String(cur[a.id].valueName || '').trim());
          if (keep && have) continue;
          if (a.answer) next[a.id] = { valueId: a.answer.valueId || '', valueName: a.answer.valueName || '', from: a.answer.from };
        }
        return next;
      });
    } catch (err) {
      if (mine !== attrSeq.current) return;
      setAttrState({ loading: false, unavailable: true, attributes: [] });
    }
  };
  const pickCategory = (r) => {
    setCat({ id: String(r.id), name: r.name, path: r.path });
    if (!form.category.trim()) set({ category: r.name });
    setAttrValues({});
    loadAttributes(String(r.id));
  };

  // "Trendyol linkinden doldur": the fields are filled and stay editable
  const applyImport = (d) => {
    setImported({ price: d.price, brand: d.brand, brandKept: !!storeBrand && !!d.brand && d.brand !== storeBrand.name, categoryGuess: !!(d.category && d.category.how === 'guess'), url: d.url });
    setForm((f) => ({
      ...f,
      title: d.title || f.title, description: d.description || f.description,
      brand: storeBrand ? f.brand : (d.brand || f.brand),                    // the store's own brand (the owner's) is kept
      images: d.images && d.images.length ? d.images.join('\n') : f.images,
      category: f.category || (d.category ? d.category.name : ''),
    }));
    if (d.description) setDescTouched(true);
    setHints(d.attributes || []);
    if (trendyol && d.category) {
      setCat({ id: String(d.category.id), name: d.category.name, path: d.category.path });
      setAttrValues({});
      loadAttributes(String(d.category.id), { title: d.title || form.title, description: d.description || form.description, hints: d.attributes || [] });
    }
  };

  // Pictures: addresses typed / pasted, and photos uploaded from this device (the upload answers with a public address that is added to the list)
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef(null);
  const urls = linesOf(form.images);
  const removeUrl = (i) => set({ images: urls.filter((_, k) => k !== i).join('\n') });
  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length === 0) return;
    const room = MAX_IMAGES - linesOf(form.images).length;
    if (files.length > room) toast.error(`En fazla ${MAX_IMAGES} görsel eklenebilir${room > 0 ? `; ilk ${room} fotoğraf alınıyor` : ''}`);
    const todo = files.slice(0, Math.max(0, room));
    setUploading((n) => n + todo.length);
    const added = [];
    for (const f of todo) {
      try {
        const data = await fileToUploadData(f);
        const { data: r } = await api.post('/products/images', { data });
        added.push(r.url);
      } catch (err) { toast.error(`${f.name}: ${err.response?.data?.error || err.message || 'yüklenemedi'}`); }
      finally { setUploading((n) => n - 1); }
    }
    if (added.length) setForm((f) => ({ ...f, images: [...linesOf(f.images), ...added].join('\n') }));
  };

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
      const list = linesOf(form.images);
      if (hand) {
        if (uploading > 0) { toast.error('Fotoğraflar yükleniyor, bitmesini bekleyin'); setSaving(false); return; }
        if (list.length === 0) { toast.error('En az bir görsel ekleyin: bir adres yazın ya da fotoğraf yükleyin (Trendyol görselsiz ürün kabul etmez)'); setSaving(false); return; }
        const bad = list.find((u) => !/^https?:\/\/\S+$/i.test(u));
        if (bad) { toast.error(`Görsel adresi http:// ya da https:// ile başlamalı: ${bad.slice(0, 50)}`); setSaving(false); return; }
        if (!(parseFloat(form.price) > 0)) { toast.error('Elinize kalacak net tutarı yazın'); setSaving(false); return; }
        if (trendyol && !editing && !cat) { toast.error('Trendyol kategorisini seçin'); setSaving(false); return; }
      }
      const body = {
        ...(hand ? { images: list } : {}),
        title: form.title.trim(), barcode: form.barcode, brand: form.brand, category: form.category,
        // an untouched description is not sent, so it can never be overwritten by accident
        ...(!editing || descTouched ? { description: form.description } : {}),
        price: parseFloat(form.price) || 0, stock: parseInt(form.stock, 10) || 0, status: form.status, vatRate: parseInt(form.vatRate, 10),
      };
      let productId = product && product.id;
      if (editing) await api.put(`/products/${product.id}`, body);
      else productId = (await api.post('/products', { ...body, sku: form.sku.trim() })).data.id;
      let categoryOk = true; let attrNote = '';
      if (trendyol && cat) {
        try { await api.put(`/marketplace/connections/${connection.id}/product-categories`, { assignments: [{ productId, categoryId: cat.id, source: 'manual' }] }); }
        catch (err) { categoryOk = false; toast.error(`Ürün kaydedildi ama Trendyol kategorisi atanamadı (${err.response?.data?.error || 'hata'}). “Kategori eşleştirme › Ürün bazlı kategori” sekmesinden seçin.`, { duration: 9000 }); }
        // what the owner chose in the attribute rows goes on top of the automatic answers (this product only)
        const chosen = attrState.attributes.map((a) => ({ id: a.id, v: attrValues[a.id] })).filter((x) => x.v && (x.v.valueId || String(x.v.valueName || '').trim()))
          .map((x) => ({ id: x.id, valueId: x.v.valueId || '', valueName: x.v.valueId ? '' : String(x.v.valueName).trim() }));
        if (categoryOk && chosen.length) {
          try { const r = await api.put(`/marketplace/connections/${connection.id}/product-categories/product-attributes`, { productId, categoryId: cat.id, attributes: chosen }); if (r.data && r.data.skipped && r.data.skipped.length) attrNote = ` Kabul edilmeyen: ${r.data.skipped.join(', ')}.`; }
          catch (err) { toast.error(`Özellikler kaydedilemedi (${err.response?.data?.error || 'hata'}). “Ürün bazlı kategori” sekmesinden girin.`, { duration: 9000 }); }
        }
      }
      toast.success(editing ? 'Ürün güncellendi' : 'Ürün eklendi');
      if (trendyol && cat && categoryOk) {
        const open = attrState.attributes.filter((a) => !(attrValues[a.id] && (attrValues[a.id].valueId || String(attrValues[a.id].valueName || '').trim()))).length;
        toast(open > 0 ? `Trendyol kategorisi atandı. ${open} zorunlu özellik boş kaldı: “Ürün bazlı kategori” sekmesinde tamamlayın.${attrNote}` : `Trendyol kategorisi ve zorunlu özellikler kaydedildi.${attrNote}`, { icon: open > 0 ? '⚠️' : '✅', duration: 8000 });
      }
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
            {hand && !editing && <TrendyolImport onImported={applyImport} />}
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
                {hand && <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Satıştan sonra, kargo-komisyon-stopaj-KDV düşüldükten sonra elinize geçmesini istediğiniz tutar. Pazaryeri fiyatı buna göre hesaplanır.</small>}
                {imported && imported.price && <small data-testid="ref-price" style={{ display: 'block', fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>Linkteki ürün Trendyol’da ₺{Number(imported.price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} (yalnızca bilgi için; net tutarı siz yazın).</small>}</div>
              <div className="form-group"><label className="form-label">Stok</label>
                <input type="number" min="0" step="1" className="form-input" value={form.stock} onChange={(e) => set({ stock: e.target.value })} /></div>
            </div>
            <div className="grid grid-2">
              <div className="form-group"><label className="form-label">Marka{hand ? ' *' : ''}</label>
                <input className="form-input" data-testid="brand" value={form.brand} onChange={(e) => set({ brand: e.target.value })} required={hand}
                  readOnly={!!storeBrand && storeBrand.strategy === 'override' && !editing} />
                {hand && !storeBrand && <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Trendyol’daki marka adıyla yazın</small>}
                {storeBrand && storeBrand.strategy === 'override' && (
                  <small data-testid="brand-note" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Trendyol mağaza ayarınızda <strong>“Kendi markam”</strong> seçili ({storeBrand.name}): ürün her zaman bu markayla gönderilir{!editing ? ', bu yüzden otomatik seçildi' : ''}. Değiştirmek için <Link to="/marketplace" onClick={onClose}>Pazaryeri ayarları</Link>.
                  </small>
                )}
                {imported && imported.brandKept && <small data-testid="brand-kept" style={{ display: 'block', fontSize: 11.5, color: 'var(--text-secondary)' }}>Linkteki marka “{imported.brand}”; mağaza markanız korundu.</small>}
                {storeBrand && storeBrand.strategy === 'xml' && (
                  <small data-testid="brand-note" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Trendyol mağaza ayarındaki yedek marka ({storeBrand.name}){!editing ? ' otomatik yazıldı; farklı bir marka için değiştirebilirsiniz' : ' kullanılır, bu ürünün markası Trendyol’da bulunamazsa'}. <Link to="/marketplace" onClick={onClose}>Pazaryeri ayarları</Link>
                  </small>
                )}</div>
              <div className="form-group"><label className="form-label">Kategori{hand ? ' (kendi notunuz)' : ''}</label>
                <input className="form-input" value={form.category} onChange={(e) => set({ category: e.target.value })} />
                {hand && !trendyol && <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Trendyol kategorisini “Kategori eşleştirme › Ürün bazlı kategori” sekmesinden seçersiniz</small>}</div>
            </div>
            {trendyol && (
              <div className="form-group" data-testid="trendyol-category">
                <label className="form-label">Trendyol kategorisi{!editing ? ' *' : ''}</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary" data-testid="pick-category" onClick={() => setShowPicker(true)}><FolderTree size={14} /> {cat ? 'Değiştir' : 'Kategori seç'}</button>
                  <span data-testid="chosen-category" style={{ fontSize: 13, color: cat || currentCat ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {cat ? cat.path : (currentCat ? `Mevcut: ${currentCat}` : 'Henüz seçilmedi')}
                  </span>
                </div>
                <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Trendyol’un kendi kategori ağacından seçilir; ürün kaydedilince bu kategoriye bağlanır. Seçince kategorinin zorunlu özellikleri aşağıda yüklenir.</small>
                {imported && imported.categoryGuess && cat && <small data-testid="category-guess" style={{ display: 'block', fontSize: 11.5, color: 'var(--warning)', marginTop: 4 }}>Kategori, Trendyol sayfasındaki ada bakılarak tahmin edildi; doğru olduğunu kontrol edin, gerekirse “Değiştir”.</small>}
              </div>
            )}
            {trendyol && cat && <RequiredAttributes state={attrState} values={attrValues} onChange={(id, v) => setAttrValues((cur) => { const n = { ...cur }; if (v) n[id] = v; else delete n[id]; return n; })} onSuggest={() => loadAttributes(cat.id, {}, true)} />}
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
              <div className="form-group" data-testid="images">
                <label className="form-label">Görseller * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(adres yazın ve/veya fotoğraf yükleyin; ilki ana görsel)</span></label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <button type="button" className="btn btn-secondary" data-testid="upload-photo" disabled={uploading > 0 || urls.length >= MAX_IMAGES} onClick={() => fileRef.current && fileRef.current.click()}>
                    {uploading > 0 ? <Loader2 size={14} className="spinning" /> : <Upload size={14} />} Fotoğraf yükle
                  </button>
                  <input ref={fileRef} type="file" accept={ACCEPT} multiple onChange={onFiles} style={{ display: 'none' }} data-testid="photo-input" aria-label="Fotoğraf seç" />
                  {uploading > 0 && <span data-testid="uploading" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{uploading} fotoğraf yükleniyor…</span>}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{urls.length}/{MAX_IMAGES}</span>
                </div>
                <textarea className="form-textarea" rows={3} data-testid="image-urls" placeholder={'https://.../urun-1.jpg\nhttps://.../urun-2.jpg'} value={form.images} onChange={(e) => set({ images: e.target.value })} />
                <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Her satıra bir görsel adresi (http:// ya da https:// ile başlayan). Yüklediğiniz fotoğrafların adresi buraya kendiliğinden eklenir.</small>
                {urls.length > 0 && (
                  <div data-testid="thumbs" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    {urls.map((u, i) => (
                      <div key={`${u}-${i}`} data-testid="thumb" style={{ position: 'relative', width: 64, height: 64, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-tertiary)', border: i === 0 ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)' }}>
                        <img src={u} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.opacity = 0.2; }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {i === 0 && <span style={{ position: 'absolute', left: 0, bottom: 0, fontSize: 9, background: 'var(--accent-primary)', color: '#fff', padding: '0 4px' }}>Ana</span>}
                        <button type="button" aria-label="Görseli kaldır" data-testid="remove-thumb" onClick={() => removeUrl(i)} style={{ position: 'absolute', right: 0, top: 0, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', padding: 1, lineHeight: 0 }}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <small style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
                  Yüklediğiniz fotoğraflar yalnızca Trendyol’un indirebilmesi için geçici olarak sunucumuzda durur; ürün Trendyol’a gönderilip kendi adreslerini gösterdiğinde otomatik silinir (ürününüz o zaman Trendyol’un adreslerini kullanır).
                </small>
              </div>
            )}
            <div className="form-group"><label className="form-label">Açıklama{hand ? ' *' : ''}</label>
              <textarea className="form-textarea" rows={5} data-testid="description" required={hand} value={form.description} onChange={(e) => { setDescTouched(true); set({ description: e.target.value }); }} />
              {hand && <small style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Trendyol açıklamasız ürün kabul etmez</small>}</div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>İptal</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Kaydediliyor…' : editing ? 'Güncelle' : 'Kaydet'}</button>
          </div>
        </form>
        {/* outside the <form>: the picker's own buttons must never submit the product */}
        {showPicker && <CategoryPicker connId={connection.id} zIndex={1200} onClose={() => setShowPicker(false)}
          onPick={(r) => { pickCategory(r); setShowPicker(false); }} />}
      </div>
    </div>
  );
}
