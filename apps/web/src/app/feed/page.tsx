'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { PostCard } from '@/components/feed/post-card'
import type { PostWithUser, PaginatedResponse } from '@mop/shared'

// Mock stories data
const MOCK_STORIES = [
  { id: '1', username: 'aysee', hasNew: true, color: 'from-purple-500 to-pink-500', initial: 'A' },
  { id: '2', username: 'mert_k', hasNew: true, color: 'from-orange-500 to-pink-500', initial: 'M' },
  { id: '3', username: 'zeynep', hasNew: true, color: 'from-blue-500 to-purple-500', initial: 'Z' },
  { id: '4', username: 'cansu', hasNew: false, color: 'from-green-500 to-teal-500', initial: 'C' },
  { id: '5', username: 'burak_', hasNew: true, color: 'from-pink-500 to-red-500', initial: 'B' },
  { id: '6', username: 'elif.m', hasNew: false, color: 'from-yellow-500 to-orange-500', initial: 'E' },
  { id: '7', username: 'selin', hasNew: true, color: 'from-violet-500 to-indigo-500', initial: 'S' },
]

function StoriesRow() {
  return (
    <div className="pt-4 pb-2">
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
        {MOCK_STORIES.map((story) => (
          <button key={story.id} className="flex flex-col items-center gap-1.5 flex-shrink-0 group">
            <div className={`p-[2px] rounded-full ${story.hasNew ? `bg-gradient-to-br ${story.color}` : 'bg-white/[0.1]'}`}>
              <div className="w-14 h-14 rounded-full bg-[#070711] p-0.5">
                <div className={`w-full h-full rounded-full bg-gradient-to-br ${story.color} flex items-center justify-center text-white font-bold text-lg`}>
                  {story.initial}
                </div>
              </div>
            </div>
            <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors max-w-[56px] truncate">
              {story.username}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function FeedPage() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: ['feed'],
      queryFn: async ({ pageParam }) => {
        const res = await api.get<PaginatedResponse<PostWithUser>>('/posts/feed', {
          params: { cursor: pageParam, limit: 10 },
        })
        return res.data
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    })

  const posts = data?.pages.flatMap((p) => p.data) ?? []

  if (isLoading) {
    return (
      <div>
        <StoriesRow />
        <div className="space-y-5 pt-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white/[0.04] border border-white/[0.06] rounded-3xl overflow-hidden animate-pulse">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-white/[0.08]" />
                <div className="space-y-1.5">
                  <div className="w-24 h-3 bg-white/[0.08] rounded-full" />
                  <div className="w-16 h-2 bg-white/[0.05] rounded-full" />
                </div>
              </div>
              <div className="aspect-square bg-white/[0.04]" />
              <div className="px-4 py-3 flex gap-4">
                <div className="w-8 h-4 bg-white/[0.08] rounded-full" />
                <div className="w-8 h-4 bg-white/[0.08] rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <StoriesRow />

      <div className="space-y-5 pt-2">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}

        {hasNextPage && (
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full py-3 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            {isFetchingNextPage ? 'Yükleniyor...' : 'Daha fazla göster'}
          </button>
        )}
      </div>
    </div>
  )
}
