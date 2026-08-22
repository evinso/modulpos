import type { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/auth.js'
import { query } from '../db/postgres.js'
import { redis } from '../db/redis.js'

export async function userRoutes(app: FastifyInstance) {
  app.get('/leaderboard', { preHandler: [authenticate] }, async () => {
    const cached = await redis.get('leaderboard:weekly')
    if (cached) return { data: JSON.parse(cached) }

    const { rows } = await query(
      `SELECT u.id, u.username, u.avatar_url, u.total_points, u.streak_days,
              RANK() OVER (ORDER BY u.total_points DESC) AS rank
       FROM users u
       WHERE u.role = 'user' AND u.is_banned = FALSE
       ORDER BY u.total_points DESC
       LIMIT 50`,
    )

    const data = rows.map((r: Record<string, unknown>) => ({
      id: r['id'],
      username: r['username'],
      avatarUrl: r['avatar_url'],
      totalPoints: r['total_points'],
      streakDays: r['streak_days'],
      rank: r['rank'],
    }))

    await redis.set('leaderboard:weekly', JSON.stringify(data), 'EX', 300)
    return { data }
  })

  app.get('/me', { preHandler: [authenticate] }, async (request) => {
    const user = request.user as { id: string }
    const { rows } = await query(
      `SELECT id, username, email, phone, role, avatar_url, bio,
              total_points, pending_points, streak_days, created_at
       FROM users WHERE id = $1`,
      [user.id],
    )
    const r = rows[0] as Record<string, unknown> | undefined
    if (!r) return { data: null }
    return {
      data: {
        id: r['id'], username: r['username'], email: r['email'],
        phone: r['phone'], role: r['role'], avatarUrl: r['avatar_url'],
        bio: r['bio'], totalPoints: r['total_points'],
        pendingPoints: r['pending_points'], streakDays: r['streak_days'],
        createdAt: r['created_at'],
      },
    }
  })

  app.get('/:username', { preHandler: [authenticate] }, async (request, reply) => {
    const { username } = request.params as { username: string }
    const { rows } = await query(
      `SELECT id, username, avatar_url, bio, total_points, streak_days, created_at,
              (SELECT COUNT(*) FROM posts WHERE user_id = users.id) AS post_count,
              (SELECT COUNT(*) FROM follows WHERE following_id = users.id) AS follower_count
       FROM users WHERE username = $1 AND is_banned = FALSE`,
      [username],
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Kullanıcı bulunamadı', code: 'NOT_FOUND', statusCode: 404 })
    return { data: rows[0] }
  })
}
