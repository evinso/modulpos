import { Redis } from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
})

redis.on('error', (err) => {
  console.error('Redis error:', err)
})

export async function connectRedis() {
  await redis.connect()
  console.log('Redis connected')
}
