import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardPaste, Pencil, Search } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import Cell from './Cell';
import BulkEditModal from './BulkEditModal';
import PasteListModal from './PasteListModal';

const PAGE = 50; const muted = { fontSize: 11.5, color: 'var(--text-muted)' };
export const FILTERS = [['all', 'Hepsi'], ['no_price', 'Fiyatı girilmemiş'], ['no_stock', 'Stoğu 0'], ['no_brand', 'Markasız'], ['no_barcode', 'Barkodsuz'], ['no_image', 'Fotoğrafsız'], ['no_category', 'Trendyol kategorisi yok'], ['sent', 'Pazaryerine gönderilmiş'], ['not_sent', 'Gönderilmemiş']];
const SORTS = [['createdAt', 'Eklenme'], ['updatedAt', 'Son değişiklik'], ['title', 'Ad'], ['price', 'Fiyat'], ['stock', 'Stok'], ['sku', 'Stok kodu'], ['brand', 'Marka']];

/** The table of the products added by hand: every box is editable (saved when you leave it), many products can be chosen and changed at once, a price / stock list can be pasted. */
export default function HandGrid({ connId, pk, filter, setFilter, onSummary, onOpenCategories }) {
  const [q, setQ] = useState(''); const [qLive, setQLive] = useState('');
  const [sort, setSort] = useState('createdAt'); const [dir, setDir] = useState('desc'); const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pages: 1 }); const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(() => new Set()); const [bulk, setBulk] = useState(false); const [paste, setPaste] = useState(false); const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const r = await api.get('/hand-products', { params: { q, filter, sort, dir, page, limit: PAGE, connectionId: connId || undefined } });
      setData(r.data); onSummary(r.data.summary);
    } catch (e) { toast.error((e.response && e.response.data && e.response.data.error) || 'Ürünler yüklenemedi'); }
    finally { setLoading(false); }
  }, [q, filter, sort, dir, page, connId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(false); }, [load]);
  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(() => { setPage(1); setQ(qLive); }, 350); return () => clearTimeout(timer.current); }, [qLive]);
  const later = () => { clearTimeout(timer.current); timer.current = setTimeout(() => load(true), 900); };      // the counts above follow the edits

  const put = async (p, field, raw) => {
    let value = raw;
    if (field === 'price') { value = Number(String(raw).replace(',', '.')); if (String(raw).trim() === '' || !Number.isFinite(value) || value < 0) { toast.error('Fiyat 0 veya daha büyük bir sayı olmalı'); return false; } }
    if (field === 'stock') { value = Number(raw); if (String(raw).trim() === '' || !Number.isInteger(value) || value < 0) { toast.error('Stok 0 veya daha büyük bir tam sayı olmalı'); return false; } }
    if (field === 'vatRate') value = Number(raw);
    if (field === 'title' && !String(raw).trim()) { toast.error('Ürün adı boş olamaz'); return false; }
    try {
      await api.put(`/products/${p.id}`, { [field]: value });
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === p.id ? { ...x, [field]: value } : x)) })); later(); return true;
    } catch (e) { toast.error((e.response && e.response.data && e.response.data.error) || 'Kaydedilemedi'); return false; }
  };

  const ids = data.items.map((p) => p.id); const allOnPage = ids.length > 0 && ids.every((id) => sel.has(id));
  const togglePage = () => setSel((s) => { const n = new Set(s); if (allOnPage) ids.forEach((id) => n.delete(id)); else ids.forEach((id) => n.add(id)); return n; });
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectFiltered = async () => {
    setBusy(true);
    try { const r = await api.get('/hand-products/ids', { params: { q, filter, connectionId: connId || undefined } }); setSel(new Set(r.data.ids)); if (r.data.truncated) toast(`İlk ${r.data.ids.length} ürün seçildi`); }
    catch { toast.error('Ürünler seçilemedi'); } finally { setBusy(false); }
  };
  const done = () => { setBulk(false); setPaste(false); setSel(new Set()); load(false); };

  return (
    <div>
      <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', minWidth: 220, flex: 1 }}><Search size={14} style={{ position: 'absolute', left: 9, top: 11, color: 'var(--text-muted)' }} /><input className="form-input" aria-label="Ara" style={{ paddingLeft: 28 }} placeholder="Ad, stok kodu ya da barkod ara" value={qLive} onChange={(e) => setQLive(e.target.value)} /></div>
        <select className="form-select" aria-label="Filtre" style={{ width: 230 }} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); setSel(new Set()); }}>{FILTERS.map(([k, l]) => <option key={k} value={k} disabled={k === 'no_category' && !connId}>{l}</option>)}</select>
        <select className="form-select" aria-label="Sırala" style={{ width: 150 }} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="form-select" aria-label="Yön" style={{ width: 100 }} value={dir} onChange={(e) => setDir(e.target.value)}><option value="desc">Azalan</option><option value="asc">Artan</option></select>
        <button className="btn btn-secondary" data-testid="open-paste" onClick={() => setPaste(true)}><ClipboardPaste size={15} /> Fiyat / stok listesi yapıştır</button>
      </div>

      <div className="card" style={{ padding: 10, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-secondary" disabled={busy || data.total === 0} data-testid="select-filtered" onClick={selectFiltered}>Filtrelenen {data.total} ürünün hepsini seç</button>
        {sel.size > 0 ? <>
          <span style={{ fontSize: 13 }} data-testid="sel-count"><strong>{sel.size}</strong> ürün seçili</span>
          <button className="btn btn-primary" data-testid="open-bulk" onClick={() => setBulk(true)}><Pencil size={15} /> Seçilileri toplu düzenle</button>
          <button className="btn btn-secondary" onClick={() => setSel(new Set())}>Seçimi temizle</button>
        </> : <small style={muted}>Birden çok ürünü seçip aynı anda {pk.lower}, stok, marka, KDV, ad ya da stok kodu / barkodlarını değiştirebilirsiniz. Tek tek değiştirmek için kutulara doğrudan yazın (kutudan çıkınca kaydedilir).</small>}
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table" style={{ width: '100%', minWidth: 1300, fontSize: 12.5 }}>
          <thead><tr>
            <th style={{ width: 30 }}><input type="checkbox" aria-label="Sayfadakilerin hepsi" checked={allOnPage} onChange={togglePage} /></th>
            <th style={{ width: 44 }} /><th style={{ minWidth: 240 }}>Ürün adı</th><th style={{ width: 120 }}>Stok kodu</th><th style={{ width: 130 }}>Barkod</th>
            <th style={{ width: 112 }} title={pk.what}>{pk.label} (₺)</th><th style={{ width: 118 }} title="Seçili Trendyol bağlantısında, elle eklenen ürünler fiyat şablonunun bu ürün için hesapladığı satış fiyatı ve kâr">Pazaryeri fiyatı</th><th style={{ width: 70 }}>Stok</th><th style={{ width: 130 }}>Marka</th><th style={{ width: 70 }}>KDV</th><th style={{ width: 90 }}>Durum</th><th style={{ width: 190 }}>Trendyol kategorisi</th>
          </tr></thead>
          <tbody>
            {loading && data.items.length === 0 ? <tr><td colSpan={12} style={{ padding: 18, textAlign: 'center' }}>Yükleniyor…</td></tr>
              : data.items.length === 0 ? <tr><td colSpan={12} style={{ padding: 18, textAlign: 'center' }} data-testid="hand-empty">{data.total === 0 && filter === 'all' && !q ? <>Henüz elle eklenen ürün yok. <Link to="/products">Ürünler</Link> sayfasından “Yeni ürün” ya da “XML’den ürün ekle” ile ekleyin.</> : 'Bu filtreye uyan ürün yok.'}</td></tr>
                : data.items.map((p) => (
                  <tr key={p.id} data-testid="hand-row" style={p.status === 'passive' ? { opacity: 0.6 } : undefined}>
                    <td><input type="checkbox" aria-label={`${p.title} seç`} checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></td>
                    <td>{p.firstImage ? <img src={p.firstImage} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span title="Fotoğraf yok" style={{ color: 'var(--warning)', fontSize: 11 }}>foto yok</span>}</td>
                    <td><Cell value={p.title} label={`${p.title} adı`} onSave={(v) => put(p, 'title', v)} />{p.categoryText && <small style={muted}>{p.categoryText}</small>}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{p.sku}</td>
                    <td><Cell value={p.barcode} label={`${p.sku} barkod`} disabled={p.sent} title={p.sent ? 'Pazaryerine gönderilmiş: barkod değişirse pazaryerinde yeni ürün olur' : undefined} onSave={(v) => put(p, 'barcode', v)} /></td>
                    <td><Cell type="number" step="0.01" min="0" align="right" value={p.price} label={`${p.sku} fiyat`} onSave={(v) => put(p, 'price', v)} />{p.price <= 0 && <small style={{ color: 'var(--warning)', fontSize: 11 }}>girilmemiş</small>}</td>
                    <td data-testid="sale-price" style={{ fontSize: 12 }}>{!p.pricing ? <span style={muted}>—</span> : p.pricing.salePrice ? <><strong>₺{Number(p.pricing.salePrice).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>{p.pricing.profit !== null && <small style={{ display: 'block', color: p.pricing.profit < 0 ? 'var(--danger)' : 'var(--text-muted)' }} title="Şablonun hesabına göre kâr (elinize kalan)">{p.pricing.profit < 0 ? 'zarar' : 'kâr'} ₺{Math.abs(p.pricing.profit).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small>}</> : p.price > 0 ? <span style={{ color: 'var(--warning)' }} title="Elle eklenen ürünleri kapsayan etkin bir fiyat şablonu yok">şablon yok</span> : <span style={muted}>—</span>}</td>
                    <td><Cell type="number" step="1" min="0" align="right" value={p.stock} label={`${p.sku} stok`} onSave={(v) => put(p, 'stock', v)} /></td>
                    <td><Cell value={p.brand} label={`${p.sku} marka`} onSave={(v) => put(p, 'brand', v)} />{!p.brand && <small style={{ color: 'var(--warning)', fontSize: 11 }}>marka yok</small>}</td>
                    <td><select className="form-select" aria-label={`${p.sku} KDV`} style={{ padding: '3px 4px', fontSize: 12.5 }} value={p.vatRate} onChange={(e) => put(p, 'vatRate', e.target.value)}>{[0, 1, 8, 10, 18, 20].map((v) => <option key={v} value={v}>%{v}</option>)}</select></td>
                    <td><select className="form-select" aria-label={`${p.sku} durum`} style={{ padding: '3px 4px', fontSize: 12.5 }} value={p.status === 'passive' ? 'passive' : 'active'} onChange={(e) => put(p, 'status', e.target.value)}><option value="active">Aktif</option><option value="passive">Pasif</option></select></td>
                    <td style={{ fontSize: 12 }}>{!connId ? <span style={muted}>Trendyol bağlantısı yok</span> : p.trendyolCategory ? <span title={p.trendyolCategory.name}>{String(p.trendyolCategory.name).split('>').pop().trim().slice(0, 34)}</span> : <button type="button" className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 11.5 }} onClick={onOpenCategories}>Kategori ata</button>}{p.sent && <small style={{ display: 'block', ...muted }}>gönderilmiş</small>}</td>
                  </tr>))}
          </tbody>
        </table>
      </div>
      {data.pages > 1 && <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
        <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Önceki</button><small style={muted}>Sayfa {page} / {data.pages} · {data.total} ürün</small>
        <button className="btn btn-secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Sonraki</button></div>}

      {bulk && <BulkEditModal target={{ ids: [...sel] }} count={sel.size} pk={pk} onClose={() => setBulk(false)} onDone={done} />}
      {paste && <PasteListModal pk={pk} onClose={() => setPaste(false)} onDone={done} />}
    </div>
  );
}
