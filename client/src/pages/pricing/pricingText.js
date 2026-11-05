// User-facing explanations for the price template form (kept together so the wording is easy to review).
export const ROUNDING_HELP = {
  none: 'Hesaplanan fiyat olduğu gibi kullanılır. Örnek: 129,37 ₺.',
  'ending:0.9': 'Fiyat, hesaplanan tutardan aşağı inmeyecek şekilde en yakın .90 ile biter. Örnek: 129,37 ₺ → 129,90 ₺.',
  'ending:0.99': 'Fiyat, hesaplanan tutardan aşağı inmeyecek şekilde en yakın .99 ile biter. Örnek: 129,37 ₺ → 129,99 ₺.',
  int: 'Fiyat yukarı doğru tam sayıya yuvarlanır. Örnek: 129,37 ₺ → 130 ₺.',
};

// The four ways to price. The user picks one first; the form then shows only what that type needs.
export const KINDS = [
  { key: 'percent', title: 'Yüzde kâr', tag: 'En yaygın yöntem',
    what: 'Her üründe alış fiyatınızın aynı yüzdesi kadar net kâr edersiniz.',
    when: 'Ürün fiyatları birbirine yakınsa ya da basit bir oran istiyorsanız.',
    example: 'Alış 100 ₺, kâr %30 → giderler ve komisyon karşılandıktan sonra elinizde 30 ₺ kalır.' },
  { key: 'fixed', title: 'Sabit TL kâr', tag: 'Her üründe aynı kazanç',
    what: 'Ürün ucuz da olsa pahalı da olsa her üründe aynı TL tutarı kazanırsınız.',
    when: 'Ucuz ürünlerde de en az belli bir kazanç istiyorsanız.',
    example: 'Kâr 25 ₺ → 40 ₺’lik ürün de 400 ₺’lik ürün de size net 25 ₺ bırakır.' },
  { key: 'tiered', title: 'Kademeli kâr', tag: 'Fiyata göre farklı kâr',
    what: 'Ürünün alış fiyatına göre farklı kâr uygularsınız (en fazla 3 kademe).',
    when: 'Yüzlerce ürününüz ve geniş bir fiyat aralığınız varsa: ucuz ürünlerde kargo ve komisyon payı büyük olduğu için orada daha yüksek, pahalılarda daha düşük kâr tutmak yaygındır.',
    example: '100 ₺ altı %40 · 100–300 ₺ arası %30 · 300 ₺ üstü %20.' },
  { key: 'barem', title: 'Kademeli kargolu (barem)', tag: 'Kargo ücreti fiyata göre değişiyorsa',
    what: 'Kargo ücretini satış fiyatına göre basamaklar halinde girersiniz; sistem her ürün için doğru basamağı kendisi seçer.',
    when: 'Pazaryeri kargo ücretini sipariş tutarına göre sabitliyorsa (ör. Trendyol baremi). Düşük kargo varsayıp fiyat yükselince zarar etmenizi önler.',
    example: '200 ₺’ye kadar 46 ₺ · 350 ₺’ye kadar 84 ₺ · üstü 190 ₺ (rakamlar örnektir, kendi tarifenizi yazın).' },
];
export const kindTitle = (k) => (KINDS.find((x) => x.key === k) || { title: 'Eski yöntem' }).title;
