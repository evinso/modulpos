import { useState } from 'react';

const money = (n) => (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Where a sale price goes. Same list as a marketplace profit screen when the template has the VAT/stopaj options
 * (Komisyon, Hizmet bedeli, Stopaj, Ödenecek KDV, Kargo, Alış maliyeti, Net kâr + "KDV dökümü"); the earlier list otherwise.
 * `b` is the server's breakdown (explainTemplatePrice / explainAtPrice).
 */
export default function ProfitBreakdown({ b, price, vatRate, fontSize = 13, testId = 'profit-breakdown' }) {
  const [showVat, setShowVat] = useState(false);
  if (!b) return null;
  const sale = price ?? b.price;
  const row = (k, v, strong) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize, padding: '3px 0', fontWeight: strong ? 700 : 400 }}>
      <span style={{ color: strong ? undefined : 'var(--text-secondary)' }}>{k}</span><span>{v}</span>
    </div>
  );
  const profitColor = b.profit > 0 ? 'var(--success)' : b.profit < 0 ? 'var(--danger)' : 'var(--text-muted)';

  if (!b.taxModel) {
    return (
      <div data-testid={testId}>
        {[
          ['Satış fiyatı (KDV dahil)', `₺${money(sale)}`],
          [`KDV (%${vatRate})`, `−₺${money(b.vatAmount)}`],
          ['Komisyon', `−₺${money(b.commissionAmount)}`],
          ['Kargo ve diğer giderler', `−₺${money(b.fixedCosts)}`],
          ['Alış fiyatı', `−₺${money(b.purchase)}`],
        ].map(([k, v]) => row(k, v))}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: fontSize + 1, borderTop: '1px solid var(--border-color)', marginTop: 6, paddingTop: 8 }}>
          <span>Elinize kalan</span><span style={{ color: profitColor }}>₺{money(b.profit)}</span>
        </div>
      </div>
    );
  }

  const shipping = b.shippingCost ?? Math.max(0, b.fixedCosts - (b.serviceFee || 0) - (b.otherCost || 0));
  const rows = [
    ['Satış fiyatı', `₺${money(sale)}`],
    ['Komisyon', `−₺${money(b.commissionAmount)}`],
    b.serviceFee > 0 && ['Hizmet bedeli', `−₺${money(b.serviceFee)}`],
    b.withholding > 0 && ['Stopaj', `−₺${money(b.withholding)}`],
    ['Ödenecek KDV', `−₺${money(b.payableVat)}`],
    ['Kargo', `−₺${money(shipping)}`],
    b.otherCost > 0 && ['Diğer gider', `−₺${money(b.otherCost)}`],
    ['Alış maliyeti', `−₺${money(b.purchase)}`],
  ].filter(Boolean);
  const d = b.vatDetail || {};
  const vatRows = [
    ['Satıştan oluşan KDV', d.sale],
    ['Alıştan oluşan KDV', d.purchase],
    ['Kargodan oluşan KDV', d.shipping],
    ['Komisyondan oluşan KDV', d.commission],
    d.serviceFee > 0 && ['Hizmet bedelinden oluşan KDV', d.serviceFee],
    d.other > 0 && ['Diğer giderlerden oluşan KDV', d.other],
  ].filter(Boolean);

  return (
    <div data-testid={testId}>
      {rows.map(([k, v]) => row(k, v))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: fontSize + 1, borderTop: '1px solid var(--border-color)', marginTop: 6, paddingTop: 8 }}>
        <span>Net kâr</span><span style={{ color: profitColor }}>₺{money(b.profit)}</span>
      </div>
      <button type="button" data-testid="vat-toggle" onClick={() => setShowVat(!showVat)}
        style={{ background: 'none', border: 'none', padding: 0, marginTop: 8, cursor: 'pointer', color: 'var(--text-muted)', fontSize: fontSize - 1, fontFamily: 'inherit' }}>
        {showVat ? '▾' : '▸'} KDV dökümü
      </button>
      {showVat && (
        <div data-testid="vat-detail" style={{ marginTop: 4 }}>
          {vatRows.map(([k, v]) => row(k, `₺${money(v)}`))}
          {row('Ödenecek KDV', `₺${money(d.total)}`, true)}
          <div style={{ fontSize: fontSize - 1, color: 'var(--text-muted)', marginTop: 4 }}>
            {b.inputVat ? 'Ödenecek KDV’den, giderlerinizden oluşan KDV düşülür.' : 'Gider KDV’si düşülmüyor (şablonda “KDV mükellefiyim” kapalı).'}
          </div>
        </div>
      )}
    </div>
  );
}
