export type UserRole = 'user' | 'brand' | 'admin'

export interface User {
  id: string
  username: string
  email: string
  phone: string
  role: UserRole
  avatarUrl: string | null
  bio: string | null
  totalPoints: number
  pendingPoints: number
  streakDays: number
  createdAt: string
}

export interface UserPublic {
  id: string
  username: string
  avatarUrl: string | null
  bio: string | null
  totalPoints: number
  streakDays: number
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}
