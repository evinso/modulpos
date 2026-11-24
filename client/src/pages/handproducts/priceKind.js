// What the number in the "price" box of a hand-added product MEANS depends on the price template of the products added by hand:
//   'profit'   a PURCHASE price; the template adds profit (percent / fixed / tiers) like for an XML product      -> "Alış fiyatı"
//   'purchase' a purchase price with profit 0                                                                    -> "Alış fiyatı"
//   'cash'     the NET amount the owner keeps per sale                                                           -> "Net tutar"
//   no template yet: either (the template decides)                                                               -> "Alış fiyatı / net tutar"
export function priceKind(template) {
  const m = template && template.exists ? template.netMode : null;
  if (m === 'profit' || m === 'purchase') return { mode: m, label: 'Alış fiyatı', lower: 'alış fiyatı', what: m === 'profit' ? 'Ürünün alış fiyatı: satış fiyatı, şablondaki kâr eklenerek hesaplanır.' : 'Ürünün alış fiyatı (şablonda kâr 0).' };
  if (m === 'cash') return { mode: 'cash', label: 'Net tutar', lower: 'net tutar', what: 'Satıştan sonra elinize kalmasını istediğiniz net tutar: satış fiyatı bunun üstüne giderler eklenerek hesaplanır.' };
  return { mode: null, label: 'Alış fiyatı / net tutar', lower: 'alış fiyatı / net tutar', what: 'Elle eklenen ürünler için henüz fiyat şablonu yok: şablondaki seçim bu sayının anlamını belirler (alış fiyatı + kâr, ya da elinize kalacak net tutar).' };
}
