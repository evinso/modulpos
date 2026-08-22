'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Flame, LogOut, Coins, Camera } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { formatPoints } from '@/lib/utils'
import { pointsToCurrency } from '@mop/shared'
import type { User, PostWithUser, PaginatedResponse } from '@mop/shared'

export default function ProfilePage() {
  const router = useRouter()
  const { user: cached, logout } = useAuthStore()

  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/users/me')
      return res.data.data
    },
    initialData: cached ?? undefined,
  })

  const { data: posts } = useQuery({
    queryKey: ['my-posts'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<PostWithUser>>('/posts/feed', {
        params: { userId: user?.id, limit: 12 },
      })
      return res.data
    },
    enabled: !!user?.id,
  })

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <div className="pt-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-white text-xl font-bold">Profil</h1>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-gray-500 hover:text-white transition-colors text-sm"
        >
          <LogOut className="w-4 h-4" />
          Çıkış
        </button>
      </div>

      {user && (
        <>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-20 h-20 rounded-full bg-brand-950/60 border border-brand-800/40 overflow-hidden flex-shrink-0">
              {user.avatarUrl ? (
                <Image src={user.avatarUrl} alt={user.username} width={80} height={80} className="object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-brand-400 text-2xl font-bold">
                  {user.username[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <p className="text-white text-lg font-bold">@{user.username}</p>
              {user.bio && <p className="text-gray-400 text-sm mt-0.5">{user.bio}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Coins className="w-4 h-4 text-brand-400" />
              </div>
              <p className="text-white font-bold text-lg">{formatPoints(user.totalPoints)}</p>
              <p className="text-gray-500 text-xs mt-0.5">≈ ₺{pointsToCurrency(user.totalPoints).toFixed(0)}</p>
            </div>

            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Flame className="w-4 h-4 text-orange-400" />
              </div>
              <p className="text-white font-bold text-lg">{user.streakDays}</p>
              <p className="text-gray-500 text-xs mt-0.5">Gün serisi</p>
            </div>

            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Camera className="w-4 h-4 text-blue-400" />
              </div>
              <p className="text-white font-bold text-lg">{posts?.data.length ?? 0}</p>
              <p className="text-gray-500 text-xs mt-0.5">Gönderi</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {(posts?.data ?? []).map((post) => (
              <div key={post.id} className="aspect-square relative bg-gray-900 rounded-lg overflow-hidden">
                <Image src={post.imageUrl} alt="" fill className="object-cover" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
