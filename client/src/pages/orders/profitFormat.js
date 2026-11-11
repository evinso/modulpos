/** 1234.5 -> "1.234,50 ₺"; null -> "—" */
export const tl = (n) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`);

/** A value that Trendyol has not confirmed yet is shown with "~" in front. */
export const approx = (n, source) => (n === null || n === undefined ? '—' : `${source === 'trendyol' || source === 'manual' ? '' : '~'}${tl(n)}`);

export const SOURCE_LABEL = { manual: 'elle girildi', snapshot: 'sipariş anındaki ürün maliyeti', product: 'ürünün şu anki maliyeti' };
