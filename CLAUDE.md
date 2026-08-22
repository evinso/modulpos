# MOP Platform

Fotoğraf paylaşım + puan/ödül sistemi sosyal medya platformu.

## Proje Yapısı

```
apps/web      → Next.js 15 (port 3000)
apps/mobile   → Expo React Native
apps/api      → Fastify Node.js (port 4000)
packages/shared → Paylaşımlı TypeScript tipler ve utils
```

## Geliştirme Ortamını Başlatma

```bash
# 1. Veritabanlarını başlat
npm run db:up

# 2. Bağımlılıkları yükle
npm install

# 3. Tüm uygulamaları başlat
npm run dev

# Sadece web
npm run dev:web

# Sadece API
npm run dev:api

# Sadece mobil
npm run dev:mobile
```

## Ortam Değişkenleri

- `apps/api/.env` — DATABASE_URL, REDIS_URL, JWT_SECRET
- `apps/web/.env.local` — NEXT_PUBLIC_API_URL
- `apps/mobile/.env` — EXPO_PUBLIC_API_URL

## Kritik Mimari Kararlar

- Puan işlemleri PostgreSQL transaction içinde yapılır (withTransaction)
- Tüm kazanılan puanlar önce 'pending' statüsüne girer, anti-fraud için bekleme süresi uygulanır
- Görsel kalite skoru < 0.4 olan içerikler API'da reddedilir
- Redis Sorted Sets leaderboard için kullanılır (5dk TTL cache)
- JWT: 15dk access token + 30 gün refresh token
