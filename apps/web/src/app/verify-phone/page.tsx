'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth'

export default function VerifyPhonePage() {
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const router = useRouter()
  const { user, updateUser } = useAuthStore()

  useEffect(() => {
    sendCode()
  }, [])

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
      return () => clearTimeout(t)
    }
  }, [countdown])

  const sendCode = async () => {
    setSending(true)
    try {
      await api.post('/auth/phone/send-code')
      setCountdown(60)
      toast.success('Doğrulama kodu gönderildi')
    } catch {
      toast.error('Kod gönderilemedi, tekrar dene')
    } finally {
      setSending(false)
    }
  }

  const handleInput = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return
    const next = [...code]
    next[index] = value
    setCode(next)
    if (value && index < 5) inputs.current[index + 1]?.focus()
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputs.current[index - 1]?.focus()
    }
  }

  const handleVerify = async () => {
    const fullCode = code.join('')
    if (fullCode.length < 6) {
      toast.error('6 haneli kodu gir')
      return
    }
    setVerifying(true)
    try {
      await api.post('/auth/phone/verify', { code: fullCode })
      updateUser({ phone: user?.phone ?? '' })
      toast.success('Telefon doğrulandı!')
      router.push('/feed')
    } catch {
      toast.error('Kod hatalı veya süresi dolmuş')
      setCode(['', '', '', '', '', ''])
      inputs.current[0]?.focus()
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand-950/60 border border-brand-800/40 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">📱</span>
          </div>
          <h1 className="text-white text-2xl font-bold mb-2">Telefon Doğrulama</h1>
          <p className="text-gray-400 text-sm">
            {user?.phone
              ? `${user.phone} numarasına gönderilen 6 haneli kodu gir`
              : 'Telefonuna gönderilen 6 haneli kodu gir'}
          </p>
        </div>

        <div className="flex gap-2 justify-center mb-6">
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleInput(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="w-12 h-14 text-center text-xl font-bold bg-white/[0.05] border border-white/[0.1] rounded-xl text-white focus:outline-none focus:border-brand-500 transition-colors"
            />
          ))}
        </div>

        <button
          onClick={handleVerify}
          disabled={verifying || code.join('').length < 6}
          className="w-full py-3 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors mb-4"
        >
          {verifying ? 'Doğrulanıyor...' : 'Doğrula'}
        </button>

        <div className="text-center">
          {countdown > 0 ? (
            <p className="text-gray-500 text-sm">{countdown}s sonra tekrar gönder</p>
          ) : (
            <button
              onClick={sendCode}
              disabled={sending}
              className="text-brand-400 hover:text-brand-300 text-sm transition-colors disabled:opacity-50"
            >
              {sending ? 'Gönderiliyor...' : 'Kodu tekrar gönder'}
            </button>
          )}
        </div>

        <button
          onClick={() => router.push('/feed')}
          className="w-full mt-4 py-2 text-gray-500 hover:text-gray-400 text-sm transition-colors"
        >
          Şimdi değil, atla
        </button>
      </div>
    </div>
  )
}
