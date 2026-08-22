import { useState } from 'react'
import { View, Text, TouchableOpacity, Dimensions } from 'react-native'
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import { Heart, MessageCircle, Bookmark } from 'lucide-react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { PostWithUser } from '@mop/shared'

const { width } = Dimensions.get('window')
const IMAGE_SIZE = width - 32

interface Props {
  post: PostWithUser
}

export function PostCard({ post }: Props) {
  const [liked, setLiked] = useState(post.isLiked ?? false)
  const [saved, setSaved] = useState(post.isSaved ?? false)
  const [likeCount, setLikeCount] = useState(post.likeCount)
  const queryClient = useQueryClient()

  const likeMutation = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/like`),
    onMutate: async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      setLiked((v) => !v)
      setLikeCount((c) => (liked ? c - 1 : c + 1))
    },
    onError: () => {
      setLiked((v) => !v)
      setLikeCount((c) => (liked ? c + 1 : c - 1))
    },
  })

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/save`),
    onMutate: async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      setSaved((v) => !v)
    },
    onError: () => setSaved((v) => !v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-posts'] }),
  })

  return (
    <View className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
      <View className="flex-row items-center gap-3 px-4 py-3">
        <View className="w-9 h-9 rounded-full bg-purple-900/40 overflow-hidden">
          {post.user.avatarUrl && (
            <Image
              source={{ uri: post.user.avatarUrl }}
              style={{ width: 36, height: 36 }}
              contentFit="cover"
            />
          )}
        </View>
        <Text className="text-white text-sm font-medium">{post.user.username}</Text>
      </View>

      <Image
        source={{ uri: post.imageUrl }}
        style={{ width: IMAGE_SIZE, height: IMAGE_SIZE }}
        contentFit="cover"
      />

      <View className="px-4 py-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-4">
            <TouchableOpacity
              onPress={() => likeMutation.mutate()}
              className="flex-row items-center gap-1.5"
            >
              <Heart
                size={22}
                color={liked ? '#ef4444' : '#71717a'}
                fill={liked ? '#ef4444' : 'transparent'}
              />
              <Text className="text-zinc-400 text-sm">{likeCount}</Text>
            </TouchableOpacity>

            <TouchableOpacity className="flex-row items-center gap-1.5">
              <MessageCircle size={22} color="#71717a" />
              <Text className="text-zinc-400 text-sm">{post.commentCount}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => saveMutation.mutate()}>
            <Bookmark
              size={22}
              color={saved ? '#e879f9' : '#71717a'}
              fill={saved ? '#e879f9' : 'transparent'}
            />
          </TouchableOpacity>
        </View>

        {post.caption && (
          <Text className="text-zinc-300 text-sm mt-2">
            <Text className="text-white font-medium">{post.user.username} </Text>
            {post.caption}
          </Text>
        )}
      </View>
    </View>
  )
}
