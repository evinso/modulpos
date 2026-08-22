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
  username: z
    .string()
    .min(3, 'En az 3 karakter')
    .max(20, 'En fazla 20 karakter')
    .regex(/^[a-z0-9_]+$/, 'Sadece küçük harf, rakam ve _ kullanabilirsin'),
  email: z.string().email('Geçerli bir e-posta girin'),
  phone: z.string().regex(/^\+?[0-9]{10,14}$/, 'Geçerli bir telefon numarası girin'),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı'),
})

type FormData = z.infer<typeof schema>

function getPasswordStrength(password: string): { level: number; label: string; color: string } {
  if (!password) return { level: 0, label: '', color: '' }
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  if (score <= 2) return { level: 1, label: 'Zayıf', color: 'bg-red-500' }
  if (score <= 3) return { level: 2, label: 'Orta', color: 'bg-orange-400' }
  return { level: 3, label: 'Güçlü', color: 'bg-green-500' }
}

export default function RegisterPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [showPassword, setShowPassword] = useState(false)
  const [passwordValue, setPasswordValue] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const strength = getPasswordStrength(passwordValue)

  const onSubmit = async (data: FormData) => {
    try {
      const res = await api.post('/auth/register', data)
      const { user, accessToken, refreshToken } = res.data.data
      setAuth(user, accessToken, refreshToken)
      toast.success('Hesabın oluşturuldu!')
      router.push('/verify-phone')
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Kayıt başarısız, lütfen tekrar dene.'
      toast.error(message)
    }
  }

  return (
    <div className="min-h-screen bg-[#070711] flex">
      {/* Left Panel */}
      <div className="hidden lg:flex w-1/2 relative overflow-hidden bg-gradient-to-br from-purple-950 via-[#0d0d1a] to-pink-950/30 flex-col items-center justify-center p-16">
        {/* Background orbs */}
        <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-pink-600/20 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-purple-600/15 rounded-full blur-[90px]" />
        <div className="absolute top-16 left-16 w-48 h-48 bg-violet-600/10 rounded-full blur-[80px]" />

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
            Hesap aç,
            <br />
            <span className="bg-gradient-to-r from-pink-400 to-orange-400 bg-clip-text text-transparent">hemen kazan.</span>
          </h2>
          <p className="text-gray-400 text-base leading-relaxed mb-14">
            Kayıt ol, ilk fotoğrafını yükle ve bonus puanlarını kap. Üyelik tamamen ücretsiz.
          </p>

          {/* Why join cards */}
          <div className="space-y-3">
            {[
              { emoji: '🎯', title: 'İlk gün 50 bonus puan', sub: 'Kayıt hediyesi — hemen kullanabilirsin' },
              { emoji: '📱', title: 'Challenge bildirimleri', sub: 'Yeni ödülleri ilk sen gör' },
              { emoji: '💸', title: 'Anında nakit çekim', sub: 'Puanlarını hemen bozdurabililrsin' },
            ].map(({ emoji, title, sub }) => (
              <div key={title} className="flex items-center gap-4 bg-white/[0.06] border border-white/[0.1] rounded-2xl px-5 py-4 backdrop-blur-sm">
                <div className="w-10 h-10 rounded-xl bg-white/[0.08] flex items-center justify-center text-lg flex-shrink-0">
                  {emoji}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{title}</p>
                  <p className="text-gray-500 text-xs">{sub}</p>
                </div>
              </div>
            ))}
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
              Hesap oluştur 🚀
            </h1>
            <p className="text-gray-400">Birkaç adımda hazırsın. Ücretsiz, her zaman.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Username */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Kullanıcı Adı</label>
              <input
                {...register('username')}
                type="text"
                placeholder="kullanici_adi"
                className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.15] focus:border-purple-500 rounded-xl text-white placeholder-gray-600 text-sm transition-all duration-200 outline-none focus:ring-2 focus:ring-purple-500/20"
              />
              {errors.username && (
                <p className="text-red-400 text-xs mt-1.5">{errors.username.message}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">E-posta</label>
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

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Telefon Numarası</label>
              <input
                {...register('phone')}
                type="tel"
                placeholder="+905xx xxx xx xx"
                className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.15] focus:border-purple-500 rounded-xl text-white placeholder-gray-600 text-sm transition-all duration-200 outline-none focus:ring-2 focus:ring-purple-500/20"
              />
              {errors.phone && (
                <p className="text-red-400 text-xs mt-1.5">{errors.phone.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Şifre</label>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  onChange={(e) => setPasswordValue(e.target.value)}
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

              {/* Password strength indicator */}
              {passwordValue.length > 0 && (
                <div className="mt-3">
                  <div className="flex gap-1.5 mb-1.5">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                          i <= strength.level ? strength.color : 'bg-white/[0.08]'
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs font-medium ${
                    strength.level === 1 ? 'text-red-400' :
                    strength.level === 2 ? 'text-orange-400' : 'text-green-400'
                  }`}>
                    Şifre gücü: {strength.label}
                  </p>
                </div>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-purple-900/30 hover:shadow-purple-900/50 flex items-center justify-center gap-2 group mt-2"
            >
              {isSubmitting ? (
                <span>Oluşturuluyor...</span>
              ) : (
                <>
                  <span>Hesap Oluştur</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>

            <p className="text-center text-gray-600 text-xs">
              Kayıt olarak{' '}
              <Link href="#" className="text-gray-400 underline hover:text-white transition-colors">Kullanım Şartlarını</Link>
              {' '}ve{' '}
              <Link href="#" className="text-gray-400 underline hover:text-white transition-colors">Gizlilik Politikasını</Link>
              {' '}kabul etmiş olursun.
            </p>
          </form>

          <p className="text-center text-gray-500 text-sm mt-6">
            Zaten hesabın var mı?{' '}
            <Link href="/login" className="text-purple-400 hover:text-purple-300 font-medium transition-colors">
              Giriş Yap
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
