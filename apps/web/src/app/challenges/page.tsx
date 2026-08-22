'use client'

import { useQuery } from '@tanstack/react-query'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { Trophy, Clock, Users, Flame, TrendingUp } from 'lucide-react'
import { api } from '@/lib/api'
import { formatPoints, formatRelativeTime } from '@/lib/utils'
import type { ChallengeWithBrand, PaginatedResponse } from '@mop/shared'

const FILTERS = [
  { id: 'all', label: 'Tümü' },
  { id: 'ending', label: 'Bu Hafta Bitiyor', icon: Flame },
  { id: 'top', label: 'En Yüksek Ödül', icon: TrendingUp },
]

// Gradient palettes for cards that have no image
const CARD_GRADIENTS = [
  'from-purple-900 to-violet-950',
  'from-pink-900 to-rose-950',
  'from-orange-900 to-amber-950',
  'from-blue-900 to-indigo-950',
  'from-teal-900 to-emerald-950',
]

export default function ChallengesPage() {
  const [activeFilter, setActiveFilter] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['challenges'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<ChallengeWithBrand>>('/challenges')
      return res.data
    },
  })

  const challenges = data?.data ?? []

  return (
    <div className="min-h-screen bg-[#070711]">
      {/* Hero Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-purple-950 via-[#0d0818] to-pink-950/50 px-6 pt-8 pb-10">
        {/* Orbs */}
        <div className="absolute top-0 right-1/4 w-64 h-48 bg-purple-600/20 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-48 h-40 bg-pink-600/15 rounded-full blur-[60px] pointer-events-none" />

        <div className="relative max-w-2xl mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-white" />
            </div>
            <span className="text-purple-300 text-sm font-semibold tracking-wide uppercase">Challenge'lar</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            Yarış, kazan, öne çık.
          </h1>
          <p className="text-gray-400 text-sm leading-relaxed max-w-lg">
            Markaların açtığı yarışmalara katıl, büyük ödüller kazan. En iyi fotoğraf ödül havuzunu alır.
          </p>

          {/* Mini stats */}
          <div className="flex items-center gap-6 mt-6 text-sm">
            <div>
              <span className="text-white font-bold text-xl" style={{ fontFamily: 'var(--font-display)' }}>127</span>
              <p className="text-gray-500 text-xs">Aktif challenge</p>
            </div>
            <div className="w-px h-8 bg-white/[0.08]" />
            <div>
              <span className="text-white font-bold text-xl" style={{ fontFamily: 'var(--font-display)' }}>₺1.2M</span>
              <p className="text-gray-500 text-xs">Toplam ödül havuzu</p>
            </div>
            <div className="w-px h-8 bg-white/[0.08]" />
            <div>
              <span className="text-white font-bold text-xl" style={{ fontFamily: 'var(--font-display)' }}>50+</span>
              <p className="text-gray-500 text-xs">Marka ortağı</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="max-w-2xl mx-auto px-4 pt-5 pb-2">
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {FILTERS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveFilter(id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 transition-all duration-200 ${
                activeFilter === id
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-900/30'
                  : 'bg-white/[0.04] border border-white/[0.08] text-gray-400 hover:text-white hover:border-white/[0.15]'
              }`}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Challenge Cards */}
      <div className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-4">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="bg-white/[0.04] border border-white/[0.06] rounded-3xl overflow-hidden animate-pulse"
              >
                <div className="h-44 bg-white/[0.04]" />
                <div className="p-5 space-y-3">
                  <div className="w-32 h-4 bg-white/[0.08] rounded-full" />
                  <div className="w-48 h-5 bg-white/[0.08] rounded-full" />
                  <div className="w-full h-1.5 bg-white/[0.04] rounded-full" />
                </div>
              </div>
            ))
          : challenges.map((challenge, i) => {
              const gradient = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
              const daysLeft = Math.max(
                0,
                Math.ceil(
                  (new Date(challenge.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                )
              )
              const progressPct = Math.min(100, Math.max(5, 100 - (daysLeft / 14) * 100))

              return (
                <Link
                  key={challenge.id}
                  href={`/challenges/${challenge.id}`}
                  className="block bg-white/[0.04] border border-white/[0.06] rounded-3xl overflow-hidden hover:bg-white/[0.06] hover:border-white/[0.1] hover:-translate-y-0.5 transition-all duration-200 group"
                >
                  {/* Image banner */}
                  <div className={`relative h-44 w-full bg-gradient-to-br ${gradient} overflow-hidden`}>
                    {challenge.imageUrl && (
                      <Image
                        src={challenge.imageUrl}
                        alt={challenge.title}
                        fill
                        className="object-cover"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

                    {/* Reward badge */}
                    <div className="absolute top-3 right-3 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full text-white text-xs font-bold shadow-lg">
                      {formatPoints(challenge.rewardPool)} ödül
                    </div>

                    {/* Ending soon badge */}
                    {daysLeft <= 3 && (
                      <div className="absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 bg-red-500/90 backdrop-blur-sm rounded-full text-white text-xs font-semibold">
                        <Flame className="w-3 h-3" />
                        <span>Son {daysLeft} gün!</span>
                      </div>
                    )}
                  </div>

                  {/* Brand logo overlapping image */}
                  <div className="px-5 -mt-5 mb-0 flex items-end">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-900 to-pink-900 border-2 border-[#070711] flex items-center justify-center text-xl shadow-lg">
                      {challenge.brand.name[0]}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="px-5 pt-3 pb-5">
                    <p className="text-purple-400 text-xs font-semibold mb-1">{challenge.brand.name}</p>
                    <h2 className="text-white font-bold text-lg mb-4" style={{ fontFamily: 'var(--font-display)' }}>
                      {challenge.title}
                    </h2>

                    {/* Meta row */}
                    <div className="flex items-center gap-5 text-xs text-gray-500 mb-4">
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-gray-600" />
                        {challenge.entryCount} katılımcı
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-gray-600" />
                        {formatRelativeTime(challenge.endDate)} sona eriyor
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">Süre dolumu</span>
                        <span className={`font-medium ${daysLeft <= 3 ? 'text-red-400' : 'text-gray-400'}`}>
                          {daysLeft} gün kaldı
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            daysLeft <= 3
                              ? 'bg-gradient-to-r from-red-500 to-orange-500'
                              : 'bg-gradient-to-r from-purple-500 to-pink-500'
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
      </div>
    </div>
  )
}
