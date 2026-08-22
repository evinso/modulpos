export type PointSourceType =
  | 'post_like'
  | 'post_comment'
  | 'post_save'
  | 'daily_login'
  | 'referral'
  | 'challenge'
  | 'streak_bonus'
  | 'admin_adjustment'

export type PointStatus = 'pending' | 'active' | 'expired' | 'cancelled'

export type RewardType = 'gift_card' | 'discount_code' | 'cash'
export type RewardStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface PointTransaction {
  id: string
  userId: string
  amount: number
  type: PointSourceType
  status: PointStatus
  sourceId: string | null
  activatesAt: string
  createdAt: string
}

export interface Reward {
  id: string
  userId: string
  type: RewardType
  pointsSpent: number
  value: number
  currency: string
  fee: number
  status: RewardStatus
  createdAt: string
}

export const POINT_VALUES: Record<PointSourceType, number> = {
  post_like: 1,
  post_comment: 2,
  post_save: 3,
  daily_login: 5,
  referral: 50,
  challenge: 0,
  streak_bonus: 0,
  admin_adjustment: 0,
}

export const PENDING_HOURS: Record<PointSourceType, number> = {
  post_like: 24,
  post_comment: 24,
  post_save: 24,
  daily_login: 0,
  referral: 48,
  challenge: 72,
  streak_bonus: 0,
  admin_adjustment: 0,
}

export const POINTS_TO_CURRENCY_RATE = 0.1
export const MINIMUM_REDEMPTION_POINTS = 500
export const CASH_WITHDRAWAL_FEE_PERCENT = 0.03
