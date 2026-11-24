import { useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const muted = { fontSize: 11.5, color: 'var(--text-muted)' };
const BADGE = { ok: ['Güncellenecek', 'var(--success, #16a34a)'], same: ['Aynı', 'var(--text-muted)'], unmatched: ['Ürün bulunamadı', 'var(--warning)'], bad: ['Hatalı', 'var(--danger)'] };

/** A price / stock list copied from Excel: stock code or barcode, net amount, stock. "Kontrol et" shows what each line would do; "Uygula" writes only the lines that change something. */
export default function PasteListModal({ onClose, onDone }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [res, setRes] = useState(null);                              // { text, data } the check of THIS text
  const fresh = res && res.text === text;
  const run = async (dryRun) => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/hand-products/paste', { text, dryRun });
      if (dryRun) setRes({ text, data: r.data }); else { toast.success(`${r.data.applied} ürün güncellendi`); onDone(r.data); }
    } catch (e) { setError((e.response && e.response.data && e.response.data.error) || 'Liste okunamadı'); if (dryRun) setRes(null); }
    finally { setBusy(false); }
  };
  const d = res && res.data;
  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()} style={{ zIndex: 1100 }}>
      <div className="modal" data-testid="paste-list" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820 }}>
        <div className="modal-header"><h3>Fiyat / stok listesini yapıştır</h3><button className="modal-close" onClick={() => !busy && onClose()}>×</button></div>
        <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Excel’den kopyalayıp yapıştırın. Sütunlar: <strong>stok kodu (SKU) ya da barkod</strong>, <strong>elime kalacak net tutar</strong>, <strong>stok</strong> (son ikisi isteğe bağlı ama biri gerekli). İlk satır başlıksa (“Barkod / Fiyat / Stok” gibi) sütunları başlıktan anlar. Ayırıcı: sekme (Excel), noktalı virgül ya da virgül; 1.874,70 ve 1874.70 yazımı ikisi de olur.
          </div>
          <textarea className="form-input" data-testid="paste-text" rows={9} style={{ fontFamily: 'monospace', fontSize: 12 }} placeholder={'SKU\tNet tutar\tStok\nTR-100\t120,50\t8\n8691111000028\t95\t3'} value={text} onChange={(e) => setText(e.target.value)} />
          {error && <div data-testid="paste-error" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          {d && fresh && (
            <div data-testid="paste-result">
              <div style={{ fontSize: 13 }}><strong>{d.counts.rows}</strong> satır · <strong style={{ color: 'var(--success, #16a34a)' }}>{d.counts.ok}</strong> güncellenecek{d.counts.same > 0 && <> · {d.counts.same} zaten aynı</>}{d.counts.unmatched > 0 && <> · <span style={{ color: 'var(--warning)' }}>{d.counts.unmatched} üründe kod bulunamadı</span></>}{d.counts.bad > 0 && <> · <span style={{ color: 'var(--danger)' }}>{d.counts.bad} hatalı satır</span></>}</div>
              <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 8 }}>
                <table className="table" style={{ width: '100%', fontSize: 12 }}>
                  <thead><tr><th>Satır</th><th>Kod</th><th>Net tutar</th><th>Stok</th><th>Ürün / durum</th></tr></thead>
                  <tbody>{d.items.map((i) => (
                    <tr key={i.line} data-testid="paste-row">
                      <td>{i.line}</td><td className="mono">{i.key}</td><td>{i.price === null ? '—' : i.price}{i.product && i.price !== null && i.price !== i.product.price ? <small style={muted}> (önce {i.product.price})</small> : null}</td>
                      <td>{i.stock === null ? '—' : i.stock}{i.product && i.stock !== null && i.stock !== i.product.stock ? <small style={muted}> (önce {i.product.stock})</small> : null}</td>
                      <td><span style={{ color: (BADGE[i.status] || [])[1] }}>{(BADGE[i.status] || [i.status])[0]}</span>{i.product ? ` · ${i.product.title.slice(0, 40)}` : ''}{i.note ? <small style={{ ...muted, display: 'block' }}>{i.note}</small> : null}</td>
                    </tr>))}</tbody>
                </table>
                {d.truncated && <small style={muted}>İlk {d.items.length} satır gösteriliyor; hepsi uygulanır.</small>}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
          <button type="button" className="btn btn-secondary" data-testid="paste-check" disabled={busy || !text.trim()} onClick={() => run(true)}>Kontrol et</button>
          <button type="button" className="btn btn-primary" data-testid="paste-apply" disabled={busy || !fresh || !d || d.counts.ok === 0} onClick={() => run(false)} title={!fresh ? 'Önce kontrol edin (metni değiştirdiyseniz yeniden)' : ''}>{d && fresh ? `${d.counts.ok} ürüne uygula` : 'Uygula'}</button>
        </div>
      </div>
    </div>
  );
}
