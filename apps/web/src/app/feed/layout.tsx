'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Trophy, PlusSquare, User, Coins, Search } from 'lucide-react'
import { useAuthStore } from '@/store/auth'

const NAV_ITEMS = [
  { href: '/feed', icon: Home, label: 'Ana Sayfa' },
  { href: '/challenges', icon: Trophy, label: 'Challenge' },
  { href: '/upload', icon: PlusSquare, label: 'Paylaş' },
  { href: '/profile', icon: User, label: 'Profil' },
]

export default function FeedLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const user = useAuthStore((s) => s.user)

  return (
    <div className="min-h-screen bg-[#070711]">
      {/* Top Nav */}
      <header className="sticky top-0 z-50 bg-[#070711]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-4">
          {/* Logo */}
          <Link
            href="/feed"
            className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent flex-shrink-0"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            MOP
          </Link>

          {/* Search bar */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
            <input
              type="text"
              placeholder="Ara..."
              readOnly
              className="w-full pl-9 pr-4 py-2 bg-white/[0.04] border border-white/[0.06] rounded-xl text-sm text-gray-400 placeholder-gray-600 outline-none cursor-pointer"
            />
          </div>

          {/* Right: points + avatar */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <Link
              href="/points"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-950/60 border border-purple-800/40 rounded-full text-purple-300 text-xs font-semibold hover:bg-purple-900/40 transition-colors"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>{user?.totalPoints ?? 0}</span>
            </Link>

            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold ring-2 ring-white/[0.08]">
              {user?.username?.[0]?.toUpperCase() ?? 'U'}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 pb-24">{children}</div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#070711]/80 backdrop-blur-xl border-t border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-around">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== '/feed' && pathname.startsWith(href))
            const isUpload = href === '/upload'

            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center gap-1 relative transition-all duration-200 ${
                  isUpload
                    ? 'text-white'
                    : active
                    ? 'text-purple-400'
                    : 'text-gray-600 hover:text-gray-300'
                }`}
              >
                {isUpload ? (
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center shadow-lg shadow-purple-900/40 -mt-4">
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                ) : (
                  <>
                    <Icon className={`w-5 h-5 ${active ? 'text-purple-400' : ''}`} />
                    <span className={`text-[10px] font-medium ${active ? 'text-purple-400' : ''}`}>
                      {label}
                    </span>
                    {active && (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-purple-400" />
                    )}
                  </>
                )}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
