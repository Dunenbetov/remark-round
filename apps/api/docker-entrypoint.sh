#!/bin/sh
# Старт API в compose (фаза 10, «одна команда»): миграции → демо-данные → сервер.
# Seed идемпотентен (upsert пользователей и документов, раунд 2 пересоздаётся); SEED_ON_START=false отключает.
set -e
cd /app
echo "api: prisma migrate deploy"
pnpm --filter @remarkround/db migrate:deploy
if [ "${SEED_ON_START:-true}" != "false" ]; then
  echo "api: seed (SEED_ON_START=${SEED_ON_START:-true})"
  pnpm --filter @remarkround/api seed || echo "api: seed не удался, сервер всё равно стартует"
fi
cd /app/apps/api
exec node dist/main.js
