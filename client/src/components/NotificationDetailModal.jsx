import { useNavigate } from 'react-router-dom';
import {
  X, ExternalLink, CheckCircle, AlertTriangle, Info,
  Package, ShoppingCart, TrendingUp, FileCode2, MessageSquare,
  Wallet, ArrowUp, ArrowDown, Minus
} from 'lucide-react';

const typeStyle = (type) => {
  if (type === 'success') return { bg: 'rgba(34,197,94,0.15)', color: '#22c55e' };
  if (type === 'warning') return { bg: 'rgba(234,179,8,0.15)', color: '#eab308' };
  if (type === 'error')   return { bg: 'rgba(239,68,68,0.15)', color: '#ef4444' };
  return { bg: 'rgba(99,102,241,0.15)', color: 'var(--accent-primary)' };
};

const typeIcon = (type) => {
  if (type === 'success') return <CheckCircle size={20} />;
  if (type === 'warning') return <AlertTriangle size={20} />;
  if (type === 'error')   return <AlertTriangle size={20} />;
  return <Info size={20} />;
};

const formatFullDate = (dateStr) =>
  new Date(dateStr).toLocaleString('tr-TR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

const fmt = (n) => Number(n || 0).toFixed(2);

/* ── Table helpers ────────────────────────────────────────────────── */
const Th = ({ children, right }) => (
  <th style={{
    padding: '6px 10px', fontSize: 11, fontWeight: 600,
    color: 'var(--text-muted)', textAlign: right ? 'right' : 'left',
    borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap'
  }}>{children}</th>
);
const Td = ({ children, right, mono, color }) => (
  <td style={{
    padding: '5px 10px', fontSize: 12,
    color: color || 'var(--text-secondary)',
    textAlign: right ? 'right' : 'left',
    fontFamily: mono ? 'monospace' : undefined,
    borderBottom: '1px solid var(--border-color)',
    maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  }}>{children}</td>
);

const DiffCell = ({ oldVal, newVal, suffix = '' }) => {
  const changed = oldVal !== newVal && oldVal != null;
  const up = newVal > oldVal;
  return (
    <td style={{
      padding: '5px 10px', fontSize: 12, textAlign: 'right',
      borderBottom: '1px solid var(--border-color)'
    }}>
      <span style={{ color: changed ? (up ? '#22c55e' : '#ef4444') : 'var(--text-secondary)', fontWeight: changed ? 600 : 400 }}>
        {changed && (up ? <ArrowUp size={10} style={{ display:'inline', marginRight:2 }}/> : <ArrowDown size={10} style={{ display:'inline', marginRight:2 }}/>)}
        {fmt(newVal)}{suffix}
      </span>
      {changed && (
        <span style={{ color: 'var(--text-muted)', fontSize: 10, display: 'block' }}>
          önceki: {fmt(oldVal)}{suffix}
        </span>
      )}
    </td>
  );
};

const StatBadge = ({ label, value, color }) => (
  <div style={{
    background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px',
    display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 70
  }}>
    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ fontSize: 18, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</span>
  </div>
);

/* ── Rich data renderers ─────────────────────────────────────────── */
function renderData(data) {
  if (!data?.notifType) return null;
  const { notifType } = data;

  /* Trendyol ürün gönderimi */
  if (notifType === 'trendyol_send') {
    const products = data.products || [];
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <StatBadge label="Gönderilen" value={products.length} color="#22c55e" />
          {data.errorCount > 0 && <StatBadge label="Hata" value={data.errorCount} color="#ef4444" />}
        </div>
        {products.length > 0 && (
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border-color)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr><Th>Ürün</Th><Th>Barkod</Th><Th right>Fiyat</Th><Th right>Stok</Th></tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={i}>
                    <Td>{p.title}</Td>
                    <Td mono>{p.barcode}</Td>
                    <Td right>{fmt(p.price)}₺</Td>
                    <Td right>{p.stock}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.errors?.length > 0 && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', marginBottom: 6 }}>Hatalar</div>
            {data.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>• {e}</div>)}
          </div>
        )}
      </div>
    );
  }

  /* Fiyat/Stok güncelleme */
  if (notifType === 'trendyol_price_sync') {
    const items = data.items || [];
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <StatBadge label="Güncellenen" value={items.length} color="#22c55e" />
        </div>
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border-color)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><Th>Ürün</Th><Th right>Fiyat</Th><Th right>Stok</Th></tr>
            </thead>
            <tbody>
              {items.map((p, i) => (
                <tr key={i}>
                  <Td>{p.title}</Td>
                  <DiffCell oldVal={p.oldPrice} newVal={p.newPrice} suffix="₺" />
                  <DiffCell oldVal={p.oldStock} newVal={p.newStock} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* BuyBox kontrolü */
  if (notifType === 'buybox_check') {
    const results = data.results || [];
    const losing = results.filter(r => !r.isWinning);
    const winning = results.filter(r => r.isWinning);
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <StatBadge label="Kontrol" value={data.checked || results.length} />
          <StatBadge label="Kazanan" value={winning.length} color="#22c55e" />
          <StatBadge label="Kaybeden" value={losing.length} color="#ef4444" />
        </div>
        {losing.length > 0 && (
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#ef4444', borderBottom: '1px solid var(--border-color)' }}>
              BuyBox Kaybedilen Ürünler
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr><Th>Ürün</Th><Th right>Bizim</Th><Th right>Rakip</Th><Th right>Sıra</Th></tr>
              </thead>
              <tbody>
                {losing.map((r, i) => (
                  <tr key={i}>
                    <Td>{r.title || r.barcode}</Td>
                    <Td right>{fmt(r.ourPrice)}₺</Td>
                    <Td right color="#ef4444">{fmt(r.buyboxPrice)}₺</Td>
                    <Td right>{r.buyboxOrder ?? '-'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* XML Senkronizasyon */
  if (notifType === 'xml_sync') {
    return (
      <div>
        <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          Kaynak: <strong style={{ color: 'var(--text-primary)' }}>{data.sourceName}</strong>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <StatBadge label="Yeni" value={data.created} color="#22c55e" />
          <StatBadge label="Güncellendi" value={data.updated} color="var(--accent-primary)" />
          {data.skipped > 0 && <StatBadge label="Atlandı" value={data.skipped} color="#eab308" />}
          {data.errors > 0  && <StatBadge label="Hata" value={data.errors} color="#ef4444" />}
        </div>
      </div>
    );
  }

  /* Yeni sipariş */
  if (notifType === 'new_order') {
    const items = data.items || [];
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <StatBadge label="Sipariş No" value={data.orderNumber} />
          <StatBadge label="Tutar" value={`${fmt(data.totalAmount)}₺`} color="#22c55e" />
        </div>
        {data.customerName && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
            Müşteri: <strong>{data.customerName}</strong> · Durum: {data.status}
          </div>
        )}
        {items.length > 0 && (
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border-color)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr><Th>Ürün</Th><Th right>Adet</Th><Th right>Fiyat</Th></tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    <Td>{item.name}</Td>
                    <Td right>{item.quantity}</Td>
                    <Td right>{fmt(item.price)}₺</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* Soru yanıtlandı */
  if (notifType === 'question_answered') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.productTitle && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Ürün: <strong style={{ color: 'var(--text-primary)' }}>{data.productTitle}</strong>
          </div>
        )}
        <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Soru</div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{data.question}</div>
        </div>
        <div style={{ background: 'rgba(34,197,94,0.08)', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>{data.isAuto ? 'Otomatik Yanıt' : 'Yanıt'}</div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{data.answer}</div>
        </div>
      </div>
    );
  }

  /* Soru senkronizasyonu */
  if (notifType === 'question_sync') {
    const qs = data.questions || [];
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <StatBadge label="Yeni Soru" value={data.synced} />
          <StatBadge label="Otomatik Yanıt" value={data.autoAnswered} color="#22c55e" />
        </div>
        {qs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {qs.map((q, i) => (
              <div key={i} style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                {q.productTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{q.productTitle}</div>}
                <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{q.question}</div>
                {q.isAi !== undefined && (
                  <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>
                    {q.isAi ? 'AI ile' : 'Kural ile'} yanıtlandı
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* Kredi yüklendi */
  if (notifType === 'credit_topup') {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <StatBadge label="Yüklenen" value={`+${fmt(data.amount)}`} color="#22c55e" />
        <StatBadge label="Yeni Bakiye" value={fmt(data.newBalance)} />
      </div>
    );
  }

  /* Düşük bakiye */
  if (notifType === 'credit_low') {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <StatBadge label="Kalan Bakiye" value={`${fmt(data.newBalance)} kredi`} color="#eab308" />
      </div>
    );
  }

  return null;
}

/* ── Modal ───────────────────────────────────────────────────────── */
export default function NotificationDetailModal({ notification, onClose, onNavigate }) {
  const style = typeStyle(notification.type);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)', borderRadius: 12,
          padding: 24, width: '100%', maxWidth: 640,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 14, right: 14,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', padding: 4, borderRadius: 4,
          }}
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: style.bg, color: style.color,
          }}>
            {typeIcon(notification.type)}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
              {notification.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {formatFullDate(notification.createdAt)}
            </div>
          </div>
        </div>

        {/* Message */}
        <div style={{
          fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6,
          background: 'var(--bg-primary)', borderRadius: 8,
          padding: '10px 14px', marginBottom: 16,
        }}>
          {notification.message}
        </div>

        {/* Rich data */}
        {notification.data && (
          <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
            {renderData(notification.data)}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
          {notification.link && (
            <button
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              onClick={() => onNavigate(notification.link)}
            >
              <ExternalLink size={14} /> Sayfaya Git
            </button>
          )}
          <button
            className="btn btn-secondary"
            style={{ fontSize: 13 }}
            onClick={onClose}
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
