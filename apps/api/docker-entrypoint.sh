#!/bin/sh
# Старт API в compose (фаза 10, «одна команда»): миграции → демо-данные → сервер.
# Seed идемпотентен (upsert пользователей и документов, раунд 2 пересоздаётся); SEED_ON_START=false отключает.
# В production (docker-compose.prod.yml) seed не идёт: демо-персоны с известным паролем не для прода (SEED_FORCE=1 — осознанно).
set -e
cd /app
echo "api: prisma migrate deploy"
pnpm --filter @remarkround/db migrate:deploy
if [ "${SEED_ON_START:-true}" != "false" ]; then
  if [ "${NODE_ENV:-}" = "production" ] && [ "${SEED_FORCE:-}" != "1" ]; then
    echo "api: seed пропущен — NODE_ENV=production (SEED_FORCE=1, чтобы всё равно)"
  else
    echo "api: seed (SEED_ON_START=${SEED_ON_START:-true})"
    pnpm --filter @remarkround/api seed || echo "api: seed не удался, сервер всё равно стартует"
  fi
fi
cd /app/apps/api
exec node dist/main.js
