import { Zap, LayoutDashboard, Target, Globe2, TrendingUp, Compass, Search, BarChart3, Lightbulb, Sparkles, Archive, CalendarDays, HeartPulse, RefreshCw, Link2, ShieldCheck, Server, Send, LineChart, Coins, Bell, FileText, History } from 'lucide-react';

/** The side menu, grouped by the way the work flows: research -> content -> publishing -> upkeep -> automation. `to` = the page it opens; a group without `title` is shown without a heading. */
export const GROUPS = [
  { title: null, items: [
    { label: 'Otomasyon ve Ayarlar', to: '/automation', icon: Zap },
    { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
  ] },
  { title: 'Strateji ve araştırma', items: [
    { label: 'Site Nişi ve İçerik Stratejisi', to: '/strategy', icon: Target },
    { label: 'Dünya Gündemi', to: '/news', icon: Globe2 },
    { label: 'Trend Analizi', to: '/trends', icon: TrendingUp },
    { label: 'Niş Keşif Merkezi', to: '/niche', icon: Compass },
    { label: 'Anahtar Kelime Araştırması', to: '/keywords', icon: Search },
    { label: 'SEO Rekabet Analizi', to: '/serp', icon: BarChart3 },
    { label: 'İçerik Fırsatları', to: '/opportunities', icon: Lightbulb },
  ] },
  { title: 'İçerik', items: [
    { label: 'AI Makale Üretimi', to: '/writer', icon: Sparkles },
    { label: 'Makale Arşivi', to: '/articles', icon: Archive },
  ] },
  { title: 'Yayın', items: [
    { label: 'Web Sitelerim', to: '/sites', icon: Server },
    { label: 'Toplu Yayınlama', to: '/publishing', icon: Send },
    { label: 'İçerik Takvimi', to: '/calendar', icon: CalendarDays },
    { label: 'AdSense Denetimi', to: '/adsense', icon: ShieldCheck },
  ] },
  { title: 'Bakım ve performans', items: [
    { label: 'İçerik Sağlığı', to: '/health', icon: HeartPulse },
    { label: 'Güncelleme Merkezi', to: '/updates', icon: RefreshCw },
    { label: 'İç Bağlantılar', to: '/internal-links', icon: Link2 },
    { label: 'SEO Performansı', to: '/performance', icon: LineChart },
    { label: 'Raporlar', to: '/reports', icon: FileText },
  ] },
  { title: 'Bağlantılar ve kayıtlar', items: [
    { label: 'API Kullanımı ve Maliyetler', to: '/api-usage', icon: Coins },
    { label: 'Bildirimler', to: '/notifications', icon: Bell, badge: 'unread' },
    { label: 'İşlem Geçmişi', to: '/logs', icon: History },
  ] },
];
/** the same pages as one flat list */
export const MENU = GROUPS.flatMap((g) => g.items);
