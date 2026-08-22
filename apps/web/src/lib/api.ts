import axios from 'axios'

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

function getAccessToken(): string | null {
  try {
    const stored = localStorage.getItem('mop-auth')
    if (!stored) return null
    return JSON.parse(stored)?.state?.accessToken ?? null
  } catch {
    return null
  }
}

function getRefreshToken(): string | null {
  try {
    const stored = localStorage.getItem('mop-auth')
    if (!stored) return null
    return JSON.parse(stored)?.state?.refreshToken ?? null
  } catch {
    return null
  }
}

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = getAccessToken()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    const isAuthEndpoint = original.url?.startsWith('/auth/')
    if (error.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true
      try {
        const refreshToken = getRefreshToken()
        const { data } = await axios.post(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/auth/refresh`,
          { refreshToken },
        )
        const stored = localStorage.getItem('mop-auth')
        if (stored) {
          const parsed = JSON.parse(stored)
          parsed.state.accessToken = data.data.accessToken
          parsed.state.refreshToken = data.data.refreshToken
          localStorage.setItem('mop-auth', JSON.stringify(parsed))
        }
        original.headers.Authorization = `Bearer ${data.data.accessToken}`
        return api(original)
      } catch {
        localStorage.removeItem('mop-auth')
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)
