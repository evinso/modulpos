import { useEffect, useState } from 'react';
import { X, Loader2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';

/**
 * "Kategorileri sıfırla": gives the products of ONE XML source back. Always removes the categories chosen for single products
 * (with their attribute values); the XML-category mappings of that source only when ticked. Nothing on Trendyol is touched.
 */
export default function ResetDialog({ connId, srcId, srcName, mappingCount, onClose, onDone }) {
  const [assigned, setAssigned] = useState(null);
  const [withMappings, setWithMappings] = useState(false);
  const [busy, setBusy] = useState(false);
  const canMappings = srcId !== 'none' && mappingCount > 0;

  useEffect(() => {
    let alive = true;
    api.get(`/marketplace/connections/${connId}/product-categories/overview`, { params: { xmlSourceId: srcId } })
      .then((r) => { if (alive) setAssigned(r.data.assigned); })
      .catch(() => { if (alive) setAssigned(0); });
    return () => { alive = false; };
  }, [connId, srcId]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/marketplace/connections/${connId}/product-categories/reset`, { xmlSourceId: srcId, includeMappings: withMappings && canMappings });
      toast.success(`${r.data.removedProducts} ürünün kategorisi sıfırlandı${r.data.removedMappings ? `, ${r.data.removedMappings} kategori eşleştirmesi silindi` : ''}`);
      onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Sıfırlanamadı'); setBusy(false); }
  };

  const nothing = assigned === 0 && !(withMappings && canMappings);
  return (
    <div role="dialog" aria-label="Kategorileri sıfırla" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 100 }} onClick={onClose}>
      <div className="card" style={{ width: 520, maxWidth: '94vw', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 15 }}>Kategorileri sıfırla — {srcName}</strong>
          <button className="btn btn-secondary" aria-label="Kapat" onClick={onClose} style={{ padding: '4px 8px' }}><X size={14} /></button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Bu XML kaynağındaki ürünlere <strong>tek tek atanan tüm Trendyol kategorileri</strong> (ve bunlara yazılan zorunlu özellik değerleri) silinir.
          Ürünler, varsa XML kategorisinin eşleştirmesine döner; yoksa “kategorisi olmayan” olur. Trendyol’daki ürünlere dokunulmaz.
        </p>
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-tertiary)', marginBottom: 10, fontSize: 13 }}>
          {assigned === null ? <Loader2 size={14} className="spinning" /> : <>Tek tek atanmış kategorisi olan ürün: <strong data-testid="reset-count">{assigned}</strong></>}
        </div>
        {canMappings && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginBottom: 12 }}>
            <input type="checkbox" aria-label="Kategori eşleştirmelerini de sil" checked={withMappings} onChange={(e) => setWithMappings(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Bu XML’in <strong>{mappingCount} kategori eşleştirmesini</strong> da sil (XML kategorisi → Trendyol kategorisi)</span>
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button className="btn btn-danger" disabled={busy || assigned === null || nothing} onClick={run} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {busy ? <Loader2 size={14} className="spinning" /> : <RotateCcw size={14} />} Sıfırla
          </button>
        </div>
      </div>
    </div>
  );
}
