export type ChallengeStatus = 'draft' | 'active' | 'ended' | 'cancelled'

export interface Challenge {
  id: string
  brandId: string
  title: string
  description: string
  imageUrl: string | null
  rewardPool: number
  currency: string
  maxWinners: number
  startDate: string
  endDate: string
  status: ChallengeStatus
  entryCount: number
  platformFeePercent: number
  createdAt: string
}

export interface ChallengeWithBrand extends Challenge {
  brand: {
    id: string
    name: string
    logoUrl: string | null
  }
}

export interface ChallengeEntry {
  id: string
  challengeId: string
  postId: string
  userId: string
  score: number
  rank: number | null
  rewardAmount: number | null
  createdAt: string
}
