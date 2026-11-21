import { LayoutDashboard, Target, Globe2, TrendingUp, Compass, Search, BarChart3, Lightbulb, Sparkles, Archive, CalendarDays, HeartPulse, RefreshCw, ShieldCheck, Server, Send, LineChart, Bot, Gauge, Coins, Bell, History, Settings } from 'lucide-react';

/** The side menu in the order of the specification. `to` = a working page; `phase` = the development phase that builds the page (shown dimmed, not clickable). */
export const MENU = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
  { label: 'Site Nişi ve İçerik Stratejisi', to: '/strategy', icon: Target },
  { label: 'Dünya Gündemi', icon: Globe2, phase: 2 },
  { label: 'Trend Analizi', icon: TrendingUp, phase: 2 },
  { label: 'Niş Keşif Merkezi', icon: Compass, phase: 2 },
  { label: 'Anahtar Kelime Araştırması', icon: Search, phase: 2 },
  { label: 'SEO Rekabet Analizi', icon: BarChart3, phase: 2 },
  { label: 'İçerik Fırsatları', icon: Lightbulb, phase: 2 },
  { label: 'AI Makale Üretimi', icon: Sparkles, phase: 3 },
  { label: 'Makale Arşivi', to: '/articles', icon: Archive },
  { label: 'İçerik Takvimi', icon: CalendarDays, phase: 5 },
  { label: 'İçerik Sağlığı', icon: HeartPulse, phase: 6 },
  { label: 'Güncelleme Merkezi', icon: RefreshCw, phase: 6 },
  { label: 'AdSense Denetimi', icon: ShieldCheck, phase: 7 },
  { label: 'Web Sitelerim', icon: Server, phase: 5 },
  { label: 'Toplu Yayınlama', icon: Send, phase: 5 },
  { label: 'SEO Performansı', icon: LineChart, phase: 6 },
  { label: 'Bot Yönetimi', to: '/bots', icon: Bot },
  { label: 'Günlük Çalışma Ayarları', to: '/limits', icon: Gauge },
  { label: 'API Kullanımı ve Maliyetler', to: '/api-usage', icon: Coins },
  { label: 'Bildirimler', to: '/notifications', icon: Bell, badge: 'unread' },
  { label: 'İşlem Geçmişi', to: '/logs', icon: History },
  { label: 'Sistem Ayarları', to: '/settings', icon: Settings },
];
