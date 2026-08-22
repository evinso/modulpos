'use client'

import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useState } from 'react'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth'

const schema = z.object({
  email: z.string().email('Geçerli bir e-posta girin'),
  password: z.string().min(6, 'Şifre en az 6 karakter olmalı'),
  remember: z.boolean().optional(),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    try {
      const res = await api.post('/auth/login', data)
      const { user, accessToken, refreshToken } = res.data.data
      setAuth(user, accessToken, refreshToken)
      router.push('/feed')
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Giriş başarısız, bilgilerini kontrol et.'
      toast.error(message)
    }
  }

  return (
    <div className="min-h-screen bg-[#070711] flex">
      {/* Left Panel */}
      <div className="hidden lg:flex w-1/2 relative overflow-hidden bg-gradient-to-br from-purple-950 via-[#0d0d1a] to-pink-950/30 flex-col items-center justify-center p-16">
        {/* Background orbs */}
        <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-purple-600/20 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/3 right-1/4 w-64 h-64 bg-pink-600/15 rounded-full blur-[90px]" />
        <div className="absolute top-10 right-10 w-48 h-48 bg-violet-600/10 rounded-full blur-[80px]" />

        <div className="relative z-10 max-w-sm w-full">
          {/* Logo */}
          <div className="mb-16">
            <Link href="/">
              <span className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent" style={{ fontFamily: 'var(--font-display)' }}>
                MOP
              </span>
            </Link>
          </div>

          {/* Quote */}
          <h2 className="text-3xl font-bold text-white mb-4 leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Her fotoğraf bir
            <br />
            <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">kazanç fırsatı.</span>
          </h2>
          <p className="text-gray-400 text-base leading-relaxed mb-14">
            Topluluğa katıl, içerik üret, markalarla yarış. Puanlarını gerçek ödüle dönüştür.
          </p>

          {/* Floating stat cards */}
          <div className="space-y-3">
            <div className="flex items-center gap-4 bg-white/[0.06] border border-white/[0.1] rounded-2xl px-5 py-4 backdrop-blur-sm">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-lg">
                🏆
              </div>
              <div>
                <p className="text-white font-semibold text-sm">₺847.320</p>
                <p className="text-gray-500 text-xs">Bu ay dağıtılan ödül</p>
              </div>
            </div>

            <div className="flex items-center gap-4 bg-white/[0.06] border border-white/[0.1] rounded-2xl px-5 py-4 backdrop-blur-sm ml-8">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center text-lg">
                📸
              </div>
              <div>
                <p className="text-white font-semibold text-sm">127 Aktif Challenge</p>
                <p className="text-gray-500 text-xs">Şu an katılabilirsin</p>
              </div>
            </div>

            <div className="flex items-center gap-4 bg-white/[0.06] border border-white/[0.1] rounded-2xl px-5 py-4 backdrop-blur-sm">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-lg">
                ✅
              </div>
              <div>
                <p className="text-white font-semibold text-sm">12.450 Kullanıcı</p>
                <p className="text-gray-500 text-xs">Aktif bu hafta</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel — Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-10">
            <Link href="/">
              <span className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent" style={{ fontFamily: 'var(--font-display)' }}>
                MOP
              </span>
            </Link>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              Tekrar hoş geldin 👋
            </h1>
            <p className="text-gray-400">Hesabına giriş yap ve kazanmaya devam et.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">E-posta adresi</label>
              <input
                {...register('email')}
                type="email"
                placeholder="ornek@mail.com"
                className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.15] focus:border-purple-500 rounded-xl text-white placeholder-gray-600 text-sm transition-all duration-200 outline-none focus:ring-2 focus:ring-purple-500/20"
              />
              {errors.email && (
                <p className="text-red-400 text-xs mt-1.5">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-300">Şifre</label>
                <Link href="#" className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
                  Şifremi unuttum
                </Link>
              </div>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="w-full px-4 py-3.5 pr-12 bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.15] focus:border-purple-500 rounded-xl text-white placeholder-gray-600 text-sm transition-all duration-200 outline-none focus:ring-2 focus:ring-purple-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-red-400 text-xs mt-1.5">{errors.password.message}</p>
              )}
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-3">
              <input
                {...register('remember')}
                type="checkbox"
                id="remember"
                className="w-4 h-4 rounded border-white/[0.15] bg-white/[0.04] accent-purple-500 cursor-pointer"
              />
              <label htmlFor="remember" className="text-sm text-gray-400 cursor-pointer select-none">
                Beni hatırla
              </label>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-purple-900/30 hover:shadow-purple-900/50 flex items-center justify-center gap-2 group"
            >
              {isSubmitting ? (
                <span>Giriş yapılıyor...</span>
              ) : (
                <>
                  <span>Giriş Yap</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          <p className="text-center text-gray-500 text-sm mt-8">
            Hesabın yok mu?{' '}
            <Link href="/register" className="text-purple-400 hover:text-purple-300 font-medium transition-colors">
              Kayıt Ol
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
