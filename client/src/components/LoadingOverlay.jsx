export default function LoadingOverlay({ visible, message = 'Yükleniyor...', submessage }) {
  if (!visible) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-color)',
        borderRadius: 16, padding: '36px 48px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)', minWidth: 280, textAlign: 'center',
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          border: '4px solid var(--border-color)',
          borderTopColor: 'var(--accent-primary)',
          animation: 'spin 0.8s linear infinite',
        }} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            {message}
          </div>
          {submessage && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{submessage}</div>
          )}
        </div>
      </div>
    </div>
  );
}
