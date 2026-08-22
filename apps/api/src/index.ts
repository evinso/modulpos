import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import { authRoutes } from './routes/auth.js'
import { postRoutes } from './routes/posts.js'
import { pointRoutes } from './routes/points.js'
import { challengeRoutes } from './routes/challenges.js'
import { userRoutes } from './routes/users.js'
import { redis } from './db/redis.js'

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

await app.register(helmet)
await app.register(cors, {
  origin: [process.env.WEB_URL ?? 'http://localhost:3000'],
  credentials: true,
})
await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod' })
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  redis,
})
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

await app.register(authRoutes, { prefix: '/auth' })
await app.register(postRoutes, { prefix: '/posts' })
await app.register(pointRoutes, { prefix: '/points' })
await app.register(challengeRoutes, { prefix: '/challenges' })
await app.register(userRoutes, { prefix: '/users' })

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

try {
  await app.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' })
  console.log('API running on http://localhost:4000')
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
