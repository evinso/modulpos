import { useInfiniteQuery } from '@tanstack/react-query'
import { FlatList, View, Text, ActivityIndicator, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../lib/api'
import { PostCard } from '../../components/feed/post-card'
import type { PostWithUser, PaginatedResponse } from '@mop/shared'

export default function FeedScreen() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isRefetching } =
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

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top']}>
      <View className="px-4 h-14 flex-row items-center justify-between">
        <Text className="text-white text-xl font-bold">MOP</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#d946ef" size="large" />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <PostCard post={item} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }}
          onEndReached={() => hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#d946ef"
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator color="#d946ef" style={{ marginVertical: 16 }} />
            ) : null
          }
        />
      )}
    </SafeAreaView>
  )
}
