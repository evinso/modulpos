/** one field's word-level difference: removed words struck through, added words highlighted */
export default function DiffView({ field }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row between"><strong>{field.field}</strong><small className="faint">+{field.added} / −{field.removed} kelime{field.coarse ? ' · çok farklı: ayrıntılı karşılaştırma yapılamadı' : ''}</small></div>
      <div className="diff card flat" style={{ padding: 10 }}>{field.runs.map((r, i) => (r.t === 'eq' ? <span key={i}>{r.text} </span> : r.t === 'ins' ? <ins key={i}>{r.text} </ins> : <del key={i}>{r.text} </del>))}</div>
    </div>
  );
}
