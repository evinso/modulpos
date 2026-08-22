import { useQuery } from '@tanstack/react-query'
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Trophy, Clock, Users } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { api } from '../../lib/api'
import type { ChallengeWithBrand, PaginatedResponse } from '@mop/shared'

export default function ChallengesScreen() {
  const router = useRouter()
  const { data, isLoading } = useQuery({
    queryKey: ['challenges'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<ChallengeWithBrand>>('/challenges')
      return res.data
    },
  })

  const challenges = data?.data ?? []

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top']}>
      <View className="px-4">
        <View className="flex-row items-center gap-2 mt-4 mb-4">
          <Trophy size={20} color="#e879f9" />
          <Text className="text-white text-xl font-bold">Challenge'lar</Text>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#d946ef" className="mt-8" />
      ) : (
        <FlatList
          data={challenges}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push(`/challenge/${item.id}`)}
              className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
              activeOpacity={0.8}
            >
              {item.imageUrl && (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={{ height: 120, width: '100%' }}
                  contentFit="cover"
                />
              )}
              <View className="p-4">
                <Text className="text-brand-400 text-xs font-medium mb-1">
                  {item.brand.name}
                </Text>
                <View className="flex-row justify-between items-start">
                  <Text className="text-white font-semibold flex-1 mr-2">{item.title}</Text>
                  <View className="items-end">
                    <Text className="text-brand-400 font-bold text-lg">
                      {item.rewardPool.toLocaleString()}
                    </Text>
                    <Text className="text-zinc-500 text-xs">ödül havuzu</Text>
                  </View>
                </View>
                <View className="flex-row gap-4 mt-3">
                  <View className="flex-row items-center gap-1">
                    <Users size={12} color="#71717a" />
                    <Text className="text-zinc-500 text-xs">{item.entryCount} katılımcı</Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Clock size={12} color="#71717a" />
                    <Text className="text-zinc-500 text-xs">Bitiş: {new Date(item.endDate).toLocaleDateString('tr-TR')}</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  )
}
