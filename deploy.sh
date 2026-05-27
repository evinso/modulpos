#!/bin/bash
set -e

echo "🚀 Deploy başlıyor..."

ssh -i ~/.ssh/oracle_key ubuntu@77.42.122.8 "
  set -e
  cd /home/ubuntu/modulpos
  git pull origin main
  npm install --prefix server --omit=dev
  cd server && npx prisma generate && cd ..
  cd client && npm install && npm run build && cd ..
  pm2 restart all
  echo '✅ Deploy tamamlandı!'
"
