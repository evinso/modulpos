import { useQuery } from '@tanstack/react-query'
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { LogOut, Flame } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth'
import type { User } from '@mop/shared'

export default function ProfileScreen() {
  const router = useRouter()
  const { user: cachedUser, logout } = useAuthStore()

  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/users/me')
      return res.data.data
    },
    initialData: cachedUser ?? undefined,
  })

  const handleLogout = () => {
    logout()
    router.replace('/(auth)/login')
  }

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top']}>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="flex-row items-center justify-between mt-4 mb-6">
          <Text className="text-white text-xl font-bold">Profil</Text>
          <TouchableOpacity onPress={handleLogout} className="p-2">
            <LogOut size={20} color="#71717a" />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color="#d946ef" />
        ) : user ? (
          <>
            <View className="items-center mb-6">
              <View className="w-20 h-20 rounded-full bg-purple-900/40 border border-purple-800/40 overflow-hidden mb-3">
                {user.avatarUrl && (
                  <Image
                    source={{ uri: user.avatarUrl }}
                    style={{ width: 80, height: 80 }}
                    contentFit="cover"
                  />
                )}
              </View>
              <Text className="text-white text-xl font-bold">@{user.username}</Text>
              {user.bio && (
                <Text className="text-zinc-400 text-sm text-center mt-1">{user.bio}</Text>
              )}
            </View>

            <View className="flex-row gap-3 mb-6">
              <View className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4 items-center">
                <Text className="text-white text-2xl font-bold">
                  {user.totalPoints.toLocaleString()}
                </Text>
                <Text className="text-zinc-500 text-xs mt-1">Toplam Puan</Text>
              </View>
              <View className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4 items-center">
                <View className="flex-row items-center gap-1">
                  <Flame size={20} color="#f97316" />
                  <Text className="text-white text-2xl font-bold">{user.streakDays}</Text>
                </View>
                <Text className="text-zinc-500 text-xs mt-1">Gün Serisi</Text>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
