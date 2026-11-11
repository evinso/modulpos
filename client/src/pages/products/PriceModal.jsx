import { useEffect, useState } from 'react';
import { Send, AlertTriangle, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { Thumb, parseImages, money } from './productsUi';
import { pushToMarketplace, sendLabel, errorText } from './priceActions';

/**
 * Change the sale price of ONE product on ONE marketplace and, if wanted, send it right away.
 * The price is stored per marketplace; it wins over the price template until "back to template" is pressed.
 */
export default function PriceModal({ product, connection, onClose, onDone }) {
  const pr = product.pricing || {};
  const listing = (product.marketplaceProducts || []).find((m) => m.connectionId === connection.id) || null;
  const [value, setValue] = useState(pr.salePrice != null ? String(pr.salePrice) : '');
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const num = parseFloat(String(value).replace(',', '.'));
  const valid = Number.isFinite(num) && num > 0;
  const templatePrice = pr.manual ? pr.templatePrice : pr.salePrice;
  const label = sendLabel(listing);
  const canSend = connection.marketplaceType === 'trendyol' && !!label;

  // what the typed price would earn – asks the same engine that prices everything
  useEffect(() => {
    if (!valid) { setPreview(null); setPreviewErr(''); return undefined; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.get(`/products/${product.id}/price-preview`, { params: { connectionId: connection.id, price: num } });
        if (alive) { setPreview(r.data); setPreviewErr(''); }
      } catch (e) { if (alive) { setPreview(null); setPreviewErr(errorText(e, 'Hesaplanamadı')); } }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setAck(false); }, [value]);
  const loss = !!(preview && preview.loss);

  const save = async () => {
    await api.put(`/products/${product.id}/sale-price`, { connectionId: connection.id, price: num, confirmLoss: loss && ack });
  };

  const run = async (send) => {
    setErr('');
    if (!valid) { setErr('Geçerli bir satış fiyatı girin'); return; }
    if (loss && !ack) { setErr('Bu fiyatta zarar ediyorsunuz. Devam etmek için aşağıdaki kutuyu işaretleyin.'); return; }
    setBusy(true);
    try {
      await save();
    } catch (e) {
      setBusy(false);
      setErr(errorText(e, 'Fiyat kaydedilemedi'));
      return;
    }
    if (!send) { toast.success('Satış fiyatı kaydedildi'); setBusy(false); onDone(); return; }
    try {
      const r = await pushToMarketplace(product.id, connection, listing);
      if (r.kind === 'update' || r.kind === 'create') toast.success(r.message); else toast(r.message, { icon: 'ℹ️', duration: 6000 });
    } catch (e) {
      toast.error(`Fiyat kaydedildi ama gönderilemedi: ${errorText(e, 'Gönderim hatası')}`, { duration: 9000 });
    }
    setBusy(false); onDone();
  };

  const backToTemplate = async () => {
    setBusy(true); setErr('');
    try {
      await api.delete(`/products/${product.id}/sale-price`, { params: { connectionId: connection.id } });
      toast.success('Şablon fiyatına dönüldü'); setBusy(false); onDone();
    } catch (e) { setBusy(false); setErr(errorText(e, 'İşlem başarısız')); }
  };

  const img = parseImages(product.images)[0];
  const earn = (n) => (n > 0 ? 'var(--success)' : n < 0 ? 'var(--danger)' : 'var(--text-muted)');

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal" data-testid="price-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>Satış fiyatı — {connection.supplierName || connection.marketplaceType}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Thumb src={img} size={46} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35 }}>{product.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{product.sku}{product.barcode && product.barcode !== product.sku ? ` · ${product.barcode}` : ''}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
            {[
              ['Alış fiyatı', product.xmlPrice > 0 ? `₺${money(product.xmlPrice)}` : '—'],
              ['Şablon fiyatı', templatePrice != null ? `₺${money(templatePrice)}` : 'Şablon yok'],
              [`${connection.supplierName || connection.marketplaceType}’daki fiyat`, listing && listing.status === 'active' && listing.marketplacePrice != null ? `₺${money(listing.marketplacePrice)}` : (listing ? 'Henüz satışta değil' : 'Gönderilmedi')],
            ].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{k}</div>
                <div data-testid="info-value" style={{ fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Yeni satış fiyatı (₺, KDV dahil)</label>
            <input type="text" inputMode="decimal" className="form-input" data-testid="price-input" autoFocus value={value}
              onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(false); }} />
          </div>

          <div data-testid="price-preview" style={{ minHeight: 44, fontSize: 13 }}>
            {previewErr && <span style={{ color: 'var(--danger)' }}>{previewErr}</span>}
            {preview && !previewErr && (preview.profit != null ? (
              <div>
                <span style={{ color: earn(preview.profit), fontWeight: 700 }}>{preview.profit >= 0 ? 'Net kazanç' : 'Net zarar'}: {preview.profit < 0 ? '−' : ''}₺{money(Math.abs(preview.profit))}</span>
                <span style={{ color: 'var(--text-muted)' }}> · satışın %{preview.marginOnPricePct}’i · alışın %{preview.profitPct}’i</span>
                {preview.breakdown && preview.breakdown.taxModel ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Komisyon ₺{money(preview.commissionAmount)}{preview.breakdown.serviceFee > 0 ? ` · hizmet bedeli ₺${money(preview.breakdown.serviceFee)}` : ''}{preview.breakdown.withholding > 0 ? ` · stopaj ₺${money(preview.breakdown.withholding)}` : ''} · ödenecek KDV ₺{money(preview.breakdown.payableVat)} · kargo ve diğer ₺{money(preview.breakdown.shippingCost + (preview.breakdown.otherCost || 0))} düşüldü
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Komisyon ₺{money(preview.commissionAmount)} · KDV ₺{money(preview.vatAmount)} · kargo ve diğer ₺{money(preview.fixedCosts)} düşüldü</div>
                )}
              </div>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>Bu ürüne uyan fiyat şablonu olmadığı için kazanç hesaplanamıyor.{preview.loss ? ' Bu fiyat alış fiyatının altında.' : ''}</span>
            ))}
          </div>

          {loss && (
            <label data-testid="loss-ack" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--danger)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 10px' }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 3 }} />
              <span><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Bu fiyatta zarar ediyorum, yine de kaydet.</span>
            </label>
          )}
          {err && <div data-testid="price-error" style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
          {!canSend && listing && listing.status === 'pending' && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ürün Trendyol’da onay bekliyor; fiyat kaydedilir, onaylanınca gönderebilirsiniz.</div>}
          {!canSend && listing && listing.status === 'passive' && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ürün Trendyol’da satışta değil; önce Trendyol panelinden düzeltmeniz gerekir. Fiyat yine de kaydedilir.</div>}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            {pr.manual && (
              <button type="button" className="btn btn-secondary" data-testid="back-to-template" disabled={busy} onClick={backToTemplate} title="Elle girilen fiyatı kaldırır">
                <RotateCcw size={14} /> Şablon fiyatına dön
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
            <button type="button" className="btn btn-secondary" data-testid="save-only" onClick={() => run(false)} disabled={busy || !valid}>Sadece kaydet</button>
            {canSend && (
              <button type="button" className="btn btn-primary" data-testid="save-send" onClick={() => run(true)} disabled={busy || !valid}>
                <Send size={14} /> Kaydet ve {label}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
