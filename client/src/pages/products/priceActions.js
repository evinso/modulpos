import api from '../../services/api';

/** The message the server gave for a failed request, in plain words. */
export function errorText(err, fallback) {
  const d = err && err.response && err.response.data;
  if (d) {
    if (Array.isArray(d.details) && d.details.length) return `${d.error ? d.error + ': ' : ''}${String(d.details[0])}`;
    if (typeof d.error === 'string') return d.error;
    if (typeof d.message === 'string') return d.message;
  }
  return fallback;
}

/**
 * Sends one product's current sale price to the marketplace.
 *   already on sale  -> price (and stock) update
 *   never sent       -> the product is created with that price
 *   waiting / removed -> nothing can be sent yet; says why
 * Returns { kind: 'update' | 'create' | 'wait' | 'blocked' | 'unsupported', message }.
 */
export async function pushToMarketplace(productId, connection, listing) {
  if (!connection || connection.marketplaceType !== 'trendyol') {
    return { kind: 'unsupported', message: 'Bu pazaryerine buradan gönderim henüz desteklenmiyor; fiyat kaydedildi.' };
  }
  const st = listing && listing.status;
  if (st === 'active') {
    const r = await api.post(`/marketplace/connections/${connection.id}/sync-price-stock`, { productIds: [productId] });
    return { kind: 'update', message: r.data.message || 'Fiyat Trendyol’da güncellendi' };
  }
  if (!listing || st === 'rejected') {
    const r = await api.post(`/marketplace/connections/${connection.id}/send-products`, { productIds: [productId] });
    return { kind: 'create', message: r.data.message || 'Ürün Trendyol’a gönderildi' };
  }
  if (st === 'pending') return { kind: 'wait', message: 'Ürün Trendyol’da onay bekliyor; onaylanınca fiyatı gönderebilirsiniz. Fiyat kaydedildi.' };
  return { kind: 'blocked', message: 'Ürün Trendyol’da satışta değil; önce Trendyol panelinden düzeltin. Fiyat kaydedildi.' };
}

export const sendLabel = (listing) => {
  const st = listing && listing.status;
  if (st === 'active') return 'Trendyol’da güncelle';
  if (!listing || st === 'rejected') return 'Trendyol’a gönder';
  return null; // pending / removed: nothing to send yet
};
