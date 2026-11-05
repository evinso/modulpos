import { Plus, X } from 'lucide-react';

/**
 * Small "up to X → Y" table (max 3 rows). The last row is always "and above" and has no limit.
 * rows: [{ upTo: '200', value: '46' }, { upTo: null, value: '84' }]
 */
export const MAX_ROWS = 3;
export const emptyTiers = () => [{ upTo: '', value: '' }, { upTo: null, value: '' }];

const cell = { minWidth: 0 };

export default function TierTable({ rows, onChange, limitLabel, valueLabel, valueUnit, limitUnit = '₺', testId }) {
  const setRow = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => {
    if (rows.length >= MAX_ROWS) return;
    const next = rows.slice(0, -1).concat([{ upTo: '', value: '' }], rows.slice(-1));
    onChange(next);
  };
  const removeRow = (i) => { if (rows.length > 2) onChange(rows.filter((_, k) => k !== i)); };

  return (
    <div data-testid={testId} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 24px', gap: 8, fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
        <span>{limitLabel}</span><span>{valueLabel}</span><span />
      </div>
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 24px', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <div style={cell}>
              {last ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 2px' }}>Üstü</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="number" min="0" step="0.01" className="form-input" aria-label={`${i + 1}. satır üst sınır`} value={r.upTo ?? ''} onChange={(e) => setRow(i, { upTo: e.target.value })} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{limitUnit}’ye kadar</span>
                </div>
              )}
            </div>
            <div style={{ ...cell, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" min="0" step="0.01" className="form-input" aria-label={`${i + 1}. satır tutar`} value={r.value ?? ''} onChange={(e) => setRow(i, { value: e.target.value })} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{valueUnit}</span>
            </div>
            {!last && rows.length > 2 ? (
              <button type="button" onClick={() => removeRow(i)} title="Satırı sil" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={14} /></button>
            ) : <span />}
          </div>
        );
      })}
      {rows.length < MAX_ROWS && (
        <button type="button" onClick={addRow} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, fontFamily: 'inherit' }}>
          <Plus size={13} /> Satır ekle
        </button>
      )}
    </div>
  );
}

/** Rows → API payload. Returns { tiers, incomplete }. An all-empty/closed table gives no tiers. */
export function rowsToTiers(rows, key) {
  if (!rows || rows.length === 0) return { tiers: [], incomplete: false };
  const n = (v) => (v === '' || v === null || v === undefined || Number.isNaN(parseFloat(v)) ? null : parseFloat(v));
  const tiers = rows.map((r, i) => ({ upTo: i === rows.length - 1 ? null : n(r.upTo), [key]: n(r.value) }));
  const incomplete = tiers.some((t, i) => t[key] === null || (i < tiers.length - 1 && t.upTo === null));
  return { tiers: incomplete ? [] : tiers, incomplete };
}

/** API tiers → rows */
export function tiersToRows(tiers, key) {
  if (!Array.isArray(tiers) || tiers.length < 2) return [];
  return tiers.map((t, i) => ({ upTo: i === tiers.length - 1 ? null : (t.upTo ?? ''), value: t[key] ?? '' }));
}
