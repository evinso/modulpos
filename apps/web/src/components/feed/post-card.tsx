'use client'

import Image from 'next/image'
import { Heart, MessageCircle, Bookmark, Share2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type { PostWithUser } from '@mop/shared'

interface Props {
  post: PostWithUser
}

export function PostCard({ post }: Props) {
  const [liked, setLiked] = useState(post.isLiked ?? false)
  const [saved, setSaved] = useState(post.isSaved ?? false)
  const [likeCount, setLikeCount] = useState(post.likeCount)
  const [showPointsBadge, setShowPointsBadge] = useState(false)
  const queryClient = useQueryClient()

  const likeMutation = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/like`),
    onMutate: () => {
      const wasLiked = liked
      setLiked((v) => !v)
      setLikeCount((c) => (wasLiked ? c - 1 : c + 1))
      if (!wasLiked) {
        setShowPointsBadge(true)
        setTimeout(() => setShowPointsBadge(false), 2000)
      }
    },
    onError: () => {
      setLiked((v) => !v)
      setLikeCount((c) => (liked ? c + 1 : c - 1))
    },
  })

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/save`),
    onMutate: () => setSaved((v) => !v),
    onError: () => setSaved((v) => !v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-posts'] }),
  })

  return (
    <article className="bg-white/[0.04] border border-white/[0.06] rounded-3xl overflow-hidden hover:bg-white/[0.05] transition-colors duration-200">
      {/* User info row */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ring-2 ring-white/[0.06] overflow-hidden">
            {post.user.avatarUrl ? (
              <Image
                src={post.user.avatarUrl}
                alt={post.user.username}
                width={36}
                height={36}
                className="object-cover w-full h-full"
              />
            ) : (
              post.user.username[0]?.toUpperCase()
            )}
          </div>
          <div>
            <p className="text-white text-sm font-semibold leading-tight">{post.user.username}</p>
            <p className="text-gray-500 text-xs">{formatRelativeTime(post.createdAt)}</p>
          </div>
        </div>

        <button className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.1] hover:border-purple-500/60 hover:bg-purple-950/40 text-gray-400 hover:text-purple-300 text-xs font-medium rounded-full transition-all duration-200">
          <UserPlus className="w-3 h-3" />
          <span>Takip Et</span>
        </button>
      </div>

      {/* Image */}
      <div className="relative aspect-square w-full bg-gray-900">
        <Image
          src={post.imageUrl}
          alt={post.caption ?? 'post'}
          fill
          className="object-cover"
          sizes="(max-width: 672px) 100vw, 672px"
        />

        {/* Points badge — shows briefly after like */}
        {showPointsBadge && (
          <div className="absolute top-3 right-3 flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full text-white text-xs font-bold shadow-lg animate-in fade-in zoom-in duration-200">
            <span>Puan: +3</span>
            <span>✨</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-5">
            <button
              onClick={() => likeMutation.mutate()}
              className="flex items-center gap-1.5 text-sm group"
            >
              <Heart
                className={`w-5 h-5 transition-all duration-200 ${
                  liked
                    ? 'fill-red-500 text-red-500 scale-110'
                    : 'text-gray-500 hover:text-red-400 group-hover:scale-110'
                }`}
              />
              <span className={`text-sm font-medium transition-colors ${liked ? 'text-red-400' : 'text-gray-500'}`}>
                {likeCount}
              </span>
            </button>

            <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors group">
              <MessageCircle className="w-5 h-5 group-hover:scale-110 transition-transform" />
              <span className="font-medium">{post.commentCount}</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => saveMutation.mutate()}
              className="text-gray-500 hover:text-white transition-all duration-200 hover:scale-110"
            >
              <Bookmark
                className={`w-5 h-5 ${saved ? 'fill-purple-400 text-purple-400' : ''}`}
              />
            </button>
            <button className="text-gray-500 hover:text-white transition-all duration-200 hover:scale-110">
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Caption */}
      {post.caption && (
        <div className="px-4 pb-4 pt-1">
          <p className="text-gray-300 text-sm leading-relaxed">
            <span className="text-white font-semibold">{post.user.username}</span>{' '}
            {post.caption}
          </p>
        </div>
      )}
    </article>
  )
}
