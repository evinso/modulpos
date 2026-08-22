'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { use } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Trophy, Clock, Users, ArrowLeft, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatPoints } from '@/lib/utils'
import type { ChallengeWithBrand, PostWithUser, PaginatedResponse } from '@mop/shared'

interface DetailChallenge extends ChallengeWithBrand {
  isJoined?: boolean
}

export default function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: challenge, isLoading } = useQuery({
    queryKey: ['challenge', id],
    queryFn: async () => {
      const res = await api.get<{ data: DetailChallenge }>(`/challenges/${id}`)
      return res.data.data
    },
  })

  const { data: entries } = useQuery({
    queryKey: ['challenge-entries', id],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<PostWithUser>>(`/challenges/${id}/entries`)
      return res.data
    },
  })

  const joinMutation = useMutation({
    mutationFn: () => api.post(`/challenges/${id}/join`),
    onSuccess: () => {
      toast.success('Challenge\'a katıldın! Şimdi fotoğraf yükle.')
      queryClient.invalidateQueries({ queryKey: ['challenge', id] })
      router.push(`/upload?challengeId=${id}`)
    },
    onError: () => toast.error('Katılım başarısız, tekrar dene'),
  })

  const daysLeft = challenge
    ? Math.max(0, Math.ceil((new Date(challenge.endDate).getTime() - Date.now()) / 86_400_000))
    : 0

  if (isLoading) {
    return (
      <div className="pt-4 space-y-4">
        <div className="h-48 bg-white/[0.03] rounded-2xl animate-pulse" />
        <div className="h-24 bg-white/[0.03] rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (!challenge) return null

  return (
    <div className="pt-4 pb-24">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4 text-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        Geri
      </button>

      {challenge.imageUrl && (
        <div className="relative h-48 w-full rounded-2xl overflow-hidden mb-4">
          <Image src={challenge.imageUrl} alt={challenge.title} fill className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-4 left-4">
            <p className="text-brand-300 text-xs font-medium mb-1">{challenge.brand.name}</p>
            <h1 className="text-white text-xl font-bold">{challenge.title}</h1>
          </div>
        </div>
      )}

      {!challenge.imageUrl && (
        <div className="mb-4">
          <p className="text-brand-400 text-sm font-medium mb-1">{challenge.brand.name}</p>
          <h1 className="text-white text-2xl font-bold">{challenge.title}</h1>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gradient-to-br from-brand-950/60 to-purple-950/40 border border-brand-800/40 rounded-2xl p-4 text-center">
          <Trophy className="w-5 h-5 text-brand-400 mx-auto mb-1" />
          <p className="text-white font-bold text-lg">{formatPoints(challenge.rewardPool)}</p>
          <p className="text-gray-500 text-xs">₺ ödül</p>
        </div>
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 text-center">
          <Users className="w-5 h-5 text-blue-400 mx-auto mb-1" />
          <p className="text-white font-bold text-lg">{challenge.entryCount}</p>
          <p className="text-gray-500 text-xs">katılımcı</p>
        </div>
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 text-center">
          <Clock className="w-5 h-5 text-orange-400 mx-auto mb-1" />
          <p className="text-white font-bold text-lg">{daysLeft}</p>
          <p className="text-gray-500 text-xs">gün kaldı</p>
        </div>
      </div>

      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-4">
        <h2 className="text-white font-semibold mb-2">Açıklama</h2>
        <p className="text-gray-400 text-sm leading-relaxed">{challenge.description}</p>
      </div>

      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-6">
        <h2 className="text-white font-semibold mb-2">Ödül Dağılımı</h2>
        {Array.from({ length: Math.min(challenge.maxWinners, 3) }).map((_, i) => {
          const prizes = [0.5, 0.3, 0.2]
          const amount = Math.floor(challenge.rewardPool * (prizes[i] ?? 0.1))
          return (
            <div key={i} className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
              <span className="text-gray-400 text-sm">{i + 1}. Sıra</span>
              <span className="text-white font-medium text-sm">₺{amount.toLocaleString()}</span>
            </div>
          )
        })}
      </div>

      {challenge.isJoined ? (
        <div className="w-full py-3.5 bg-green-900/30 border border-green-800/40 text-green-400 font-semibold rounded-xl flex items-center justify-center gap-2">
          <CheckCircle className="w-5 h-5" />
          Katıldın
        </div>
      ) : (
        <button
          onClick={() => joinMutation.mutate()}
          disabled={joinMutation.isPending}
          className="w-full py-3.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors"
        >
          {joinMutation.isPending ? 'Katılınıyor...' : "Challenge'a Katıl"}
        </button>
      )}

      {(entries?.data ?? []).length > 0 && (
        <div className="mt-8">
          <h2 className="text-white font-semibold mb-3">Katılımlar</h2>
          <div className="grid grid-cols-3 gap-1">
            {entries!.data.map((post) => (
              <div key={post.id} className="aspect-square relative bg-gray-900 rounded-lg overflow-hidden">
                <Image src={post.imageUrl} alt="" fill className="object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
