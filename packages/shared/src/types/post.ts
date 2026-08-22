export type InteractionType = 'like' | 'comment' | 'save'

export interface Post {
  id: string
  userId: string
  imageUrl: string
  caption: string | null
  qualityScore: number
  likeCount: number
  commentCount: number
  saveCount: number
  pointsEarned: number
  challengeId: string | null
  createdAt: string
}

export interface PostWithUser extends Post {
  user: {
    id: string
    username: string
    avatarUrl: string | null
  }
  isLiked?: boolean
  isSaved?: boolean
}

export interface Comment {
  id: string
  postId: string
  userId: string
  content: string
  createdAt: string
  user: {
    id: string
    username: string
    avatarUrl: string | null
  }
}
