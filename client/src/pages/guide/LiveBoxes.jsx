import { useEffect, useState } from 'react';
import api from '../../services/api';
import { ISSUE_LABELS } from '../products/productsUi';
import { ISSUE_HELP } from './issueHelp';
import { creditLabel } from './guideText';

const box = { border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px', margin: '10px 0', background: 'var(--bg-secondary)' };
const small = { fontSize: 12, color: 'var(--text-muted)' };

/** Güncel abonelik planları (sunucudan). Yüklenemezse sayfaya yönlendirir. */
export function LivePlans() {
  const [plans, setPlans] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/public/pricing-plans').then((r) => { if (alive) setPlans(Array.isArray(r.data) ? r.data : []); }).catch(() => { if (alive) setPlans([]); });
    return () => { alive = false; };
  }, []);
  if (plans === null) return <div style={box}><span style={small}>Güncel planlar yükleniyor…</span></div>;
  if (!plans.length) return <div style={box}><span style={small}>Güncel planlar için Abonelik &amp; Kredi sayfasına bakın.</span></div>;
  return (
    <div style={box} data-testid="live-plans">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Güncel planlar</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        {plans.map((p) => (
          <div key={p.id || p.name} style={{ border: p.isHighlighted ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontWeight: 700 }}>{p.name}</div>
            <div style={{ fontSize: 13 }}>{p.price}{p.period ? ` ${p.period}` : ''}</div>
            {p.yearlyPrice ? <div style={small}>Yıllık: {p.yearlyPrice}</div> : null}
            {Array.isArray(p.features) && p.features.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5, color: 'var(--text-secondary)' }}>{p.features.slice(0, 6).map((f, i) => <li key={i}>{f}</li>)}</ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Kredi harcayan işlemlerin güncel birim fiyatları (sunucudan). */
export function LiveCredits() {
  const [prices, setPrices] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/credits/prices').then((r) => { if (alive) setPrices(r.data || {}); }).catch(() => { if (alive) setPrices({}); });
    return () => { alive = false; };
  }, []);
  const rows = prices ? [
    ['XML Dönüştürücü ile dönüştürme', creditLabel(prices.xmlConvertCost, '/ işlem')],
    ['Hazır XML Market’ten kaynak ekleme', prices.xmlImportDefaultCost !== undefined ? `${creditLabel(prices.xmlImportDefaultCost)} (tedarikçiye göre değişebilir)` : '—'],
    ['BuyBox kontrolü', creditLabel(prices.buyboxCheckCost, '/ 10 barkod')],
    ['BuyBox fiyat güncelleme (elle veya otomatik)', creditLabel(prices.buyboxAdjustCost, '/ ürün')],
    ['Otomatik soru yanıtı', creditLabel(prices.autoReplyCost, '/ yanıt')],
    ['Yapay zeka ile XML kategorisi eşleştirme', creditLabel(prices.categoryAiCost, '/ kategori')],
    ['Yapay zeka ile ürün kategorisi', creditLabel(prices.productCategoryAiCost, '/ sonuç alınan ürün')],
    ['Tedarikçi siparişi (dropship)', 'Tedarikçinin sipariş ücreti, sipariş öncesi gösterilir'],
  ] : [];
  if (prices === null) return <div style={box}><span style={small}>Güncel fiyatlar yükleniyor…</span></div>;
  if (!Object.keys(prices).length) return <div style={box}><span style={small}>Güncel birim fiyatlar için Abonelik &amp; Kredi sayfasına bakın.</span></div>;
  return (
    <div style={box} data-testid="live-credits">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Güncel kredi fiyatları</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <tbody>{rows.map(([k, v]) => <tr key={k}><td style={{ padding: '5px 8px 5px 0', borderBottom: '1px solid var(--border-color)' }}>{k}</td><td style={{ padding: '5px 0', borderBottom: '1px solid var(--border-color)', fontWeight: 600, textAlign: 'right' }}>{v}</td></tr>)}</tbody>
      </table>
      <div style={{ ...small, marginTop: 6 }}>Fiyatları yönetim belirler; bu liste her açılışta güncel halini gösterir.</div>
    </div>
  );
}

/** "Hazır değil" nedenleri: ürün listesindeki gerçek ifadeler + açıklama + çözüm. */
export function IssueTable() {
  return (
    <div style={{ overflowX: 'auto', margin: '10px 0' }} data-testid="issue-table">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <thead><tr>{['Ekrandaki ifade', 'Ne demek?', 'Ne yapmalı?'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '7px 10px', borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: 12 }}>{h}</th>)}</tr></thead>
        <tbody>
          {Object.entries(ISSUE_LABELS).map(([code, label]) => {
            const [what, fix] = ISSUE_HELP[code] || ['', ''];
            return (
              <tr key={code}>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-color)', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}</td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-color)', verticalAlign: 'top', lineHeight: 1.55 }}>{what}</td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-color)', verticalAlign: 'top', lineHeight: 1.55 }}>{fix}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
