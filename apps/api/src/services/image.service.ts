import sharp from 'sharp'
import crypto from 'crypto'
import { query } from '../db/postgres.js'

export async function analyzeImage(buffer: Buffer): Promise<{
  qualityScore: number
  hash: string
  isDuplicate: boolean
}> {
  const metadata = await sharp(buffer).metadata()
  const stats = await sharp(buffer).stats()

  const width = metadata.width ?? 0
  const height = metadata.height ?? 0

  // Minimum boyut kontrolü
  if (width < 300 || height < 300) {
    return { qualityScore: 0, hash: '', isDuplicate: false }
  }

  // Bulanıklık tahmini: düşük standart sapma = bulanık görüntü
  const sharpnessScore = Math.min(
    1,
    (stats.channels[0]?.stdev ?? 0) / 60,
  )

  // Boyut skoru
  const sizeScore = Math.min(1, (width * height) / (1080 * 1080))

  const qualityScore = parseFloat((sharpnessScore * 0.7 + sizeScore * 0.3).toFixed(2))

  // pHash benzeri basit hash (gerçek implementasyonda imghash kütüphanesi kullanılmalı)
  const thumbnail = await sharp(buffer).resize(16, 16, { fit: 'fill' }).grayscale().raw().toBuffer()
  const hash = crypto.createHash('sha256').update(thumbnail).digest('hex').substring(0, 16)

  // Duplicate kontrolü
  const { rows } = await query<{ id: string }>(
    'SELECT id FROM posts WHERE image_hash = $1 LIMIT 1',
    [hash],
  )
  const isDuplicate = rows.length > 0

  return { qualityScore, hash, isDuplicate }
}

export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string> {
  // TODO: Cloudflare R2 entegrasyonu
  // Şimdilik placeholder URL döndür
  return `https://media.mop.app/${key}`
}
