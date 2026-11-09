/** Does a BuyBox row match what was typed? Title, barcode and SKU; every word must appear (Turkish letters folded). */
export function matchesQuery(row, query) {
  const words = String(query || '').toLocaleLowerCase('tr').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [row.title, row.product?.title, row.barcode, row.sku, row.product?.sku]
    .filter(Boolean).join(' ').toLocaleLowerCase('tr');
  return words.every(w => hay.includes(w));
}
