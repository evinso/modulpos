export const nf = new Intl.NumberFormat('tr-TR');
export const num = (v) => (v === null || v === undefined ? '—' : nf.format(v));
export const usd = (v, digits = 2) => (v === null || v === undefined ? 'Bilinmiyor' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })}`);
export const dt = (v) => (v ? new Date(v).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const day = (v) => (v ? new Date(v).toLocaleDateString('tr-TR', { dateStyle: 'medium' }) : '—');
export const shortDay = (s) => { const [, m, d] = String(s).split('-'); return `${d}.${m}`; };
export const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
export const csvList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export const STATUS = {
  topic_discovered: ['Konu bulundu', ''], seo_researching: ['SEO araştırılıyor', 'info'], ready_to_generate: ['Üretime hazır', 'info'], generating: ['Üretiliyor', 'info'], fact_checking: ['Doğruluk kontrolünde', 'info'],
  needs_review: ['Onay bekliyor', 'warn'], ready: ['Yayına hazır', 'ok'], scheduled: ['Zamanlandı', 'ok'], published: ['Yayımlandı', 'ok'], needs_update: ['Güncelleme bekliyor', 'warn'],
  updating: ['Güncelleniyor', 'info'], archived: ['Arşivde', ''], failed: ['Başarısız', 'bad'],
};
export const TYPE_LABELS = {
  breaking_news_explainer: 'Son dakika açıklaması', latest_update: 'Güncel gelişme', how_to_guide: 'Nasıl yapılır rehberi', comparison: 'Karşılaştırma', faq: 'SSS', product_update: 'Ürün güncellemesi',
  consumer_alert: 'Tüketici uyarısı', evergreen_guide: 'Evergreen rehber',
};
export const RISK = { low: ['Düşük', 'ok'], review: ['İnceleme gerekli', 'warn'], blocked: ['Yayınlanamaz', 'bad'] };
// what a person may do by hand (mirrors the server's TRANSITIONS; the server decides)
export const NEXT = {
  topic_discovered: ['archived'], seo_researching: ['archived'], ready_to_generate: ['archived'], needs_review: ['ready', 'needs_update', 'archived'], ready: ['needs_review', 'archived'],
  needs_update: ['needs_review', 'archived'], failed: ['needs_review', 'archived'], archived: ['needs_review'], published: ['needs_update'],
};
