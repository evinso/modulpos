import { useState } from 'react';
import { TrendingUp, AlertTriangle } from 'lucide-react';

const money = (n) => (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (n) => (Number(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
const earnClass = (n) => (n > 0 ? 'var(--success)' : n < 0 ? 'var(--danger)' : 'var(--text-muted)');

export const bandLabel = (b) => (b.to === null ? `₺${short(b.from)} üstü` : `₺${short(b.from)} – ₺${short(b.to)}`);

/**
 * Result of a template over the user's real products: totals, a table per purchase-price band
 * (boundaries chosen by the server from the products themselves), warnings and an optional single-product try-out.
 */
export default function CoveragePanel({ summary, preview, previewError, samplePrice, setSamplePrice, previewVat, rowsIncomplete }) {
  const [showLosers, setShowLosers] = useState(false);
  const [showTry, setShowTry] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const hasShipTiers = !!summary && summary.bands.some((b) => b.shippingTier);

  return (
    <div data-testid="coverage-panel" style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <TrendingUp size={18} style={{ color: 'var(--success)' }} />
        <strong style={{ fontSize: 14 }}>Ürünlerinizde ne olur?</strong>
      </div>

      {rowsIncomplete && <p style={{ color: 'var(--warning)', fontSize: 12, margin: '0 0 10px' }}>Kademe tablosunu tamamlayınca hesap buna göre güncellenir.</p>}

      {!summary && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Kâr değerini girince şablonun ürünlerinize etkisi burada görünür.</p>}

      {summary && summary.covered === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {summary.total === 0 ? 'Henüz ürününüz yok. XML ekleyince burada tüm ürünlerinizin kazancı görünür; aşağıdan tek bir fiyatla deneyebilirsiniz.' : 'Bu ayarlarla eşleşen ürün yok.'}
        </p>
      )}

      {summary && summary.covered > 0 && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Ürünlerinizden <strong>{summary.covered}</strong> / {summary.total} tanesine uygulanır. Hepsi satılırsa:
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '2px 0 12px' }}>
            <span data-testid="total-profit" style={{ fontSize: 24, fontWeight: 800, color: earnClass(summary.totalProfit) }}>₺{money(summary.totalProfit)}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>net kazanç · satış fiyatının ortalama %{summary.marginOnPricePct}’i</span>
          </div>

          <div className="table-container" style={{ marginBottom: 10 }}>
            <table data-testid="bands" style={{ fontSize: 12 }}>
              <thead><tr>
                <th>Alış fiyatı</th><th style={{ textAlign: 'right' }}>Ürün</th><th style={{ textAlign: 'right' }}>Satış</th>
                {hasShipTiers && <th>Kargo</th>}
                <th style={{ textAlign: 'right' }}>Net kazanç</th><th style={{ textAlign: 'right' }}>Marj</th>
              </tr></thead>
              <tbody>
                {summary.bands.map((b) => (
                  <tr key={b.from}>
                    <td>{bandLabel(b)}</td>
                    <td style={{ textAlign: 'right' }}>{b.count}</td>
                    <td style={{ textAlign: 'right' }}>₺{short(b.avgPrice)}</td>
                    {hasShipTiers && <td>{b.shippingTier ? `${b.shippingTier}. satır${b.mixedTiers ? '*' : ''}` : '—'}</td>}
                    <td style={{ textAlign: 'right', color: earnClass(b.avgProfit), fontWeight: 600 }}>₺{money(b.avgProfit)}</td>
                    <td style={{ textAlign: 'right', color: earnClass(b.marginOnPricePct) }}>%{b.marginOnPricePct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Fiyatlar bandın ortalamasıdır; aralıklar ürünlerinizin dağılımına göre otomatik seçilir.
            {summary.bands.some((b) => b.mixedTiers) && ' * Bandın içinde farklı kargo satırlarına düşen ürünler var.'}
          </div>

          {summary.losing > 0 && (
            <div style={{ marginTop: 10 }}>
              <button type="button" data-testid="show-losers" onClick={() => setShowLosers(!showLosers)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--danger)', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'inherit' }}>
                <AlertTriangle size={14} /> {summary.losing} üründe zarar edersiniz {showLosers ? '▴' : '▾ listele'}
              </button>
              {showLosers && (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {summary.losingSamples.map((p) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{p.title}</span>
                      <span style={{ whiteSpace: 'nowrap', color: 'var(--danger)' }}>alış ₺{money(p.purchase)} → satış ₺{money(p.price)} ({p.profit < 0 ? '−' : ''}₺{money(Math.abs(p.profit))})</span>
                    </div>
                  ))}
                  {summary.losing > summary.losingSamples.length && <div style={{ color: 'var(--text-muted)' }}>…ve {summary.losing - summary.losingSamples.length} ürün daha (en çok zarar edenler gösteriliyor)</div>}
                </div>
              )}
            </div>
          )}
          {summary.unpriced > 0 && (
            <div style={{ marginTop: 6, color: 'var(--warning)', fontSize: 12 }}>{summary.unpriced} ürün için fiyat hesaplanamadı (komisyon çok yüksek olabilir).</div>
          )}
        </>
      )}

      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
        <button type="button" data-testid="open-try" onClick={() => setShowTry(!showTry)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary)', fontSize: 12, fontFamily: 'inherit' }}>
          {showTry ? '▾' : '▸'} Tek bir fiyatla dene
        </button>
        {showTry && (
          <div style={{ marginTop: 8 }}>
            <label className="form-label">Alış fiyatı (₺)</label>
            <input type="number" min="0" step="0.01" className="form-input" value={samplePrice} onChange={(e) => setSamplePrice(e.target.value)} />
            {previewError && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{previewError}</p>}
            {preview && (
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <div data-testid="try-result">Satış fiyatı <strong>₺{money(preview.price)}</strong> · net kazanç <strong style={{ color: earnClass(preview.profit) }}>₺{money(preview.profit)}</strong> (satışın %{preview.marginOnPricePct}’i)</div>
                {(preview.shippingTier || preview.profitTier) && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {preview.shippingTier ? `Uygulanan kargo: ${preview.shippingTier}. satır (₺${money(preview.shippingCost)})` : ''}
                    {preview.shippingTier && preview.profitTier ? ' · ' : ''}
                    {preview.profitTier ? `Uygulanan kâr: ${preview.profitTier}. satır` : ''}
                  </div>
                )}
                <button type="button" onClick={() => setShowCalc(!showCalc)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, marginTop: 4, fontFamily: 'inherit' }}>
                  {showCalc ? '▾' : '▸'} Hesabı göster
                </button>
                {showCalc && [
                  ['Satış fiyatı (KDV dahil)', `₺${money(preview.price)}`],
                  [`KDV (%${previewVat})`, `−₺${money(preview.vatAmount)}`],
                  ['Komisyon', `−₺${money(preview.commissionAmount)}`],
                  ['Kargo ve diğer giderler', `−₺${money(preview.fixedCosts)}`],
                  ['Alış fiyatı', `−₺${money(preview.purchase)}`],
                  ['Elinize kalan', `₺${money(preview.profit)}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}><span style={{ color: 'var(--text-secondary)' }}>{k}</span><span>{v}</span></div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 0' }}>
        Satış KDV’si ürünün XML kaynağındaki orandan alınır; komisyon KDV dahil satış fiyatı üzerinden hesaplanır. Rakamlar tahmindir (iade, indirim ve kampanyalar dahil değil).
      </p>
    </div>
  );
}
