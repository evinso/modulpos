#!/bin/bash
set -e

echo "🚀 Deploy başlıyor..."

ssh ubuntu@141.147.7.226 "
  set -e
  cd /home/ubuntu/modulpos
  git pull origin main
  npm install --prefix server --omit=dev
  cd client && npm install && npm run build && cd ..
  pm2 restart all
  echo '✅ Deploy tamamlandı!'
"
