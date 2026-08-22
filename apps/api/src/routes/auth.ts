import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { query } from '../db/postgres.js'
import { nanoid } from 'nanoid'

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-z0-9_]+$/),
  email: z.string().email(),
  phone: z.string().regex(/^\+?[0-9]{10,14}$/),
  password: z.string().min(8),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    const body = registerSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.errors[0]?.message, code: 'VALIDATION_ERROR', statusCode: 400 })
    }

    const { username, email, phone, password } = body.data

    const existing = await query(
      'SELECT id FROM users WHERE email = $1 OR username = $2 OR phone = $3',
      [email, username, phone],
    )
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'Bu e-posta, kullanıcı adı veya telefon zaten kullanılıyor', code: 'CONFLICT', statusCode: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const { rows } = await query<{ id: string; username: string; email: string; phone: string; role: string; total_points: number; pending_points: number; streak_days: number; created_at: string }>(
      `INSERT INTO users (username, email, phone, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, phone, role, total_points, pending_points, streak_days, created_at`,
      [username, email, phone, passwordHash],
    )

    const user = rows[0]!
    const accessToken = app.jwt.sign({ id: user.id, role: user.role }, { expiresIn: '15m' })
    const refreshToken = app.jwt.sign({ id: user.id, type: 'refresh' }, { expiresIn: '30d' })

    return reply.status(201).send({
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          role: user.role,
          totalPoints: user.total_points,
          pendingPoints: user.pending_points,
          streakDays: user.streak_days,
          avatarUrl: null,
          bio: null,
          createdAt: user.created_at,
        },
        accessToken,
        refreshToken,
      },
    })
  })

  app.post('/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Geçersiz giriş bilgileri', code: 'VALIDATION_ERROR', statusCode: 400 })
    }

    const { email, password } = body.data
    const { rows } = await query<{ id: string; username: string; email: string; phone: string; role: string; password_hash: string; total_points: number; pending_points: number; streak_days: number; avatar_url: string | null; bio: string | null; is_banned: boolean; created_at: string }>(
      'SELECT id, username, email, phone, role, password_hash, total_points, pending_points, streak_days, avatar_url, bio, is_banned, created_at FROM users WHERE email = $1 LIMIT 1',
      [email],
    )

    const user = rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.status(401).send({ error: 'E-posta veya şifre hatalı', code: 'INVALID_CREDENTIALS', statusCode: 401 })
    }

    if (user.is_banned) {
      return reply.status(403).send({ error: 'Hesabın askıya alındı', code: 'BANNED', statusCode: 403 })
    }

    const accessToken = app.jwt.sign({ id: user.id, role: user.role }, { expiresIn: '15m' })
    const refreshToken = app.jwt.sign({ id: user.id, type: 'refresh' }, { expiresIn: '30d' })

    return {
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          role: user.role,
          totalPoints: user.total_points,
          pendingPoints: user.pending_points,
          streakDays: user.streak_days,
          avatarUrl: user.avatar_url,
          bio: user.bio,
          createdAt: user.created_at,
        },
        accessToken,
        refreshToken,
      },
    }
  })

  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string }
    try {
      const payload = app.jwt.verify(refreshToken) as { id: string; type: string }
      if (payload.type !== 'refresh') throw new Error()

      const { rows } = await query<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = $1', [payload.id])
      const user = rows[0]
      if (!user) throw new Error()

      const accessToken = app.jwt.sign({ id: user.id, role: user.role }, { expiresIn: '15m' })
      const newRefreshToken = app.jwt.sign({ id: user.id, type: 'refresh' }, { expiresIn: '30d' })

      return { data: { accessToken, refreshToken: newRefreshToken } }
    } catch {
      return reply.status(401).send({ error: 'Geçersiz token', code: 'INVALID_TOKEN', statusCode: 401 })
    }
  })
}
