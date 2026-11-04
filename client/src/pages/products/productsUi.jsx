import { Package } from 'lucide-react';

/** Small shared pieces for the products screen. */

export const money = (n) => (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const moneyShort = (n) => (Number(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
export const dateTime = (d) => (d ? new Date(d).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function parseImages(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string' && v.startsWith('http')) return [v];
  } catch {
    if (typeof raw === 'string' && raw.startsWith('http')) return [raw];
  }
  return [];
}

export const MP_STATUS = {
  active: { label: 'Satışta', color: 'var(--success)' },
  pending: { label: 'Onay bekliyor', color: 'var(--warning)' },
  rejected: { label: 'Reddedildi', color: 'var(--danger)' },
  passive: { label: 'Kaldırıldı', color: '#f97316' },
};

// Reasons the server-side readiness check can give (same wording as the "Trendyol'a Gönder" screen)
export const ISSUE_LABELS = {
  no_category_mapping: 'Kategori eşleşmesi yok',
  bad_barcode: 'Barkod hatalı',
  duplicate_barcode: 'Tekrarlı barkod',
  no_price_rule: 'Fiyat şablonu yok',
  invalid_price: 'Fiyat geçersiz',
  price_below_cost: 'Fiyat alışın altında',
  title_empty: 'Başlık boş',
  title_too_long: 'Başlık çok uzun',
  no_description: 'Açıklama yok',
  description_too_long: 'Açıklama çok uzun',
  no_image: 'Görsel yok',
  bad_vat: 'KDV hatalı',
  bad_stock: 'Stok hatalı',
  rejected_by_marketplace: 'Trendyol reddetti',
  missing_attributes: 'Zorunlu özellik eksik',
  no_brand: 'Marka yok',
  excluded_by_settings: 'Gönderim ayarlarına takıldı',
};

export function Thumb({ src, size = 40, radius = 8 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: 'hidden',
      background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {src ? (
        <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      ) : <Package size={Math.round(size * 0.4)} color="var(--text-muted)" />}
    </div>
  );
}

export function Pill({ children, color = 'var(--text-secondary)', title, style }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
      padding: '2px 8px', borderRadius: 10, color,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`, ...style,
    }}>{children}</span>
  );
}

export function StockPill({ stock }) {
  const n = Number(stock) || 0;
  if (n <= 0) return <Pill color="var(--danger)">Stok yok</Pill>;
  if (n <= 5) return <Pill color="var(--warning)">{n} adet</Pill>;
  return <Pill color="var(--success)">{n} adet</Pill>;
}

export function StatusPill({ status }) {
  return status === 'active' ? <Pill color="var(--success)">Aktif</Pill> : <Pill color="var(--text-muted)">Pasif</Pill>;
}

export function MpPills({ list }) {
  if (!list || list.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Gönderilmedi</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {list.map((mp) => {
        const st = MP_STATUS[mp.status] || { label: mp.status, color: 'var(--text-secondary)' };
        const name = mp.connection?.supplierName || (mp.connection?.marketplaceType === 'trendyol' ? 'Trendyol' : mp.connection?.marketplaceType) || 'Pazaryeri';
        return <Pill key={mp.id} color={st.color} title={mp.errorMessage || undefined}>{name}: {st.label}</Pill>;
      })}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, wordBreak: 'break-word' }}>{children ?? '—'}</div>
    </div>
  );
}
