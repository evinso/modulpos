import { useState } from 'react';
import { CheckCircle2, AlertTriangle, MinusCircle, Info, RefreshCw } from 'lucide-react';

const KIND = { auto: 'Otomatik', manual: 'Elle', settings: 'Ayar' };
const STATUS = {
  ok: { icon: CheckCircle2, color: 'var(--success)', label: 'Güncellendi' },
  partial: { icon: AlertTriangle, color: 'var(--warning)', label: 'Kısmen' },
  nothing: { icon: MinusCircle, color: 'var(--text-muted)', label: 'Değişmedi' },
  error: { icon: AlertTriangle, color: 'var(--danger)', label: 'Hata' },
  info: { icon: Info, color: 'var(--accent-primary)', label: 'Ayar' },
};
const price = (n) => (n == null ? '—' : `${Number(n).toFixed(2)}₺`);
const when = (d) => new Date(d).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Notes written each time the automatic (or manual) BuyBox price adjustment runs, and when its settings change. */
export default function AutoLogTab({ rows, onRefresh }) {
  const [open, setOpen] = useState(null);

  if (rows === null) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div className="table-container">
      <div className="table-header">
        <h3>
          Otomatik Fiyat Kayıtları
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 10 }}>
            Otomatik fiyat ayarı her çalıştığında ve ayarı değiştirdiğinizde buraya not düşer
          </span>
        </h3>
        <button className="btn btn-secondary" style={{ fontSize: 13, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={onRefresh}>
          <RefreshCw size={14} /> Yenile
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state" style={{ padding: 32 }}>
          <Info size={40} className="empty-icon" />
          <h3>Henüz kayıt yok</h3>
          <p>Otomatik fiyat açıkken BuyBox kontrolünde BuyBox'u kaybeden ürün çıkarsa, yapılan işlem burada görünür.</p>
        </div>
      ) : (
        <table>
          <thead>
            <tr><th>Tarih</th><th>Tür</th><th>Sonuç</th><th>Not</th><th style={{ textAlign: 'right' }}>Güncellenen</th><th style={{ textAlign: 'right' }}>Atlanan</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = STATUS[r.status] || STATUS.info;
              const Icon = st.icon;
              const skipped = (r.skippedNotLower || 0) + (r.skippedLoss || 0) + (r.skippedOther || 0);
              const hasItems = r.items && r.items.length > 0;
              return [
                <tr key={r.id} data-testid="log-row">
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{when(r.createdAt)}</td>
                  <td style={{ fontSize: 13 }}>{KIND[r.kind] || r.kind}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: st.color, fontSize: 13, fontWeight: 600 }}>
                      <Icon size={14} /> {st.label}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, maxWidth: 520 }}>
                    {r.note}
                    {hasItems && (
                      <button className="text-btn" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? 'Ürünleri gizle' : `Ürünleri göster (${r.items.length})`}
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{r.kind === 'settings' ? '—' : r.updated}</td>
                  <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)' }}>{r.kind === 'settings' ? '—' : skipped}</td>
                </tr>,
                open === r.id && hasItems && (
                  <tr key={r.id + '-items'}>
                    <td colSpan={6} style={{ background: 'var(--bg-secondary)', padding: '10px 20px' }}>
                      <table style={{ width: '100%' }}>
                        <thead><tr><th>Ürün</th><th>Barkod</th><th style={{ textAlign: 'right' }}>Eski fiyat</th><th style={{ textAlign: 'right' }}>Yeni fiyat</th></tr></thead>
                        <tbody>
                          {r.items.map((it) => (
                            <tr key={it.barcode}>
                              <td style={{ fontSize: 12 }}>{it.title || '—'}</td>
                              <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{it.barcode}</td>
                              <td style={{ textAlign: 'right', fontSize: 12 }}>{price(it.oldPrice)}</td>
                              <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{price(it.newPrice)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {r.updated > r.items.length && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>İlk {r.items.length} ürün gösteriliyor, toplam {r.updated}.</div>}
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
