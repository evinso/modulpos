import { useQuery } from '@tanstack/react-query'
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Coins, Clock, Gift } from 'lucide-react-native'
import { api } from '../../lib/api'
import { pointsToCurrency, canRedeem, MINIMUM_REDEMPTION_POINTS } from '@mop/shared'
import type { PointTransaction, PaginatedResponse } from '@mop/shared'

interface PointBalance {
  activePoints: number
  pendingPoints: number
  totalEarned: number
}

export default function PointsScreen() {
  const { data: balance, isLoading } = useQuery({
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
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top']}>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 40 }}>
        <Text className="text-white text-xl font-bold mt-4 mb-6">Puanlarım</Text>

        {isLoading ? (
          <ActivityIndicator color="#d946ef" />
        ) : (
          <>
            <View className="flex-row gap-3 mb-4">
              <View className="flex-1 bg-purple-950/60 border border-purple-800/40 rounded-2xl p-4">
                <View className="flex-row items-center gap-2 mb-2">
                  <Coins size={14} color="#e879f9" />
                  <Text className="text-zinc-400 text-xs">Kullanılabilir</Text>
                </View>
                <Text className="text-white text-2xl font-bold">{active.toLocaleString()}</Text>
                <Text className="text-zinc-500 text-xs mt-1">
                  ≈ ₺{pointsToCurrency(active).toFixed(2)}
                </Text>
              </View>

              <View className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4">
                <View className="flex-row items-center gap-2 mb-2">
                  <Clock size={14} color="#eab308" />
                  <Text className="text-zinc-400 text-xs">Beklemede</Text>
                </View>
                <Text className="text-white text-2xl font-bold">{pending.toLocaleString()}</Text>
                <Text className="text-zinc-500 text-xs mt-1">Yakında aktif</Text>
              </View>
            </View>

            {canRedeem(active) ? (
              <TouchableOpacity className="bg-brand-600 py-4 rounded-xl flex-row items-center justify-center gap-2 mb-6">
                <Gift size={20} color="white" />
                <Text className="text-white font-semibold">Ödüle Çevir</Text>
              </TouchableOpacity>
            ) : (
              <View className="bg-white/5 border border-white/10 py-4 rounded-xl items-center mb-6">
                <Text className="text-zinc-500 text-sm">
                  {MINIMUM_REDEMPTION_POINTS - active} puan daha kazan
                </Text>
              </View>
            )}

            <Text className="text-white font-semibold mb-3">İşlem Geçmişi</Text>
            {(history?.data ?? []).map((tx) => (
              <View
                key={tx.id}
                className="flex-row justify-between items-center bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-2"
              >
                <View>
                  <Text className="text-white text-sm capitalize">
                    {tx.type.replace('_', ' ')}
                  </Text>
                  <Text className="text-zinc-500 text-xs">{tx.status}</Text>
                </View>
                <Text
                  className={`font-semibold ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {tx.amount > 0 ? '+' : ''}{tx.amount}
                </Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
