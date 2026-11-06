import { useState } from 'react';
import { Plus, X } from 'lucide-react';

/**
 * "up to X → Y" table with as many rows as the user wants. The last row is always "and above" and has no limit.
 * rows: [{ upTo: '200', value: '46' }, { upTo: null, value: '84' }]
 */
// Same safety ceiling as the server (a table is read for every product on every price calculation); far beyond real use.
export const MAX_ROWS = 1000;
const SCROLL_AFTER = 8;   // longer tables scroll inside their box instead of stretching the page
export const emptyTiers = () => [{ upTo: '', value: '' }, { upTo: null, value: '' }];

const cell = { minWidth: 0 };

export default function TierTable({ rows, onChange, limitLabel, valueLabel, valueUnit, limitUnit = '₺', testId }) {
  const [focusRow, setFocusRow] = useState(-1); // the row just added gets the cursor, so a long table can be typed in without the mouse
  const setRow = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => {
    if (rows.length >= MAX_ROWS) return;
    setFocusRow(rows.length - 1); // the new row goes just before the last ("and above") row
    const next = rows.slice(0, -1).concat([{ upTo: '', value: '' }], rows.slice(-1));
    onChange(next);
  };
  const removeRow = (i) => { if (rows.length > 2) onChange(rows.filter((_, k) => k !== i)); };

  return (
    <div data-testid={testId} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 24px', gap: 8, fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
        <span>{limitLabel}</span><span>{valueLabel}</span><span />
      </div>
      <div data-testid={testId ? `${testId}-rows` : undefined} style={rows.length > SCROLL_AFTER ? { maxHeight: 360, overflowY: 'auto', paddingRight: 4 } : undefined}>
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 24px', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <div style={cell}>
              {last ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 2px' }}>Üstü</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="number" min="0" step="0.01" className="form-input" aria-label={`${i + 1}. satır üst sınır`} value={r.upTo ?? ''} autoFocus={i === focusRow} onChange={(e) => setRow(i, { upTo: e.target.value })} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{limitUnit}’ye kadar</span>
                </div>
              )}
            </div>
            <div style={{ ...cell, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" min="0" step="0.01" className="form-input" aria-label={`${i + 1}. satır tutar`} value={r.value ?? ''} onChange={(e) => setRow(i, { value: e.target.value })} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{valueUnit}</span>
            </div>
            {!last && rows.length > 2 ? (
              <button type="button" tabIndex={-1} onClick={() => removeRow(i)} title="Satırı sil" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={14} /></button>
            ) : <span />}
          </div>
        );
      })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {rows.length < MAX_ROWS && (
          <button type="button" onClick={addRow} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, fontFamily: 'inherit' }}>
            <Plus size={13} /> Satır ekle
          </button>
        )}
        {rows.length > 5 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rows.length} satır</span>}
      </div>
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
