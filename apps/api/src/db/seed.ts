import 'dotenv/config'
import { pool, query } from './postgres.js'
import bcrypt from 'bcryptjs'

const USERS = [
  { username: 'zeynep_kaya', email: 'zeynep@example.com', phone: '+905551110001', password: 'password123', bio: 'Fotoğraf tutkunu 📸', points: 1240, streak: 7 },
  { username: 'mert_demir', email: 'mert@example.com', phone: '+905551110002', password: 'password123', bio: 'Sokak fotoğrafçısı 🏙️', points: 890, streak: 3 },
  { username: 'elif_yilmaz', email: 'elif@example.com', phone: '+905551110003', password: 'password123', bio: 'Doğa ve seyahat ✈️', points: 2100, streak: 14 },
  { username: 'burak_celik', email: 'burak@example.com', phone: '+905551110004', password: 'password123', bio: 'Minimalist kompozisyon', points: 560, streak: 1 },
  { username: 'selin_arslan', email: 'selin@example.com', phone: '+905551110005', password: 'password123', bio: 'Portre & yaşam tarzı ✨', points: 3450, streak: 21 },
]

const BRAND_USER = { username: 'brand_admin', email: 'brand@example.com', phone: '+905559990001', password: 'password123' }

const POSTS = [
  {
    imageUrl: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800',
    caption: 'Dağların zirvesinde büyülü bir gün 🏔️ #doğa #seyahat',
    qualityScore: 0.92,
    likes: 234, comments: 18, saves: 45,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800',
    caption: 'Altın saat ışığında bir portre 🌅',
    qualityScore: 0.88,
    likes: 412, comments: 32, saves: 67,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1519125323398-675f0ddb6308?w=800',
    caption: 'Şehrin kalabalığında yalnızlık #sokak #istanbul',
    qualityScore: 0.85,
    likes: 156, comments: 9, saves: 23,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800',
    caption: 'Yeşilin bin tonu 🌿 #doğa #orman',
    qualityScore: 0.91,
    likes: 289, comments: 24, saves: 88,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=800',
    caption: 'Küçük detaylar büyük hikayeler anlatır 🐾',
    qualityScore: 0.79,
    likes: 98, comments: 6, saves: 12,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1543349689-9a4d426bee8e?w=800',
    caption: 'Şehir ışıkları gece yarısı ✨ #gece #şehir',
    qualityScore: 0.87,
    likes: 345, comments: 27, saves: 54,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1495562569060-2eec283d3391?w=800',
    caption: 'Kahve ve sabah huzuru ☕',
    qualityScore: 0.83,
    likes: 512, comments: 41, saves: 103,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=800',
    caption: 'Deniz, güneş, özgürlük 🌊 #yaz #tatil',
    qualityScore: 0.94,
    likes: 678, comments: 53, saves: 134,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800',
    caption: 'Metropolün ritmi asla durmuyor 🌆',
    qualityScore: 0.86,
    likes: 201, comments: 15, saves: 38,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1518791841217-8f162f1912da?w=800',
    caption: 'Tatlı dostum her karede ❤️ #kedi #pet',
    qualityScore: 0.90,
    likes: 891, comments: 76, saves: 189,
  },
]

const CHALLENGES = [
  {
    title: 'En İyi Kahvaltı Fotoğrafı',
    description: 'Sabahın en güzel anını ölümsüzleştir! En yaratıcı kahvaltı masası fotoğrafını paylaş. Doğal ışık, renk uyumu ve kompozisyon değerlendirilecek. Kazananlar marka ürün seti kazanır.',
    rewardPool: 5000,
    maxWinners: 3,
    daysFromNow: 7,
  },
  {
    title: 'Şehir Silüeti Challenge',
    description: 'Yaşadığın veya ziyaret ettiğin şehrin en etkileyici silüetini yakala. Gün batımı, gece ışıkları veya sis içindeki şehir görüntüleri kabul edilir. En orijinal bakış açısı kazanır!',
    rewardPool: 10000,
    maxWinners: 5,
    daysFromNow: 14,
  },
  {
    title: 'Doğanın Renkleri',
    description: 'Doğadan bulduğun en canlı ve etkileyici renk kombinasyonunu fotoğrafla. Çiçekler, yapraklar, gökyüzü veya su yansımaları olabilir. Filtre kullanmadan çekilen fotoğraflar tercih edilir.',
    rewardPool: 7500,
    maxWinners: 3,
    daysFromNow: 10,
  },
]

async function seed() {
  console.log('🌱 Seed başlatılıyor...')

  await query(`TRUNCATE challenge_entries, challenges, brands, interactions, point_transactions, rewards, follows, posts, users RESTART IDENTITY CASCADE`)
  console.log('✓ Tablolar temizlendi')

  // Kullanıcılar
  const userIds: string[] = []
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10)
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (username, email, phone, password_hash, bio, total_points, streak_days, phone_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id`,
      [u.username, u.email, u.phone, hash, u.bio, u.points, u.streak],
    )
    userIds.push(rows[0]!.id)
  }
  console.log(`✓ ${USERS.length} kullanıcı oluşturuldu`)

  // Marka kullanıcısı + marka profili
  const brandHash = await bcrypt.hash(BRAND_USER.password, 10)
  const { rows: brandUserRows } = await query<{ id: string }>(
    `INSERT INTO users (username, email, phone, password_hash, role, phone_verified)
     VALUES ($1,$2,$3,$4,'brand',true) RETURNING id`,
    [BRAND_USER.username, BRAND_USER.email, BRAND_USER.phone, brandHash],
  )
  const brandUserId = brandUserRows[0]!.id

  const { rows: brandRows } = await query<{ id: string }>(
    `INSERT INTO brands (user_id, name, logo_url, balance)
     VALUES ($1,'MOP Sponsoru','https://ui-avatars.com/api/?name=MOP&background=c026d3&color=fff',100000)
     RETURNING id`,
    [brandUserId],
  )
  const brandId = brandRows[0]!.id
  console.log('✓ Marka oluşturuldu')

  // Postlar — her kullanıcıya 2 post
  const postIds: string[] = []
  for (let i = 0; i < POSTS.length; i++) {
    const p = POSTS[i]!
    const userId = userIds[i % userIds.length]!
    const { rows } = await query<{ id: string }>(
      `INSERT INTO posts (user_id, image_url, caption, quality_score, like_count, comment_count, save_count, points_earned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [userId, p.imageUrl, p.caption, p.qualityScore, p.likes, p.comments, p.saves, p.likes + p.comments * 2 + p.saves * 3],
    )
    postIds.push(rows[0]!.id)
  }
  console.log(`✓ ${POSTS.length} post oluşturuldu`)

  // Etkileşimler — ilk kullanıcı tüm postları beğenmiş
  const firstUser = userIds[0]!
  for (const postId of postIds.slice(0, 5)) {
    await query(
      `INSERT INTO interactions (post_id, user_id, type) VALUES ($1,$2,'like') ON CONFLICT DO NOTHING`,
      [postId, firstUser],
    )
    await query(
      `INSERT INTO interactions (post_id, user_id, type, content) VALUES ($1,$2,'comment',$3) ON CONFLICT DO NOTHING`,
      [postId, firstUser, 'Harika bir fotoğraf! 🔥'],
    )
  }
  console.log('✓ Etkileşimler oluşturuldu')

  // Follow ilişkileri
  for (let i = 0; i < userIds.length; i++) {
    for (let j = 0; j < userIds.length; j++) {
      if (i !== j && Math.random() > 0.4) {
        await query(
          `INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [userIds[i], userIds[j]],
        )
      }
    }
  }
  console.log('✓ Takip ilişkileri oluşturuldu')

  // Puan işlemleri
  for (const userId of userIds) {
    const types = ['post_like', 'post_comment', 'post_save', 'daily_login', 'referral'] as const
    for (let i = 0; i < 8; i++) {
      const type = types[i % types.length]!
      const amounts: Record<string, number> = { post_like: 1, post_comment: 2, post_save: 3, daily_login: 5, referral: 50 }
      const daysAgo = Math.floor(Math.random() * 14)
      await query(
        `INSERT INTO point_transactions (user_id, amount, type, status, activates_at, created_at)
         VALUES ($1,$2,$3,'active', NOW() - INTERVAL '${daysAgo} days', NOW() - INTERVAL '${daysAgo} days')`,
        [userId, amounts[type], type],
      )
    }
  }
  console.log('✓ Puan işlemleri oluşturuldu')

  // Challenge'lar
  const now = new Date()
  for (const c of CHALLENGES) {
    const endDate = new Date(now)
    endDate.setDate(endDate.getDate() + c.daysFromNow)
    const { rows } = await query<{ id: string }>(
      `INSERT INTO challenges (brand_id, title, description, reward_pool, max_winners, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6,'active') RETURNING id`,
      [brandId, c.title, c.description, c.rewardPool, c.maxWinners, endDate.toISOString()],
    )
    const challengeId = rows[0]!.id

    // Her challenge'a birkaç katılım
    for (let i = 0; i < 3; i++) {
      const userId = userIds[i]!
      const postId = postIds[i]!
      await query(
        `INSERT INTO challenge_entries (challenge_id, post_id, user_id, score)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [challengeId, postId, userId, Math.floor(Math.random() * 500) + 100],
      )
    }
    await query(`UPDATE challenges SET entry_count = 3 WHERE id = $1`, [challengeId])
  }
  console.log(`✓ ${CHALLENGES.length} challenge oluşturuldu`)

  console.log('\n✅ Seed tamamlandı!')
  console.log('\n📋 Test hesapları:')
  console.log('  Kullanıcı: zeynep@example.com / password123')
  console.log('  Kullanıcı: selin@example.com / password123  (en yüksek puan)')
  console.log('  Marka:     brand@example.com / password123')

  await pool.end()
}

seed().catch((err) => {
  console.error('Seed hatası:', err)
  process.exit(1)
})
