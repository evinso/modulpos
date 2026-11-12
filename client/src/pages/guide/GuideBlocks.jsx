import { Link } from 'react-router-dom';
import { Info, AlertTriangle, Lightbulb } from 'lucide-react';
import { parseInline } from './guideText';
import { LivePlans, LiveCredits, IssueTable } from './LiveBoxes';

const UI_CHIP = { background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 5, padding: '0 6px', fontSize: '0.92em', fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--text-primary)' };
const JUMP = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary)', font: 'inherit', textDecoration: 'underline' };

export function Inline({ text, onJump }) {
  return parseInline(text).map((p, i) => {
    if (p.k === 'bold') return <strong key={i}>{p.x}</strong>;
    if (p.k === 'ui') return <span key={i} style={UI_CHIP} data-ui>{p.x}</span>;
    if (p.k === 'link') return <Link key={i} to={p.to} style={{ color: 'var(--accent-primary)' }}>{p.x}</Link>;
    if (p.k === 'jump') return <button key={i} type="button" style={JUMP} onClick={() => onJump && onJump(p.id)}>{p.x}</button>;
    return <span key={i}>{p.x}</span>;
  });
}

const TONES = {
  info: { icon: Info, bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.3)', label: 'Bilgi' },
  warn: { icon: AlertTriangle, bg: 'rgba(245,158,11,0.09)', border: 'rgba(245,158,11,0.4)', label: 'Dikkat' },
  tip: { icon: Lightbulb, bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.35)', label: 'İpucu' },
};

export function Block({ b, onJump }) {
  switch (b.t) {
    case 'p': return <p style={{ margin: '8px 0', lineHeight: 1.7 }}><Inline text={b.x} onJump={onJump} /></p>;
    case 'ul': return <ul style={{ margin: '8px 0', paddingLeft: 20, lineHeight: 1.7 }}>{b.x.map((x, i) => <li key={i} style={{ marginBottom: 4 }}><Inline text={x} onJump={onJump} /></li>)}</ul>;
    case 'steps': return <ol style={{ margin: '8px 0', paddingLeft: 22, lineHeight: 1.7 }}>{b.x.map((x, i) => <li key={i} style={{ marginBottom: 6 }}><Inline text={x} onJump={onJump} /></li>)}</ol>;
    case 'note': {
      const tone = TONES[b.tone] || TONES.info; const Icon = tone.icon;
      return (
        <div role="note" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 8, padding: '10px 14px', margin: '10px 0', fontSize: 13.5, lineHeight: 1.65 }}>
          <Icon size={16} style={{ flexShrink: 0, marginTop: 3 }} aria-label={tone.label} />
          <div><Inline text={b.x} onJump={onJump} /></div>
        </div>
      );
    }
    case 'table': return (
      <div style={{ overflowX: 'auto', margin: '10px 0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead><tr>{b.head.map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '7px 10px', borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-color)', verticalAlign: 'top', lineHeight: 1.55, fontWeight: j === 0 ? 600 : 400 }}><Inline text={c} onJump={onJump} /></td>)}</tr>)}</tbody>
        </table>
      </div>
    );
    case 'qa': return (
      <div style={{ margin: '8px 0' }}>
        {b.x.map(([q, a], i) => (
          <details key={i} style={{ borderBottom: '1px solid var(--border-color)', padding: '8px 0' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>{q}</summary>
            <p style={{ margin: '8px 0 2px', lineHeight: 1.7, fontSize: 13.5 }}><Inline text={a} onJump={onJump} /></p>
          </details>
        ))}
      </div>
    );
    case 'live':
      if (b.x === 'plans') return <LivePlans />;
      if (b.x === 'credits') return <LiveCredits />;
      if (b.x === 'issues') return <IssueTable />;
      return null;
    default: return null;
  }
}
