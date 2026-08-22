'use client'

import { useQuery } from '@tanstack/react-query'
import { Coins, Clock, TrendingUp, Gift } from 'lucide-react'
import { api } from '@/lib/api'
import { formatPoints, formatRelativeTime } from '@/lib/utils'
import { pointsToCurrency, canRedeem, MINIMUM_REDEMPTION_POINTS } from '@mop/shared'
import type { PointTransaction, PaginatedResponse } from '@mop/shared'

interface PointBalance {
  activePoints: number
  pendingPoints: number
  totalEarned: number
}

export default function PointsPage() {
  const { data: balance } = useQuery({
    queryKey: ['points-balance'],
    queryFn: async () => {
      const res = await api.get<{ data: PointBalance }>('/points/balance')
      return res.data.data
    },
  })

  const { data: history } = useQuery({
    queryKey: ['points-history'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<PointTransaction>>('/points/history')
      return res.data
    },
  })

  const active = balance?.activePoints ?? 0
  const pending = balance?.pendingPoints ?? 0

  return (
    <div className="pt-4 space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-brand-900/60 to-purple-900/40 border border-brand-800/40 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="w-4 h-4 text-brand-400" />
            <span className="text-xs text-gray-400">Kullanılabilir</span>
          </div>
          <p className="text-2xl font-bold text-white">{formatPoints(active)}</p>
          <p className="text-xs text-gray-500 mt-1">≈ ₺{pointsToCurrency(active).toFixed(2)}</p>
        </div>

        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-yellow-400" />
            <span className="text-xs text-gray-400">Beklemede</span>
          </div>
          <p className="text-2xl font-bold text-white">{formatPoints(pending)}</p>
          <p className="text-xs text-gray-500 mt-1">Yakında aktif olacak</p>
        </div>
      </div>

      {canRedeem(active) ? (
        <button className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2">
          <Gift className="w-5 h-5" />
          Puanları Ödüle Çevir
        </button>
      ) : (
        <div className="w-full py-3 bg-white/[0.03] border border-white/[0.06] text-gray-500 text-sm text-center rounded-xl">
          Çevirebilmek için {MINIMUM_REDEMPTION_POINTS - active} puan daha kazan
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-gray-400" />
          <h2 className="text-white font-semibold">İşlem Geçmişi</h2>
        </div>

        <div className="space-y-2">
          {(history?.data ?? []).map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between bg-white/[0.02] border border-white/[0.05] rounded-xl px-4 py-3"
            >
              <div>
                <p className="text-sm text-white capitalize">
                  {tx.type.replace('_', ' ')}
                </p>
                <p className="text-xs text-gray-500">{formatRelativeTime(tx.createdAt)}</p>
              </div>
              <div className="text-right">
                <p className={`font-semibold ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {tx.amount > 0 ? '+' : ''}{tx.amount}
                </p>
                {tx.status === 'pending' && (
                  <p className="text-xs text-yellow-500">beklemede</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
