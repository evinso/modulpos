import { LayoutDashboard, Target, Globe2, TrendingUp, Compass, Search, BarChart3, Lightbulb, Sparkles, Archive, CalendarDays, HeartPulse, RefreshCw, Link2, ShieldCheck, Server, Send, LineChart, Bot, Gauge, Coins, Bell, History, Settings } from 'lucide-react';

/** The side menu in the order of the specification. `to` = a working page; `phase` = the development phase that builds the page (shown dimmed, not clickable). */
export const MENU = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
  { label: 'Site Nişi ve İçerik Stratejisi', to: '/strategy', icon: Target },
  { label: 'Dünya Gündemi', to: '/news', icon: Globe2 },
  { label: 'Trend Analizi', to: '/trends', icon: TrendingUp },
  { label: 'Niş Keşif Merkezi', to: '/niche', icon: Compass },
  { label: 'Anahtar Kelime Araştırması', to: '/keywords', icon: Search },
  { label: 'SEO Rekabet Analizi', to: '/serp', icon: BarChart3 },
  { label: 'İçerik Fırsatları', to: '/opportunities', icon: Lightbulb },
  { label: 'AI Makale Üretimi', to: '/writer', icon: Sparkles },
  { label: 'Makale Arşivi', to: '/articles', icon: Archive },
  { label: 'İçerik Takvimi', to: '/calendar', icon: CalendarDays },
  { label: 'İçerik Sağlığı', to: '/health', icon: HeartPulse },
  { label: 'Güncelleme Merkezi', to: '/updates', icon: RefreshCw },
  { label: 'İç Bağlantılar', to: '/internal-links', icon: Link2 },
  { label: 'AdSense Denetimi', icon: ShieldCheck, phase: 7 },
  { label: 'Web Sitelerim', to: '/sites', icon: Server },
  { label: 'Toplu Yayınlama', to: '/publishing', icon: Send },
  { label: 'SEO Performansı', to: '/performance', icon: LineChart },
  { label: 'Bot Yönetimi', to: '/bots', icon: Bot },
  { label: 'Günlük Çalışma Ayarları', to: '/limits', icon: Gauge },
  { label: 'API Kullanımı ve Maliyetler', to: '/api-usage', icon: Coins },
  { label: 'Bildirimler', to: '/notifications', icon: Bell, badge: 'unread' },
  { label: 'İşlem Geçmişi', to: '/logs', icon: History },
  { label: 'Sistem Ayarları', to: '/settings', icon: Settings },
];
