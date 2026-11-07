// Every WhatsApp event the platform can send. ONE list: the page renders its checklist from it (GET /whatsapp/events) and the
// notifiers below use the same keys, so a label can never drift from what really fires.
// `to`: who gets it — 'admin' (the admin phone), 'user' (the phone of the account concerned), 'both'.
const EVENTS = [
  { group: 'Sipariş', key: 'new_order', to: 'both', label: 'Yeni sipariş' },
  { group: 'Sipariş', key: 'order_status', to: 'both', label: 'Sipariş durumu değişti (kargoda, teslim, iptal, iade)' },
  { group: 'Sipariş', key: 'new_question', to: 'user', label: 'Yeni müşteri sorusu geldi' },
  { group: 'Üyelik ve ödeme', key: 'new_user', to: 'admin', label: 'Yeni üye kaydı' },
  { group: 'Üyelik ve ödeme', key: 'user_login', to: 'admin', label: 'Kullanıcı girişi (her giriş)' },
  { group: 'Üyelik ve ödeme', key: 'subscription', to: 'both', label: 'Abonelik güncellendi' },
  { group: 'Üyelik ve ödeme', key: 'subscription_expiring', to: 'both', label: 'Abonelik bitmek üzere (3 gün kala)' },
  { group: 'Üyelik ve ödeme', key: 'subscription_expired', to: 'both', label: 'Abonelik süresi doldu' },
  { group: 'Üyelik ve ödeme', key: 'credit_topup', to: 'both', label: 'Kredi yüklendi' },
  { group: 'Üyelik ve ödeme', key: 'low_credit', to: 'both', label: 'Düşük kredi uyarısı' },
  { group: 'Üyelik ve ödeme', key: 'payment_failed', to: 'both', label: 'Ödeme başarısız' },
  { group: 'Destek', key: 'new_support_ticket', to: 'both', label: 'Yeni destek talebi açıldı' },
  { group: 'Destek', key: 'support_user_reply', to: 'admin', label: 'Kullanıcı destek talebine yeni mesaj yazdı' },
  { group: 'Destek', key: 'support_reply', to: 'both', label: 'Destek talebi yanıtlandı' },
  { group: 'Destek', key: 'support_status', to: 'both', label: 'Destek talebinin durumu değişti' },
  { group: 'XML ve ürün', key: 'product_sync', to: 'both', label: 'XML güncellendi (yeni / güncellenen / kalkan ürün olduğunda)' },
  { group: 'XML ve ürün', key: 'xml_error', to: 'admin', label: 'XML senkron hatası' },
  { group: 'XML ve ürün', key: 'xml_stale', to: 'user', label: 'XML uzun süredir güncellenemiyor' },
  { group: 'XML ve ürün', key: 'new_xml_source', to: 'user', label: 'Yeni XML kaynağı eklendi' },
  { group: 'XML ve ürün', key: 'manual_price_loss', to: 'user', label: 'Elle fiyatlı ürün zarara düştü' },
  { group: 'Pazaryeri', key: 'trendyol_update', to: 'both', label: 'Trendyol fiyat/stok otomatik güncellendi' },
  { group: 'Pazaryeri', key: 'product_send', to: 'user', label: 'Ürün gönderim sonucu' },
  { group: 'Pazaryeri', key: 'new_marketplace', to: 'both', label: 'Yeni pazaryeri bağlandı' },
  { group: 'Pazaryeri', key: 'buybox', to: 'user', label: 'BuyBox uyarısı / BuyBox fiyat güncellemesi' },
  { group: 'Pazaryeri', key: 'dropship', to: 'user', label: 'Dropship sipariş oluştu / durumu değişti' },
  { group: 'Sistem', key: 'announcement', to: 'user', label: 'Yönetici duyurusu' },
];
const KEYS = EVENTS.map((e) => e.key);
module.exports = { EVENTS, KEYS };
