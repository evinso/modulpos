import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Hata', 'E-posta ve şifre gerekli')
      return
    }
    setLoading(true)
    try {
      const res = await api.post('/auth/login', { email, password })
      const { user, accessToken, refreshToken } = res.data.data
      setAuth(user, accessToken, refreshToken)
      router.replace('/(tabs)')
    } catch {
      Alert.alert('Giriş Başarısız', 'E-posta veya şifre hatalı')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-zinc-950"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 justify-center px-6">
        <Text className="text-white text-4xl font-bold text-center mb-2">MOP</Text>
        <Text className="text-zinc-400 text-center mb-10">Hesabına giriş yap</Text>

        <TextInput
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white mb-3"
          placeholder="E-posta"
          placeholderTextColor="#71717a"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white mb-6"
          placeholder="Şifre"
          placeholderTextColor="#71717a"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          onPress={handleLogin}
          disabled={loading}
          className="bg-brand-600 py-4 rounded-xl items-center"
          activeOpacity={0.8}
        >
          <Text className="text-white font-semibold text-base">
            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/(auth)/register')}
          className="mt-4 py-2"
        >
          <Text className="text-zinc-400 text-center text-sm">
            Hesabın yok mu?{' '}
            <Text className="text-brand-400">Kayıt Ol</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}
