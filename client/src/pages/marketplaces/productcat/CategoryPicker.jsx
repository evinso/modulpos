import { useEffect, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import api from '../../../services/api';

/** Pick any Trendyol leaf category by typing words of its name (free, searched in the bundled tree). */
export default function CategoryPicker({ connId, title, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      setBusy(true);
      api.get(`/marketplace/connections/${connId}/product-categories/search`, { params: { q } })
        .then((r) => { if (alive) setResults(r.data || []); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setBusy(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, connId]);
  const typed = q.trim().length >= 2;
  const shown = typed ? results : [];

  return (
    <div role="dialog" aria-label="Trendyol kategorisi seç" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80 }} onClick={onClose}>
      <div className="card" style={{ width: 640, maxWidth: '94vw', padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 15 }}>{title || 'Trendyol kategorisi seç'}</strong>
          <button className="btn btn-secondary" aria-label="Kapat" onClick={onClose} style={{ padding: '4px 8px' }}><X size={14} /></button>
        </div>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--text-muted)' }} />
          <input autoFocus className="form-input" aria-label="Kategori ara" style={{ paddingLeft: 32 }} placeholder="Kategori adı yazın (ör. pense, kupa, peluş)…" value={q} onChange={(e) => setQ(e.target.value)} />
          {busy && <Loader2 size={14} className="spinning" style={{ position: 'absolute', right: 10, top: 12 }} />}
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {typed && !busy && shown.length === 0 && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>Eşleşen kategori bulunamadı.</div>}
          {shown.map((r) => (
            <button key={r.id} type="button" className="btn btn-secondary" data-testid="picker-result" onClick={() => onPick(r)}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6, padding: '8px 12px', whiteSpace: 'normal' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.path}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
