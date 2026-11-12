import { useState } from 'react';
import { Lightbulb, Loader2 } from 'lucide-react';
import { shortPath } from './helpers';

const FIRST_ROWS = 30;
const clean = (s) => String(s || '').replace(/&amp;/g, '&');

/**
 * Free Trendyol category suggestions for the XML categories that have no mapping yet ("Kategori eşleştirme" tab).
 * The suggestions come from the titles of each category's products (word matching, not AI); a click only fills the form above,
 * the user still checks the required attributes and saves.
 */
export default function CategorySuggestions({ rows, loading, onPick, onOpenProducts }) {
  const [all, setAll] = useState(false);
  if (!loading && rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, FIRST_ROWS);
  const muted = { fontSize: 12, color: 'var(--text-muted)' };

  return (
    <div className="card" style={{ marginBottom: 20, padding: 20 }} data-testid="category-suggestions">
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Lightbulb size={16} style={{ color: 'var(--accent-primary)' }} />
        Önerilen eşleştirmeler
        <span className="badge badge-success" style={{ fontSize: 10 }}>ücretsiz</span>
        {!loading && <span style={{ ...muted, fontWeight: 400 }}>· eşleşmeyen {rows.length} kategori</span>}
      </h3>
      <p style={{ ...muted, margin: '0 0 12px', lineHeight: 1.6 }}>
        Her XML kategorisi için, içindeki ürünlerin başlıklarından bulunan olası Trendyol kategorileri. Bu öneriler kelime eşleştirmesiyle bulunur (yapay zeka değil) ve her zaman doğru olmayabilir.
        Bir öneriye tıklayınca yukarıdaki forma gelir; zorunlu özellikleri kontrol edip kaydedersiniz. Yüzde, ürün başlıklarının kaçında bu kategorinin ilk 3 öneri arasında çıktığını gösterir.
      </p>

      {loading ? (
        <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)' }}>
          <Loader2 size={16} className="spinning" /> Öneriler hazırlanıyor...
        </div>
      ) : (
        <>
          <div className="table-container">
            <table>
              <thead><tr><th>XML kategorisi</th><th style={{ textAlign: 'right' }}>Ürün</th><th>Olası Trendyol kategorileri</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.category} data-testid="suggestion-row">
                    <td style={{ fontWeight: 500, verticalAlign: 'top' }}>{clean(r.category)}</td>
                    <td style={{ textAlign: 'right', verticalAlign: 'top', color: 'var(--text-secondary)' }}>{r.total}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {r.suggestions.map((s, i) => (
                          <button key={s.id} type="button" className="btn btn-secondary" data-testid="cat-suggestion"
                            title={`${s.path}\nÜrün başlıklarının %${Math.round(s.share * 100)}'inde ilk 3 öneri arasında`}
                            style={{ padding: '3px 8px', fontSize: 12, borderColor: i === 0 && !r.mixed && !r.weak ? 'rgba(16,185,129,0.6)' : undefined }}
                            onClick={() => onPick(r.category, s)}>
                            {shortPath(s.path, 2)} <span style={{ opacity: 0.6 }}>%{Math.round(s.share * 100)}</span>
                          </button>
                        ))}
                        {r.suggestions.length === 0 && <span style={muted}>Öneri bulunamadı</span>}
                      </div>
                      {r.mixed && (
                        <div style={{ ...muted, marginTop: 4 }} data-testid="mixed-note">
                          Karışık kategori: ürün başlıkları farklı kategorilere işaret ediyor, tek bir Trendyol kategorisi hepsine uymaz.{' '}
                          <button type="button" className="btn btn-secondary" style={{ padding: '1px 6px', fontSize: 11 }} onClick={onOpenProducts}>Ürün bazlı kategori</button> sekmesinde ürün başına seçin.
                        </div>
                      )}
                      {r.weak && !r.mixed && <div style={{ ...muted, marginTop: 4 }}>Az ürün ({r.total}): öneri zayıf olabilir.</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > FIRST_ROWS && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setAll((v) => !v)}>
                {all ? 'İlk 30’u göster' : `Hepsini göster (${rows.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
