// User-facing explanations for the price template form (kept together so the wording is easy to review).
export const ROUNDING_HELP = {
  none: 'Hesaplanan fiyat olduğu gibi kullanılır. Örnek: 129,37 ₺.',
  'ending:0.9': 'Fiyat, hesaplanan tutardan aşağı inmeyecek şekilde en yakın .90 ile biter. Örnek: 129,37 ₺ → 129,90 ₺.',
  'ending:0.99': 'Fiyat, hesaplanan tutardan aşağı inmeyecek şekilde en yakın .99 ile biter. Örnek: 129,37 ₺ → 129,99 ₺.',
  int: 'Fiyat yukarı doğru tam sayıya yuvarlanır. Örnek: 129,37 ₺ → 130 ₺.',
};
