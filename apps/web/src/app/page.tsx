import Link from 'next/link'
import { Camera, Trophy, Gift, Zap, ArrowRight, Star, Users, TrendingUp } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#070711] text-white overflow-x-hidden">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-[#070711]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            MOP
          </span>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-5 py-2 text-sm text-gray-300 hover:text-white border border-white/[0.08] hover:border-white/[0.2] rounded-xl transition-all duration-200"
            >
              Giriş Yap
            </Link>
            <Link
              href="/register"
              className="px-5 py-2 text-sm font-semibold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-xl transition-all duration-200 shadow-lg shadow-purple-900/30"
            >
              Başla
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative max-w-5xl mx-auto px-6 pt-28 pb-20 text-center">
        {/* Glow orbs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-20 left-1/4 w-[300px] h-[300px] bg-pink-600/8 rounded-full blur-[100px] pointer-events-none" />

        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/[0.05] border border-white/[0.1] rounded-full text-sm text-gray-300 mb-10 backdrop-blur-sm">
          <span>🔥</span>
          <span>Fotoğraf paylaş, gerçek para kazan</span>
        </div>

        {/* H1 */}
        <h1 className="text-6xl md:text-8xl font-bold leading-[1.05] mb-6 tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-white block">Her kareye</span>
          <span className="block bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent">
            değer katıyoruz
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Fotoğraf yükle, toplulukla etkileşime gir, marka challenge'larına katıl.
          <br className="hidden md:block" />
          Kazandığın puanları anında ödüle dönüştür.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          <Link
            href="/register"
            className="group inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold text-base rounded-2xl transition-all duration-200 shadow-xl shadow-purple-900/40 hover:shadow-purple-900/60 hover:scale-[1.02]"
          >
            Hemen Başla
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="#how"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] text-white font-semibold text-base rounded-2xl transition-all duration-200"
          >
            Nasıl Çalışır?
          </Link>
        </div>

        {/* Social proof */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500">
          <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-purple-400" /> 10K+ kullanıcı</span>
          <span className="w-1 h-1 rounded-full bg-white/20 hidden sm:block" />
          <span className="flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-pink-400" /> ₺500K dağıtıldı</span>
          <span className="w-1 h-1 rounded-full bg-white/20 hidden sm:block" />
          <span className="flex items-center gap-1.5"><Star className="w-3.5 h-3.5 text-orange-400" /> 50+ marka</span>
        </div>
      </section>

      {/* Stats Strip */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-3xl p-8 backdrop-blur-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:divide-x md:divide-white/[0.08]">
            {[
              { value: '12.450', label: 'Aktif Kullanıcı', color: 'from-purple-400 to-pink-400' },
              { value: '₺847.320', label: 'Ödül Dağıtıldı', color: 'from-pink-400 to-orange-400' },
              { value: '127', label: 'Marka Ortağı', color: 'from-orange-400 to-yellow-400' },
            ].map(({ value, label, color }) => (
              <div key={label} className="text-center md:px-8 first:pl-0 last:pr-0">
                <div className={`text-4xl md:text-5xl font-bold bg-gradient-to-r ${color} bg-clip-text text-transparent mb-2`} style={{ fontFamily: 'var(--font-display)' }}>
                  {value}
                </div>
                <div className="text-gray-400 text-sm font-medium">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-5xl mx-auto px-6 pb-28">
        <div className="text-center mb-16">
          <p className="text-purple-400 text-sm font-semibold tracking-widest uppercase mb-3">Süreç</p>
          <h2 className="text-4xl md:text-5xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            Nasıl çalışır?
          </h2>
        </div>

        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Connecting dashes — desktop only */}
          <div className="hidden md:block absolute top-10 left-[calc(33.33%+1rem)] right-[calc(33.33%+1rem)] border-t-2 border-dashed border-white/[0.1]" />

          {[
            {
              step: '01',
              icon: '👤',
              title: 'Kayıt ol',
              description: 'Kullanıcı adın ve e-postanla saniyeler içinde ücretsiz hesap aç.',
              gradient: 'from-purple-600 to-purple-400',
            },
            {
              step: '02',
              icon: '📸',
              title: 'Fotoğraf paylaş',
              description: 'Kaliteli fotoğraflar yükle, challenge'lara katıl, beğeni topla.',
              gradient: 'from-pink-600 to-pink-400',
            },
            {
              step: '03',
              icon: '🎁',
              title: 'Ödül kazan',
              description: 'Puanlarını hediye kartına, indirim koduna veya nakite çevir.',
              gradient: 'from-orange-600 to-orange-400',
            },
          ].map(({ step, icon, title, description, gradient }) => (
            <div key={step} className="relative bg-white/[0.04] border border-white/[0.08] rounded-3xl p-8 text-center hover:bg-white/[0.06] transition-all duration-300 group">
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br ${gradient} mb-5 text-2xl shadow-lg`}>
                {icon}
              </div>
              <div className={`text-6xl font-bold bg-gradient-to-br ${gradient} bg-clip-text text-transparent opacity-20 absolute top-4 right-6`} style={{ fontFamily: 'var(--font-display)' }}>
                {step}
              </div>
              <h3 className="text-white font-bold text-xl mb-3" style={{ fontFamily: 'var(--font-display)' }}>{title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-28">
        <div className="text-center mb-16">
          <p className="text-pink-400 text-sm font-semibold tracking-widest uppercase mb-3">Özellikler</p>
          <h2 className="text-4xl md:text-5xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            Neden MOP?
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: <Zap className="w-6 h-6" />,
              gradient: 'from-purple-600 to-violet-600',
              glow: 'shadow-purple-900/40',
              title: 'Puan Sistemi',
              description:
                'Her paylaşımdan, beğeniden, yorumdan ve challenge katılımından puan kazan. Birden fazla gelir kaynağı, sürekli kazanç.',
              tags: ['Paylaşım +5p', 'Beğeni +1p', 'Challenge +50p'],
            },
            {
              icon: <Trophy className="w-6 h-6" />,
              gradient: 'from-pink-600 to-rose-600',
              glow: 'shadow-pink-900/40',
              title: "Marka Challenge'ları",
              description:
                'Türkiye\'nin önde gelen markalarının açtığı challenge'lara katıl. En iyi fotoğraf büyük ödül havuzunu kap.',
              tags: ['Nike', 'Trendyol', 'LC Waikiki'],
            },
            {
              icon: <Gift className="w-6 h-6" />,
              gradient: 'from-orange-600 to-amber-600',
              glow: 'shadow-orange-900/40',
              title: 'Anlık Ödeme',
              description:
                'Puanların birikiyor, sen istediğinde bozduruluyor. Hediye kartı, indirim kodu veya doğrudan nakit.',
              tags: ['Hediye Kartı', 'Nakit', 'İndirim Kodu'],
            },
          ].map(({ icon, gradient, glow, title, description, tags }) => (
            <div
              key={title}
              className="bg-white/[0.04] border border-white/[0.08] rounded-3xl p-7 hover:bg-white/[0.06] transition-all duration-300 hover:-translate-y-1 group"
            >
              <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br ${gradient} mb-5 shadow-xl ${glow} text-white`}>
                {icon}
              </div>
              <h3 className="text-white font-bold text-xl mb-3" style={{ fontFamily: 'var(--font-display)' }}>{title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed mb-5">{description}</p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 bg-white/[0.06] border border-white/[0.08] rounded-full text-xs text-gray-300">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Challenge Preview */}
      <section className="max-w-5xl mx-auto px-6 pb-28">
        <div className="flex items-center justify-between mb-10">
          <div>
            <p className="text-orange-400 text-sm font-semibold tracking-widest uppercase mb-2">Canlı</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Aktif Challenge'lar
            </h2>
          </div>
          <Link href="/challenges" className="text-sm text-purple-400 hover:text-purple-300 transition-colors font-medium">
            Tümünü gör →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              brand: 'Nike Turkey',
              brandColor: 'from-gray-800 to-gray-900',
              badgeColor: 'from-orange-500 to-red-500',
              title: 'En İyi Spor Anı',
              reward: '₺15.000',
              entries: '2.341',
              daysLeft: 5,
              maxDays: 14,
              emoji: '👟',
            },
            {
              brand: 'Trendyol',
              brandColor: 'from-orange-900 to-orange-950',
              badgeColor: 'from-orange-400 to-pink-500',
              title: 'Tarz Senin Kuralın',
              reward: '₺25.000',
              entries: '5.102',
              daysLeft: 2,
              maxDays: 7,
              emoji: '🛍️',
            },
            {
              brand: 'LC Waikiki',
              brandColor: 'from-blue-900 to-blue-950',
              badgeColor: 'from-blue-400 to-cyan-500',
              title: 'Sonbahar Koleksiyonu',
              reward: '₺8.500',
              entries: '987',
              daysLeft: 9,
              maxDays: 14,
              emoji: '👗',
            },
          ].map(({ brand, brandColor, badgeColor, title, reward, entries, daysLeft, maxDays, emoji }) => (
            <Link
              key={title}
              href="/challenges"
              className="bg-white/[0.04] border border-white/[0.08] rounded-3xl overflow-hidden hover:bg-white/[0.06] hover:-translate-y-1 transition-all duration-300 group block"
            >
              {/* Banner */}
              <div className={`h-36 bg-gradient-to-br ${brandColor} flex items-center justify-center relative overflow-hidden`}>
                <div className="text-5xl">{emoji}</div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                {/* Reward badge */}
                <div className={`absolute top-3 right-3 px-3 py-1 bg-gradient-to-r ${badgeColor} rounded-full text-white text-xs font-bold shadow-lg`}>
                  {reward} havuz
                </div>
              </div>

              <div className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-6 h-6 rounded-full bg-gradient-to-br ${brandColor} border border-white/10 flex items-center justify-center text-xs`}>
                    {emoji}
                  </div>
                  <span className="text-gray-400 text-xs font-medium">{brand}</span>
                </div>
                <h3 className="text-white font-semibold text-base mb-3" style={{ fontFamily: 'var(--font-display)' }}>{title}</h3>

                <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                  <span>{entries} katılım</span>
                  <span className={daysLeft <= 3 ? 'text-red-400 font-semibold' : ''}>{daysLeft} gün kaldı</span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${badgeColor} rounded-full`}
                    style={{ width: `${Math.round(((maxDays - daysLeft) / maxDays) * 100)}%` }}
                  />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="relative bg-gradient-to-br from-purple-950/80 via-[#0d0818] to-pink-950/40 border border-white/[0.08] rounded-3xl p-16 text-center overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[200px] bg-purple-600/15 rounded-full blur-[80px] pointer-events-none" />
          <div className="absolute bottom-0 right-1/4 w-[300px] h-[200px] bg-pink-600/10 rounded-full blur-[80px] pointer-events-none" />

          <h2 className="relative text-4xl md:text-6xl font-bold text-white mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            Bugün başla,
            <br />
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent">yarın kazan.</span>
          </h2>
          <p className="relative text-gray-400 text-lg mb-10 max-w-lg mx-auto">
            Binlerce kullanıcı zaten kazanıyor. Sıra sende.
          </p>
          <Link
            href="/register"
            className="relative inline-flex items-center gap-2 px-10 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-lg rounded-2xl transition-all duration-200 shadow-xl shadow-purple-900/50 hover:scale-[1.02]"
          >
            Ücretsiz Kayıt Ol
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent" style={{ fontFamily: 'var(--font-display)' }}>
            MOP
          </span>
          <p className="text-gray-600 text-sm">© 2026 MOP. Tüm hakları saklıdır.</p>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <Link href="#" className="hover:text-white transition-colors">Gizlilik</Link>
            <Link href="#" className="hover:text-white transition-colors">Kullanım Şartları</Link>
            <Link href="#" className="hover:text-white transition-colors">İletişim</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
