import { useEffect, useState } from 'react';

/** One box of the table: saves when you leave it (or press Enter); Escape puts the old value back. onSave(text) answers false when the value was refused (the old one comes back). */
export default function Cell({ value, onSave, type = 'text', width, disabled = false, title, step, min, align, label }) {
  const [v, setV] = useState(String(value ?? ''));
  useEffect(() => { setV(String(value ?? '')); }, [value]);
  const commit = async () => {
    if (v === String(value ?? '')) return;
    const ok = await onSave(v);
    if (ok === false) setV(String(value ?? ''));
  };
  return (
    <input className="form-input" type={type} step={step} min={min} value={v} disabled={disabled} title={title} aria-label={label}
      style={{ width: width || '100%', minWidth: 0, padding: '4px 6px', fontSize: 12.5, textAlign: align }}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setV(String(value ?? '')); e.currentTarget.blur(); } }} />
  );
}
