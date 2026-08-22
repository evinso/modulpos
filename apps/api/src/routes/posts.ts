import type { FastifyInstance } from 'fastify'
import { query } from '../db/postgres.js'
import { authenticate } from '../middleware/auth.js'
import { analyzeImage, uploadToR2 } from '../services/image.service.js'
import { awardPoints } from '../services/points.service.js'
import { nanoid } from 'nanoid'

export async function postRoutes(app: FastifyInstance) {
  app.get('/feed', { preHandler: [authenticate] }, async (request) => {
    const user = request.user as { id: string }
    const { cursor, limit = 10 } = request.query as { cursor?: string; limit?: number }

    const { rows } = await query<{
      id: string; user_id: string; image_url: string; caption: string | null
      quality_score: number; like_count: number; comment_count: number
      save_count: number; challenge_id: string | null; created_at: string
      username: string; avatar_url: string | null
      is_liked: boolean; is_saved: boolean
    }>(
      `SELECT
         p.id, p.user_id, p.image_url, p.caption, p.quality_score,
         p.like_count, p.comment_count, p.save_count, p.challenge_id, p.created_at,
         u.username, u.avatar_url,
         EXISTS(SELECT 1 FROM interactions WHERE post_id = p.id AND user_id = $1 AND type = 'like') AS is_liked,
         EXISTS(SELECT 1 FROM interactions WHERE post_id = p.id AND user_id = $1 AND type = 'save') AS is_saved
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.is_flagged = FALSE
         AND p.quality_score >= 0.4
         AND ($2::uuid IS NULL OR p.created_at < (SELECT created_at FROM posts WHERE id = $2))
       ORDER BY p.created_at DESC
       LIMIT $3`,
      [user.id, cursor ?? null, limit + 1],
    )

    const hasMore = rows.length > limit
    const data = rows.slice(0, limit).map((r) => ({
      id: r.id,
      userId: r.user_id,
      imageUrl: r.image_url,
      caption: r.caption,
      qualityScore: r.quality_score,
      likeCount: r.like_count,
      commentCount: r.comment_count,
      saveCount: r.save_count,
      challengeId: r.challenge_id,
      pointsEarned: 0,
      createdAt: r.created_at,
      user: { id: r.user_id, username: r.username, avatarUrl: r.avatar_url },
      isLiked: r.is_liked,
      isSaved: r.is_saved,
    }))

    return {
      data,
      nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null,
      hasMore,
    }
  })

  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as { id: string }
    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'Dosya bulunamadı', code: 'NO_FILE', statusCode: 400 })

    const buffer = await data.toBuffer()
    const { qualityScore, hash, isDuplicate } = await analyzeImage(buffer)

    if (qualityScore < 0.4) {
      return reply.status(422).send({ error: 'Görsel kalitesi çok düşük', code: 'LOW_QUALITY', statusCode: 422 })
    }

    const key = `posts/${user.id}/${nanoid()}.jpg`
    const imageUrl = await uploadToR2(buffer, key, data.mimetype)

    const caption = (request.body as Record<string, string>)['caption'] ?? null
    const challengeId = (request.body as Record<string, string>)['challengeId'] ?? null

    const { rows } = await query<{ id: string }>(
      `INSERT INTO posts (user_id, image_url, image_hash, caption, quality_score, is_duplicate, challenge_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [user.id, imageUrl, hash, caption, qualityScore, isDuplicate, challengeId],
    )

    const post = rows[0]!

    if (!isDuplicate) {
      await awardPoints(user.id, 'post_like', post.id, 0)
    }

    return reply.status(201).send({ data: { id: post.id, imageUrl, qualityScore } })
  })

  app.post('/:id/like', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as { id: string }
    const { id: postId } = request.params as { id: string }

    const { rows: existing } = await query(
      `SELECT id FROM interactions WHERE post_id = $1 AND user_id = $2 AND type = 'like'`,
      [postId, user.id],
    )

    if (existing.length > 0) {
      await query(`DELETE FROM interactions WHERE post_id = $1 AND user_id = $2 AND type = 'like'`, [postId, user.id])
      await query(`UPDATE posts SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`, [postId])
      return { data: { liked: false } }
    }

    await query(
      `INSERT INTO interactions (post_id, user_id, type) VALUES ($1, $2, 'like')`,
      [postId, user.id],
    )
    const { rows: postRows } = await query<{ user_id: string }>(
      `UPDATE posts SET like_count = like_count + 1 WHERE id = $1 RETURNING user_id`,
      [postId],
    )
    const postOwnerId = postRows[0]?.user_id
    if (postOwnerId && postOwnerId !== user.id) {
      await awardPoints(postOwnerId, 'post_like', postId)
    }

    return { data: { liked: true } }
  })

  app.post('/:id/save', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as { id: string }
    const { id: postId } = request.params as { id: string }

    const { rows: existing } = await query(
      `SELECT id FROM interactions WHERE post_id = $1 AND user_id = $2 AND type = 'save'`,
      [postId, user.id],
    )

    if (existing.length > 0) {
      await query(`DELETE FROM interactions WHERE post_id = $1 AND user_id = $2 AND type = 'save'`, [postId, user.id])
      await query(`UPDATE posts SET save_count = GREATEST(0, save_count - 1) WHERE id = $1`, [postId])
      return { data: { saved: false } }
    }

    await query(
      `INSERT INTO interactions (post_id, user_id, type) VALUES ($1, $2, 'save')`,
      [postId, user.id],
    )
    const { rows: postRows } = await query<{ user_id: string }>(
      `UPDATE posts SET save_count = save_count + 1 WHERE id = $1 RETURNING user_id`,
      [postId],
    )
    const postOwnerId = postRows[0]?.user_id
    if (postOwnerId && postOwnerId !== user.id) {
      await awardPoints(postOwnerId, 'post_save', postId)
    }

    return { data: { saved: true } }
  })
}
