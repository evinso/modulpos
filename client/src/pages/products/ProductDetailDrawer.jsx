import { useState, useEffect } from 'react';
import { X, Edit, Trash2, AlertTriangle, CheckCircle2, ArrowUp, ArrowDown, Sparkles, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import { Thumb, Pill, StockPill, StatusPill, Field, money, dateTime, MP_STATUS, ISSUE_LABELS } from './productsUi';

const TABS = [
  { key: 'general', label: 'Genel' },
  { key: 'price', label: 'Fiyat ve kâr' },
  { key: 'market', label: 'Pazaryeri' },
  { key: 'xml', label: 'XML karşılaştırma' },
  { key: 'history', label: 'Geçmiş' },
];

const earn = (n) => (n > 0 ? 'var(--success)' : n < 0 ? 'var(--danger)' : 'var(--text-muted)');

export default function ProductDetailDrawer({ productId, onClose, onEdit, onDelete }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('general');
  const [imgIndex, setImgIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null); setError(''); setTab('general'); setImgIndex(0);
    api.get(`/products/${productId}/detail`)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setError(e.response?.data?.error || 'Ürün detayı yüklenemedi'); });
    return () => { alive = false; };
  }, [productId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const p = data?.product;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }}>
      <aside onClick={(e) => e.stopPropagation()} style={{
        width: 'min(760px, 100vw)', background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)',
        display: 'flex', flexDirection: 'column', height: '100vh', boxShadow: '-12px 0 40px rgba(0,0,0,0.35)',
      }}>
        {/* header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <Thumb src={p?.images?.[0]} size={56} radius={10} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {p ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{p.title}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{p.sku}</span>
                  <StatusPill status={p.status} />
                  <StockPill stock={p.stock} />
                  {data.product.xmlSource && <Pill color="var(--info)">{data.product.xmlSource.name}</Pill>}
                </div>
              </>
            ) : <div style={{ color: 'var(--text-muted)' }}>{error || 'Yükleniyor…'}</div>}
          </div>
          <button onClick={onClose} aria-label="Kapat" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
        </div>

        {/* tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '0 12px', borderBottom: '1px solid var(--border-color)', overflowX: 'auto' }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '11px 14px', fontSize: 13, fontWeight: tab === t.key ? 700 : 500, whiteSpace: 'nowrap', cursor: 'pointer',
              color: tab === t.key ? 'var(--accent-primary)' : 'var(--text-secondary)', background: 'none', border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
            }}>{t.label}</button>
          ))}
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {!data && !error && <div className="loading-spinner"><div className="spinner"></div></div>}
          {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
          {data && tab === 'general' && <General data={data} imgIndex={imgIndex} setImgIndex={setImgIndex} />}
          {data && tab === 'price' && <PriceTab data={data} />}
          {data && tab === 'market' && <MarketTab data={data} />}
          {data && tab === 'xml' && <XmlTab data={data} />}
          {data && tab === 'history' && <HistoryTab logs={data.logs} />}
        </div>

        {/* footer */}
        {p && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(p)}><Trash2 size={14} /> Sil</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>Kapat</button>
              <button className="btn btn-primary btn-sm" onClick={() => onEdit(p)}><Edit size={14} /> Düzenle</button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children, hint }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  );
}

function General({ data, imgIndex, setImgIndex }) {
  const p = data.product;
  const [showAll, setShowAll] = useState(false);
  const crumbs = String(p.category || '').split('|').map((x) => x.trim()).filter(Boolean);
  const desc = p.description || '';
  return (
    <>
      <Section title={`Görseller (${p.images.length})`}>
        {p.images.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--warning)', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={14} /> Bu ürünün görseli yok; pazaryerine gönderilemez.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14, alignItems: 'start' }}>
            <div style={{ width: 220, height: 220, borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src={p.images[imgIndex]} alt="" referrerPolicy="no-referrer" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {p.images.map((src, i) => (
                <button key={src + i} onClick={() => setImgIndex(i)} style={{ padding: 0, border: i === imgIndex ? '2px solid var(--accent-primary)' : '2px solid transparent', borderRadius: 10, background: 'none', cursor: 'pointer' }}>
                  <Thumb src={src} size={54} radius={8} />
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Ürün bilgileri">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 14 }}>
          <Field label="SKU"><span style={{ fontFamily: 'monospace' }}>{p.sku}</span></Field>
          <Field label="Barkod"><span style={{ fontFamily: 'monospace' }}>{p.barcode || '—'}</span></Field>
          <Field label="Marka">{p.brand || '—'}</Field>
          <Field label="Stok">{p.stock}</Field>
          <Field label="Satış KDV’si">%{p.vatRate}</Field>
          <Field label="Desi / ağırlık">{p.desi ?? '—'} / {p.weight ?? '—'}</Field>
          <Field label="Eklenme">{dateTime(p.createdAt)}</Field>
          <Field label="Son güncelleme">{dateTime(p.updatedAt)}</Field>
          <Field label="XML kaynağı">{p.xmlSource ? `${p.xmlSource.name} (son senkron ${dateTime(p.xmlSource.lastSyncedAt)})` : 'Elle eklendi'}</Field>
        </div>
      </Section>

      <Section title="Kategori">
        {crumbs.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 13 }}>
            {crumbs.map((c, i) => (<span key={c + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{i > 0 && <span style={{ color: 'var(--text-muted)' }}>›</span>}<Pill>{c}</Pill></span>))}
          </div>
        ) : <span style={{ color: 'var(--warning)', fontSize: 13 }}>Kategori yok</span>}
      </Section>

      <Section title="Açıklama">
        {desc ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.55, maxHeight: showAll ? 'none' : 120, overflow: 'hidden' }}>{desc}</div>
            {desc.length > 300 && <button onClick={() => setShowAll(!showAll)} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 12, padding: '6px 0' }}>{showAll ? 'Daha az göster' : 'Tamamını göster'}</button>}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{desc.length} karakter</div>
          </>
        ) : <span style={{ color: 'var(--warning)', fontSize: 13 }}>Açıklama yok; pazaryerine gönderilemez.</span>}
      </Section>
    </>
  );
}

function PriceTab({ data }) {
  const p = data.product;
  return (
    <>
      <Section title="Fiyat bilgileri">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
          <Field label="Alış fiyatı (XML)">₺{money(p.xmlPrice)}</Field>
          <Field label="Kayıtlı fiyat">₺{money(p.price)}{Math.abs(p.price - p.xmlPrice) > 0.005 && <Pill color="var(--info)" style={{ marginLeft: 6 }}>elle</Pill>}</Field>
          <Field label="Liste fiyatı">{p.listPrice ? `₺${money(p.listPrice)}` : '—'}</Field>
          <Field label="Maliyet">{p.cost ? `₺${money(p.cost)}` : '—'}</Field>
        </div>
        {data.product.xmlSource && Number(data.product.xmlSource.purchaseVatRate) > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Alış fiyatına XML kaynağındaki %{data.product.xmlSource.purchaseVatRate} alış KDV’si eklenmiştir.</div>
        )}
      </Section>

      {data.marketplaces.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Henüz pazaryeri bağlantınız yok.</div>}
      {data.marketplaces.map((m) => (
        <div key={m.connectionId} className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>{m.name}</strong>
            {m.pricing ? <Pill color="var(--accent-primary)">{m.pricing.rule}</Pill> : <Pill color="var(--danger)">Şablon yok</Pill>}
          </div>
          {!m.pricing ? (
            <div style={{ fontSize: 13, color: 'var(--warning)' }}>Bu ürüne uyan bir fiyat şablonu yok. <a href="/pricing">Fiyat Şablonları</a> sayfasından ekleyin.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Satış fiyatı</div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>₺{money(m.pricing.salePrice)}</div>
                </div>
                <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Net kazancınız</div>
                  {m.pricing.breakdown ? (
                    <>
                      <div style={{ fontSize: 22, fontWeight: 800, color: earn(m.pricing.breakdown.profit) }}>₺{money(m.pricing.breakdown.profit)}</div>
                      <div style={{ fontSize: 11, color: earn(m.pricing.breakdown.profit) }}>alışın %{m.pricing.breakdown.profitPct}’i</div>
                    </>
                  ) : <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{m.pricing.manual ? 'Şablon olmadığı için kâr hesaplanamadı' : 'Eski tip kural: kâr dökümü yok'}</div>}
                </div>
              </div>
              {m.pricing.manual && (
                <div data-testid="manual-note" style={{ marginBottom: 10, fontSize: 12, color: 'var(--warning)' }}>
                  Bu fiyatı siz elle girdiniz{m.pricing.templatePrice != null ? `; şablon fiyatı ₺${money(m.pricing.templatePrice)}` : ''}. Ürünler sayfasında “Şablon fiyatına dön” ile kaldırabilirsiniz.
                </div>
              )}
              {m.pricing.breakdown && (
                <div>
                  {[
                    ['Satış fiyatı (KDV dahil)', `₺${money(m.pricing.salePrice)}`],
                    [`KDV (%${m.pricing.vatRate})`, `−₺${money(m.pricing.breakdown.vatAmount)}`],
                    ['Komisyon', `−₺${money(m.pricing.breakdown.commissionAmount)}`],
                    ['Kargo ve diğer giderler', `−₺${money(m.pricing.breakdown.fixedCosts)}`],
                    ['Alış fiyatı', `−₺${money(m.pricing.breakdown.purchase)}`],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{k}</span><span>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14, borderTop: '1px solid var(--border-color)', marginTop: 6, paddingTop: 8 }}>
                    <span>Elinize kalan</span><span style={{ color: earn(m.pricing.breakdown.profit) }}>₺{money(m.pricing.breakdown.profit)}</span>
                  </div>
                </div>
              )}
              {m.listing && m.listing.marketplacePrice != null && Math.abs(m.listing.marketplacePrice - m.pricing.salePrice) > 0.005 && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--warning)', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <AlertTriangle size={14} /> {m.name}’da şu an ₺{money(m.listing.marketplacePrice)} görünüyor; hesaplanan fiyatla farklı. Fiyatı güncellemek için “Trendyol fiyat/stok gönder” işlemini kullanın.
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}

function MarketTab({ data }) {
  if (data.marketplaces.length === 0) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Henüz pazaryeri bağlantınız yok.</div>;
  return data.marketplaces.map((m) => {
    const st = m.listing ? (MP_STATUS[m.listing.status] || { label: m.listing.status, color: 'var(--text-secondary)' }) : null;
    return (
      <div key={m.connectionId} className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>{m.name}</strong>
          {st ? <Pill color={st.color}>{st.label}</Pill> : <Pill>Gönderilmedi</Pill>}
        </div>

        {m.listing && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 14, marginBottom: 12 }}>
            <Field label="Pazaryerindeki fiyat">{m.listing.marketplacePrice != null ? `₺${money(m.listing.marketplacePrice)}` : '—'}</Field>
            <Field label="Pazaryerindeki stok">{m.listing.marketplaceStock ?? '—'}</Field>
            <Field label="Son senkron">{dateTime(m.listing.lastSyncedAt)}</Field>
          </div>
        )}
        {m.listing?.errorMessage && (
          <div style={{ fontSize: 12, color: 'var(--danger)', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
            <strong>Pazaryeri mesajı:</strong> {m.listing.errorMessage}
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Gönderime hazır mı?</div>
        {m.ready ? (
          <div style={{ fontSize: 13, color: 'var(--success)', display: 'flex', gap: 6, alignItems: 'center' }}><CheckCircle2 size={16} /> Evet, tüm kontroller geçti.</div>
        ) : (
          <div>
            {m.issues.map((i) => (
              <div key={i.code} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, padding: '4px 0' }}>
                <AlertTriangle size={14} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div><strong>{ISSUE_LABELS[i.code] || i.code}</strong><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{i.message}</div></div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
          Trendyol kategorisi: {m.categoryMapping ? <strong style={{ color: 'var(--text-primary)' }}>{m.categoryMapping}</strong> : <>eşleşme yok — <a href="/category-mapping">Kategori Eşleştirme</a></>}
        </div>
      </div>
    );
  });
}

function XmlTab({ data }) {
  const p = data.product;
  if (data.feedHidden) {
    return <div style={{ fontSize: 13, color: 'var(--accent-primary)' }}>✨ Bu ürün tedarikçi havuzundan eklendi; orijinal XML verileri gizlidir.</div>;
  }
  if (!data.feed) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Bu ürün elle eklendi; karşılaştırılacak XML verisi yok.</div>;
  const f = data.feed;
  const rows = [
    ['SKU', f.sku, p.sku], ['Barkod', f.barcode, p.barcode], ['Ürün adı', f.title, p.title],
    ['Fiyat', f.price != null ? `₺${money(f.price)}` : null, `₺${money(p.price)}`],
    ['Stok', f.stock, p.stock], ['Marka', f.brand, p.brand], ['Kategori', f.category, p.category],
    ['Liste fiyatı', f.listPrice ? `₺${money(f.listPrice)}` : null, p.listPrice ? `₺${money(p.listPrice)}` : null],
    ['Görsel sayısı', Array.isArray(f.images) ? f.images.length : null, p.images.length],
  ];
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Soldaki değerler XML’den geldiği gibi saklanır, hiç değiştirilmez. Sağdaki, sistemin kullandığı değerdir (KDV, başlık ayarı, elle düzenleme vb. sonrası).</div>
      <table>
        <thead><tr><th>Alan</th><th>XML (orijinal)</th><th>Sistemde</th><th></th></tr></thead>
        <tbody>
          {rows.map(([label, xml, mine]) => {
            const changed = String(xml ?? '') !== String(mine ?? '');
            return (
              <tr key={label}>
                <td style={{ fontWeight: 600, fontSize: 13 }}>{label}</td>
                <td style={{ fontSize: 13, color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{xml ?? '—'}</td>
                <td style={{ fontSize: 13, fontWeight: changed ? 600 : 400, color: changed ? 'var(--accent-primary)' : undefined, wordBreak: 'break-word' }}>{mine ?? '—'}</td>
                <td>{changed ? <Pill color="var(--accent-primary)">Değişti</Pill> : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Aynı</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function HistoryTab({ logs }) {
  if (!logs || logs.length === 0) {
    return <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>Henüz geçmiş kaydı yok. XML senkronunda fiyat veya stok değiştiğinde burada görünür.</div>;
  }
  return (
    <div>
      {logs.map((log, i) => {
        const created = log.type === 'created';
        const priceUp = log.newPrice != null && log.oldPrice != null && log.newPrice > log.oldPrice;
        const priceDown = log.newPrice != null && log.oldPrice != null && log.newPrice < log.oldPrice;
        const stockUp = log.newStock != null && log.oldStock != null && log.newStock > log.oldStock;
        const stockDown = log.newStock != null && log.oldStock != null && log.newStock < log.oldStock;
        return (
          <div key={log.id} style={{ display: 'flex', gap: 12, paddingBottom: 16, position: 'relative' }}>
            {i < logs.length - 1 && <div style={{ position: 'absolute', left: 15, top: 32, bottom: 0, width: 2, background: 'var(--border-color)' }} />}
            <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: created ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.1)', border: `2px solid ${created ? 'var(--success)' : 'var(--accent-primary)'}` }}>
              {created ? <Sparkles size={14} color="var(--success)" /> : <RefreshCw size={13} color="var(--accent-primary)" />}
            </div>
            <div style={{ flex: 1, paddingTop: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <Pill color={created ? 'var(--success)' : 'var(--accent-primary)'}>{created ? 'Ürün eklendi' : 'Senkronize edildi'}</Pill>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dateTime(log.createdAt)}</span>
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
                {log.newPrice != null && log.oldPrice == null && <span>Fiyat: <strong>₺{money(log.newPrice)}</strong></span>}
                {log.newPrice != null && log.oldPrice != null && (
                  <span>₺{money(log.oldPrice)} → <strong style={{ color: priceUp ? 'var(--danger)' : priceDown ? 'var(--success)' : undefined }}>₺{money(log.newPrice)}</strong> {priceUp && <ArrowUp size={11} color="var(--danger)" />}{priceDown && <ArrowDown size={11} color="var(--success)" />}</span>
                )}
                {log.newStock != null && log.oldStock == null && <span>Stok: <strong>{log.newStock}</strong></span>}
                {log.newStock != null && log.oldStock != null && (
                  <span>Stok {log.oldStock} → <strong style={{ color: stockUp ? 'var(--success)' : stockDown ? 'var(--danger)' : undefined }}>{log.newStock}</strong></span>
                )}
              </div>
              {log.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{log.notes}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
