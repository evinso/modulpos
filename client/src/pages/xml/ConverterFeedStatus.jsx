import { RefreshCw, Clock } from 'lucide-react';
import { feedSummary } from './converterFeed';

// "Son güncelleme" of a converted XML: when the converted file was last produced (a XML source pulled the proxy address, or it was
// downloaded), how many products it had, and the date the supplier's own file carries (when the supplier sends one).
export default function ConverterFeedStatus({ feed, onRefresh }) {
  if (feed === undefined) return null;   // not asked yet
  const s = feedSummary(feed);
  const muted = { fontSize: 11, color: 'var(--text-muted)' };
  const label = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
  const failed = s.kind === 'failed';
  return (
    <div data-testid="converter-feed-status" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 8, fontSize: 12 }}>
      <Clock size={14} style={{ marginTop: 2, flexShrink: 0, color: failed ? 'var(--danger)' : 'var(--text-muted)' }} />
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.6 }}>
        {s.kind === 'none' && (
          <span style={muted}>Henüz çekilmedi. Proxy adresi bir XML kaynağına eklenip çekildiğinde güncelleme zamanı burada görünür.</span>
        )}
        {s.kind === 'converted' && (
          <span style={muted}>
            Henüz çekilmedi{s.convertedAt ? ` (dönüştürüldü: ${s.convertedAt})` : ''}. Proxy adresi bir XML kaynağına eklenip çekildiğinde güncelleme zamanı burada görünür.
          </span>
        )}
        {(s.kind === 'ok' || failed) && (
          <>
            <div title="Dönüştürülmüş XML'in en son üretildiği an: bir XML kaynağı proxy adresini çektiğinde ya da XML'i indirdiğinizde güncellenir.">
              <span style={label}>Son güncelleme</span>{' '}
              <strong style={{ color: failed ? 'var(--danger)' : 'var(--text-primary)' }}>{s.at}</strong>
              <span style={muted}> · {s.ago}</span>
              {s.count !== null && !failed && <span className="badge badge-success" style={{ fontSize: 10, marginLeft: 8 }}>{s.count} ürün</span>}
              {failed && <span className="badge badge-danger" style={{ fontSize: 10, marginLeft: 8 }}>Başarısız</span>}
            </div>
            {failed && s.error && <div style={{ color: 'var(--danger)' }}>{s.error}</div>}
          </>
        )}
        {s.kind !== 'none' && (
          <div title="Tedarikçi sunucusunun dosya için bildirdiği değişiklik tarihi (son çekimde okunur).">
            <span style={label}>Kaynak dosya tarihi</span>{' '}
            {s.source
              ? <><strong>{s.source.at}</strong><span style={muted}> · {s.source.ago}</span></>
              : <span style={muted}>Tedarikçi dosyanın tarihini bildirmiyor</span>}
          </div>
        )}
      </div>
      {onRefresh && (
        <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }} onClick={onRefresh} title="Bilgiyi yenile (kredi harcamaz)">
          <RefreshCw size={12} /> Durumu yenile
        </button>
      )}
    </div>
  );
}
