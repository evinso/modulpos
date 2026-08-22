import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { View, ActivityIndicator } from 'react-native'
import { useAuthStore } from '../store/auth'

export default function Index() {
  const router = useRouter()
  const { accessToken } = useAuthStore()

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace(accessToken ? '/(tabs)' : '/(auth)/login')
    }, 100)
    return () => clearTimeout(timer)
  }, [accessToken, router])

  return (
    <View className="flex-1 items-center justify-center bg-zinc-950">
      <ActivityIndicator color="#d946ef" size="large" />
    </View>
  )
}
