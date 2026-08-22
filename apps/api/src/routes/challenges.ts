import type { FastifyInstance } from 'fastify'
import { authenticate, requireBrand } from '../middleware/auth.js'
import { query } from '../db/postgres.js'
import { z } from 'zod'

const createChallengeSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(20),
  rewardPool: z.number().positive(),
  maxWinners: z.number().int().min(1).max(100).default(3),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  currency: z.string().default('TRY'),
})

export async function challengeRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const { rows } = await query(
      `SELECT
         c.id, c.title, c.description, c.image_url, c.reward_pool, c.currency,
         c.max_winners, c.start_date, c.end_date, c.status, c.entry_count,
         c.platform_fee_percent, c.created_at,
         b.id AS brand_id, b.name AS brand_name, b.logo_url AS brand_logo
       FROM challenges c
       JOIN brands b ON b.id = c.brand_id
       WHERE c.status = 'active' AND c.end_date > NOW()
       ORDER BY c.reward_pool DESC
       LIMIT 50`,
    )

    const data = rows.map((r: Record<string, unknown>) => ({
      id: r['id'],
      brandId: r['brand_id'],
      title: r['title'],
      description: r['description'],
      imageUrl: r['image_url'],
      rewardPool: r['reward_pool'],
      currency: r['currency'],
      maxWinners: r['max_winners'],
      startDate: r['start_date'],
      endDate: r['end_date'],
      status: r['status'],
      entryCount: r['entry_count'],
      platformFeePercent: r['platform_fee_percent'],
      createdAt: r['created_at'],
      brand: {
        id: r['brand_id'],
        name: r['brand_name'],
        logoUrl: r['brand_logo'],
      },
    }))

    return { data, nextCursor: null, hasMore: false }
  })

  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = request.user as { id: string }

    const { rows } = await query(
      `SELECT c.*, b.id AS brand_id, b.name AS brand_name, b.logo_url AS brand_logo,
              EXISTS(SELECT 1 FROM challenge_entries WHERE challenge_id = c.id AND user_id = $2) AS is_joined
       FROM challenges c
       JOIN brands b ON b.id = c.brand_id
       WHERE c.id = $1`,
      [id, user.id],
    )

    if (!rows[0]) return reply.status(404).send({ error: 'Challenge bulunamadı', code: 'NOT_FOUND', statusCode: 404 })

    const r = rows[0] as Record<string, unknown>
    return {
      data: {
        id: r['id'], brandId: r['brand_id'], title: r['title'],
        description: r['description'], imageUrl: r['image_url'],
        rewardPool: r['reward_pool'], currency: r['currency'],
        maxWinners: r['max_winners'], startDate: r['start_date'],
        endDate: r['end_date'], status: r['status'],
        entryCount: r['entry_count'], platformFeePercent: r['platform_fee_percent'],
        createdAt: r['created_at'], isJoined: r['is_joined'],
        brand: { id: r['brand_id'], name: r['brand_name'], logoUrl: r['brand_logo'] },
      },
    }
  })

  app.post('/', { preHandler: [requireBrand] }, async (request, reply) => {
    const user = request.user as { id: string }
    const body = createChallengeSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.errors[0]?.message, code: 'VALIDATION_ERROR', statusCode: 400 })
    }

    const { rows: brandRows } = await query<{ id: string; balance: number }>(
      'SELECT id, balance FROM brands WHERE user_id = $1',
      [user.id],
    )
    const brand = brandRows[0]
    if (!brand) return reply.status(404).send({ error: 'Marka profili bulunamadı', code: 'NOT_FOUND', statusCode: 404 })

    const { title, description, rewardPool, maxWinners, startDate, endDate, currency } = body.data
    const platformFee = rewardPool * 0.15
    const totalRequired = rewardPool + platformFee

    if (brand.balance < totalRequired) {
      return reply.status(400).send({ error: 'Yetersiz bakiye', code: 'INSUFFICIENT_BALANCE', statusCode: 400 })
    }

    const { rows } = await query(
      `INSERT INTO challenges (brand_id, title, description, reward_pool, max_winners, start_date, end_date, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
       RETURNING id, title, status, created_at`,
      [brand.id, title, description, rewardPool, maxWinners, startDate, endDate, currency],
    )

    await query('UPDATE brands SET balance = balance - $1 WHERE id = $2', [totalRequired, brand.id])

    return reply.status(201).send({ data: rows[0] })
  })

  app.get('/:id/entries', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const { rows } = await query(
      `SELECT
         p.id, p.user_id, p.image_url, p.caption, p.quality_score,
         p.like_count, p.comment_count, p.save_count, p.created_at,
         u.username, u.avatar_url,
         ce.score, ce.rank
       FROM challenge_entries ce
       JOIN posts p ON p.id = ce.post_id
       JOIN users u ON u.id = p.user_id
       WHERE ce.challenge_id = $1
       ORDER BY ce.score DESC
       LIMIT 30`,
      [id],
    )

    const data = rows.map((r: Record<string, unknown>) => ({
      id: r['id'],
      userId: r['user_id'],
      imageUrl: r['image_url'],
      caption: r['caption'],
      qualityScore: r['quality_score'],
      likeCount: r['like_count'],
      commentCount: r['comment_count'],
      saveCount: r['save_count'],
      pointsEarned: 0,
      challengeId: id,
      createdAt: r['created_at'],
      score: r['score'],
      rank: r['rank'],
      user: { id: r['user_id'], username: r['username'], avatarUrl: r['avatar_url'] },
    }))

    return { data, nextCursor: null, hasMore: false }
  })

  app.post('/:id/join', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as { id: string }
    const { id } = request.params as { id: string }

    const { rows: existing } = await query(
      'SELECT id FROM challenge_entries WHERE challenge_id = $1 AND user_id = $2',
      [id, user.id],
    )
    if (existing.length > 0) {
      return reply.status(409).send({ error: 'Zaten katıldın', code: 'ALREADY_JOINED', statusCode: 409 })
    }

    const { rows: challenge } = await query(
      `SELECT id, status, end_date FROM challenges WHERE id = $1`,
      [id],
    )
    if (!challenge[0]) return reply.status(404).send({ error: 'Challenge bulunamadı', code: 'NOT_FOUND', statusCode: 404 })
    if ((challenge[0] as Record<string, unknown>)['status'] !== 'active') {
      return reply.status(400).send({ error: 'Challenge aktif değil', code: 'NOT_ACTIVE', statusCode: 400 })
    }

    await query(
      `INSERT INTO challenge_entries (challenge_id, user_id, post_id, score)
       SELECT $1, $2, p.id, p.like_count + p.comment_count * 2 + p.save_count * 3
       FROM posts p WHERE p.user_id = $2 ORDER BY p.created_at DESC LIMIT 1`,
      [id, user.id],
    )
    await query('UPDATE challenges SET entry_count = entry_count + 1 WHERE id = $1', [id])

    return reply.status(201).send({ data: { joined: true } })
  })
}
