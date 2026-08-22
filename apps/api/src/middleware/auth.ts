import type { FastifyRequest, FastifyReply } from 'fastify'

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED', statusCode: 401 })
  }
}

export async function requireBrand(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  const payload = request.user as { role: string }
  if (payload.role !== 'brand' && payload.role !== 'admin' && payload.role !== 'superadmin') {
    reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN', statusCode: 403 })
  }
}
