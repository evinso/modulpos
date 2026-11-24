import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import api from '../../services/api';
import HandGrid from './HandGrid';
import ProductCategoriesSection from '../marketplaces/productcat/ProductCategoriesSection';
import { priceKind } from './priceKind';

const muted = { fontSize: 12, color: 'var(--text-muted)' };

function Step({ ok, title, detail, action }) {
  return (
    <div className="card" data-testid="hand-step" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      {ok ? <CheckCircle2 size={18} style={{ color: 'var(--success, #16a34a)', flex: 'none' }} /> : <CircleAlert size={18} style={{ color: 'var(--warning)', flex: 'none' }} />}
      <div style={{ minWidth: 0 }}><strong style={{ fontSize: 13 }}>{title}</strong><div style={muted}>{detail}</div>{action}</div>
    </div>
  );
}

/**
 * The workspace of the products ADDED BY HAND. They have no XML to bring their data, so everything is typed here: the net amount you keep per sale, the stock, the brand, the barcode; the Trendyol category and the price template
 * are the two things that make a price and a category for the marketplace, and this page shows where each one stands and takes you to it. Three tabs: the table with bulk changes, the Trendyol category, the price template.
 */
export default function HandProductsPage() {
  const [params, setParams] = useSearchParams(); const tab = ['products', 'category', 'price'].includes(params.get('tab')) ? params.get('tab') : 'products';
  const setTab = (t) => setParams(t === 'products' ? {} : { tab: t });
  const [conns, setConns] = useState(null); const [connId, setConnId] = useState('');
  const [summary, setSummary] = useState(null); const [filter, setFilter] = useState('all');
  useEffect(() => { api.get('/marketplace/connections').then((r) => { const t = (r.data || []).filter((c) => c.marketplaceType === 'trendyol'); setConns(t); if (t[0]) setConnId(t[0].id); }).catch(() => setConns([])); }, []);
  // the numbers above the tabs come from the server whatever tab is open (a link can open the page on the price tab), and again whenever a tab is opened (the other tabs change them)
  useEffect(() => {
    if (conns === null) return;
    api.get('/hand-products', { params: { limit: 1, connectionId: connId || undefined } }).then((r) => setSummary(r.data.summary)).catch(() => {});
  }, [conns, connId, tab]);
  const s = summary; const pk = priceKind(s && s.template);
  const show = (f) => { setFilter(f); setTab('products'); };

  return (
    <div>
      <div className="page-title"><h1>Elle eklenen ürünler</h1><p>XML’den gelmeyen, kendiniz eklediğiniz ürünler. Verileri otomatik güncellenmediği için fiyat (alış fiyatı ya da net tutar), stok, marka ve kategori burada elle (tek tek ya da toplu) girilir.</p></div>

      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginBottom: 14 }} data-testid="hand-steps">
          <Step ok={s.total > 0} title={`${s.total} ürün`} detail={s.noImage > 0 ? `${s.noImage} ürünün fotoğrafı yok (Trendyol kabul etmez)` : 'Hepsinin fotoğrafı var'} action={s.noImage > 0 && <button type="button" className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 11.5, marginTop: 4 }} onClick={() => show('no_image')}>Göster</button>} />
          <Step ok={s.total > 0 && s.noPrice === 0} title={`${pk.label}: ${s.total - s.noPrice} / ${s.total}`} detail={s.noPrice > 0 ? `${s.noPrice} ürünün ${pk.lower} girilmemiş (fiyatı hesaplanamaz)` : 'Hepsi girilmiş'} action={s.noPrice > 0 && <button type="button" className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 11.5, marginTop: 4 }} onClick={() => show('no_price')}>Göster</button>} />
          <Step ok={s.total > 0 && s.noStock === 0 && s.noBrand === 0 && s.noBarcode === 0} title="Stok, marka, barkod" detail={`${s.noStock} stoksuz · ${s.noBrand} markasız · ${s.noBarcode} barkodsuz`} action={(s.noStock + s.noBrand + s.noBarcode) > 0 && <button type="button" className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 11.5, marginTop: 4 }} onClick={() => show(s.noBrand ? 'no_brand' : s.noBarcode ? 'no_barcode' : 'no_stock')}>Göster</button>} />
          <Step ok={s.noCategory === 0 && s.total > 0} title={s.noCategory === null ? 'Trendyol kategorisi' : `Trendyol kategorisi: ${s.total - s.noCategory} / ${s.total}`} detail={s.noCategory === null ? 'Trendyol bağlantısı yok' : s.noCategory > 0 ? `${s.noCategory} ürüne kategori atanmamış` : 'Hepsine atanmış'} action={s.noCategory > 0 && <button type="button" className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 11.5, marginTop: 4 }} onClick={() => setTab('category')}>Kategori ata</button>} />
          <Step ok={s.template.exists && s.template.active} title="Fiyat şablonu" detail={!s.template.exists ? 'Yok: pazaryeri fiyatı hesaplanamaz' : s.template.active ? `“${s.template.name}” çalışıyor` : `“${s.template.name}” pasif`} action={<button type="button" className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 11.5, marginTop: 4 }} onClick={() => setTab('price')}>{s.template.exists ? 'Şablon' : 'Şablonu oluştur'}</button>} />
        </div>
      )}

      <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        {[['products', 'Ürünler ve toplu düzenleme'], ['category', 'Trendyol kategorisi'], ['price', 'Fiyat şablonu']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} data-testid={`tab-${k}`} className={`btn ${tab === k ? 'btn-primary' : 'btn-secondary'}`} style={{ boxShadow: 'none' }} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'products' && conns !== null && <HandGrid connId={connId} pk={pk} filter={filter} setFilter={setFilter} onSummary={setSummary} onOpenCategories={() => setTab('category')} />}

      {tab === 'category' && (
        <div data-testid="tab-category-body">
          {conns === null ? <p style={muted}>Yükleniyor…</p> : conns.length === 0 ? <div className="card" style={{ padding: 16 }}>Trendyol kategorisi seçebilmek için önce <Link to="/marketplace">Pazaryeri Bağlantıları</Link> sayfasında bir Trendyol bağlantısı ekleyin.</div> : (
            <>
              {conns.length > 1 && <div className="form-group" style={{ maxWidth: 320 }}><label className="form-label">Trendyol bağlantısı</label><select className="form-select" value={connId} onChange={(e) => setConnId(e.target.value)}>{conns.map((c) => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId || c.id}</option>)}</select></div>}
              <ProductCategoriesSection key={connId} connId={connId} srcId="none" />
            </>)}
        </div>
      )}

      {tab === 'price' && (
        <div className="card" data-testid="tab-price-body" style={{ padding: 16, display: 'grid', gap: 10, maxWidth: 780 }}>
          <strong>Fiyat şablonu: elle eklenen ürünler için</strong>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Elle eklenen ürünler XML kaynağına bağlı olmadığı için şablonları ayrı bir kapsamla, <strong>“Elle eklenen ürünler”</strong> kapsamıyla kurulur (şablon ekranında “XML kaynağı” kutusundan seçilir). Üründeki tek sayıyı şablon yorumlar; üç seçenek var:
          </p>
          <ul style={{ margin: '0 0 0 18px', padding: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <li><strong>Alış fiyatı + kâr</strong> (XML ürünleri gibi): ürüne alış fiyatınızı yazarsınız, kârı şablonda yüzde, tutar ya da alış fiyatına göre kademeli verirsiniz.</li>
            <li><strong>Alış fiyatı, kâr 0</strong>: yazdığınız alış fiyatı kadar kazanç olmaz, yalnızca masraflar karşılanır.</li>
            <li><strong>Elime kalacak net tutar</strong>: komisyon, kargo, hizmet bedeli, stopaj ve KDV düşüldükten sonra elinize tam o tutar kalsın.</li>
          </ul>
          <div style={{ fontSize: 13 }}>{!s ? '…' : !s.template.exists ? <span style={{ color: 'var(--warning)' }}>Henüz elle eklenen ürünler için bir şablonunuz yok.</span> : <span style={{ color: s.template.active ? 'var(--success, #16a34a)' : 'var(--warning)' }}>“{s.template.name}” şablonu {s.template.active ? 'çalışıyor' : 'var ama pasif'}: ürünlerdeki sayı <strong>{pk.label.toLowerCase()}</strong> olarak okunuyor.</span>}</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>Şablonu değiştirirseniz ürünlerdeki aynı sayılar başka bir anlam kazanır (alış fiyatı ↔ net tutar) ve pazaryeri fiyatları değişir; değiştirmeden önce “Ürünler” sekmesinde “Pazaryeri fiyatı” sütununa bakın.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn btn-primary" data-testid="open-template" to={s && s.template.exists ? '/pricing?hand=1' : '/pricing?hand=1&mode=profit'}>{s && s.template.exists ? 'Şablonu aç' : 'Alış fiyatı + kâr şablonunu oluştur'}</Link>
            <button type="button" className="btn btn-secondary" onClick={() => setTab('products')}>Ürünlere dön</button>
          </div>
        </div>
      )}
    </div>
  );
}
