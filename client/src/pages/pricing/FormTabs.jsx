import TierTable, { emptyTiers } from './TierTable';
import { ROUNDING_HELP } from './pricingText';

/** Building blocks of the template form: menu strip, option cards and explanation boxes. */

export function TabStrip({ tabs, active, onChange, flags = {} }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-color)', marginBottom: 14, flexWrap: 'wrap' }}>
      {tabs.map((t, i) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key} data-testid={`tab-${t.key}`} onClick={() => onChange(t.key)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '8px 12px', fontSize: 13,
            fontWeight: active === t.key ? 700 : 500, color: active === t.key ? 'var(--accent-primary)' : 'var(--text-secondary)',
            borderBottom: active === t.key ? '2px solid var(--accent-primary)' : '2px solid transparent', marginBottom: -1 }}>
          {i + 1}. {t.label}{flags[t.key] ? <span title="Eksik alan var" style={{ color: 'var(--warning)' }}> ●</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Explain({ title, children }) {
  return (
    <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 8, padding: '10px 12px', margin: '0 0 14px', fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
      {title && <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{title}</div>}
      {children}
    </div>
  );
}

export function Example({ children }) {
  return <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', borderRadius: 6, padding: '6px 10px', margin: '6px 0 10px', lineHeight: 1.5 }}>{children}</div>;
}

export function OptionCard({ active, title, desc, onClick, testId }) {
  return (
    <button type="button" data-testid={testId} aria-pressed={active} onClick={onClick}
      style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', width: '100%',
        border: active ? '2px solid var(--accent-primary)' : '2px solid var(--border-color)',
        background: active ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{active ? '● ' : '○ '}{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>{desc}</div>
    </button>
  );
}

export function Cards({ children }) {
  return <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>{children}</div>;
}

export { TierTable, emptyTiers, ROUNDING_HELP };
