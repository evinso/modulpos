import type { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/auth.js'
import { getBalance, spendPoints } from '../services/points.service.js'
import { query } from '../db/postgres.js'
import {
  MINIMUM_REDEMPTION_POINTS,
  pointsToCurrency,
  calculateWithdrawalFee,
} from '@mop/shared'
import { z } from 'zod'

const redeemSchema = z.object({
  type: z.enum(['gift_card', 'discount_code', 'cash']),
  points: z.number().int().min(MINIMUM_REDEMPTION_POINTS),
  currency: z.string().default('TRY'),
})

export async function pointRoutes(app: FastifyInstance) {
  app.get('/balance', { preHandler: [authenticate] }, async (request) => {
    const user = request.user as { id: string }
    const balance = await getBalance(user.id)
    return { data: balance }
  })

  app.get('/history', { preHandler: [authenticate] }, async (request) => {
    const user = request.user as { id: string }
    const { cursor, limit = 20 } = request.query as { cursor?: string; limit?: number }

    const { rows } = await query(
      `SELECT id, amount, type, status, source_id, activates_at, created_at
       FROM point_transactions
       WHERE user_id = $1
         AND ($2::uuid IS NULL OR created_at < (SELECT created_at FROM point_transactions WHERE id = $2))
       ORDER BY created_at DESC
       LIMIT $3`,
      [user.id, cursor ?? null, limit + 1],
    )

    const hasMore = rows.length > limit
    const data = rows.slice(0, limit)
    return {
      data,
      nextCursor: hasMore ? (data[data.length - 1] as { id: string } | undefined)?.id ?? null : null,
      hasMore,
    }
  })

  app.post('/redeem', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as { id: string }
    const body = redeemSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.errors[0]?.message, code: 'VALIDATION_ERROR', statusCode: 400 })
    }

    const { type, points, currency } = body.data
    const value = pointsToCurrency(points)
    const fee = type === 'cash' ? calculateWithdrawalFee(value) : 0
    const netValue = value - fee

    try {
      await spendPoints(user.id, points)
    } catch {
      return reply.status(400).send({ error: 'Yetersiz puan', code: 'INSUFFICIENT_POINTS', statusCode: 400 })
    }

    const { rows } = await query(
      `INSERT INTO rewards (user_id, type, points_spent, value, currency, fee)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, type, points_spent, value, fee, status, created_at`,
      [user.id, type, points, netValue, currency, fee],
    )

    return reply.status(201).send({ data: rows[0] })
  })
}
