import { query, withTransaction } from '../db/postgres.js'
import { POINT_VALUES, PENDING_HOURS } from '@mop/shared'
import type { PointSourceType } from '@mop/shared'
import type pg from 'pg'

export async function awardPoints(
  userId: string,
  type: PointSourceType,
  sourceId: string | null = null,
  customAmount?: number,
): Promise<void> {
  const amount = customAmount ?? POINT_VALUES[type]
  if (amount === 0) return

  const pendingHours = PENDING_HOURS[type]
  const activatesAt = new Date()
  activatesAt.setHours(activatesAt.getHours() + pendingHours)

  const status = pendingHours === 0 ? 'active' : 'pending'

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO point_transactions (user_id, amount, type, status, source_id, activates_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, amount, type, status, sourceId, activatesAt],
    )

    if (status === 'active') {
      await client.query(
        `UPDATE users SET total_points = total_points + $1 WHERE id = $2`,
        [amount, userId],
      )
    } else {
      await client.query(
        `UPDATE users SET pending_points = pending_points + $1 WHERE id = $2`,
        [amount, userId],
      )
    }
  })
}

export async function activatePendingPoints(): Promise<void> {
  await withTransaction(async (client: pg.PoolClient) => {
    const { rows } = await client.query<{ user_id: string; total: string }>(
      `UPDATE point_transactions
       SET status = 'active'
       WHERE status = 'pending' AND activates_at <= NOW()
       RETURNING user_id, amount`,
    )

    const userTotals = new Map<string, number>()
    for (const row of rows) {
      userTotals.set(row.user_id, (userTotals.get(row.user_id) ?? 0) + Number(row.total))
    }

    for (const [userId, total] of userTotals) {
      await client.query(
        `UPDATE users
         SET total_points = total_points + $1,
             pending_points = GREATEST(0, pending_points - $1)
         WHERE id = $2`,
        [total, userId],
      )
    }
  })
}

export async function getBalance(userId: string) {
  const { rows } = await query<{
    total_points: number
    pending_points: number
    total_earned: string
  }>(
    `SELECT
       u.total_points,
       u.pending_points,
       COALESCE(SUM(pt.amount) FILTER (WHERE pt.amount > 0), 0) AS total_earned
     FROM users u
     LEFT JOIN point_transactions pt ON pt.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.total_points, u.pending_points`,
    [userId],
  )

  const row = rows[0]
  return {
    activePoints: row?.total_points ?? 0,
    pendingPoints: row?.pending_points ?? 0,
    totalEarned: Number(row?.total_earned ?? 0),
  }
}

export async function spendPoints(userId: string, amount: number): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ total_points: number }>(
      `SELECT total_points FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    )
    const current = rows[0]?.total_points ?? 0
    if (current < amount) {
      throw new Error('Insufficient points')
    }

    await client.query(
      `UPDATE users SET total_points = total_points - $1 WHERE id = $2`,
      [amount, userId],
    )

    await client.query(
      `INSERT INTO point_transactions (user_id, amount, type, status, activates_at)
       VALUES ($1, $2, 'redemption', 'active', NOW())`,
      [userId, -amount],
    )
  })
}
