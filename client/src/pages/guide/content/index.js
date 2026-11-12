import { START } from './start';
import { ACCOUNT } from './account';
import { XML } from './xml';
import { PRICING } from './pricing';
import { CATALOG } from './catalog';
import { SELLING } from './selling';
import { MONEY } from './money';
import { HELP } from './help';

// Okuma sırası = kurulum sırası: başlangıç → hesap/bağlantı → XML → fiyat → ürün/kategori → gönderim → sipariş/kâr → destek
export const SECTIONS = [...START, ...ACCOUNT, ...XML, ...PRICING, ...CATALOG, ...SELLING, ...MONEY, ...HELP];
export const GUIDE_UPDATED = '12 Kasım 2026';
