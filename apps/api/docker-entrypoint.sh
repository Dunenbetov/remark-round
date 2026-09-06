#!/bin/sh
# Старт API в compose. Режимы:
#   (без аргументов) — сервер: миграции при старте только если MIGRATE_ON_START != false (демо), иначе проверка
#                      `migrate status`: непримененные миграции — понятная ошибка вместо тихого автоприменения
#                      под restart: always (прод, docs/PROD.md «Обновление»);
#   migrate          — применить миграции и выйти: `docker compose run --rm api migrate` перед `up -d` в проде;
#   seed             — демо-данные и выйти (в production seed сам откажется, если не SEED_FORCE=1 — руками, осознанно).
# Демо-стенд: SEED_ON_START=true (по умолчанию) кладёт демо-персоны с известным паролем — баннер в логах об этом.
set -e
cd /app

case "${1:-}" in
  migrate)
    echo "api: prisma migrate deploy"
    exec pnpm --filter @remarkround/db migrate:deploy
    ;;
  seed)
    exec pnpm --filter @remarkround/api seed
    ;;
esac

if [ "${MIGRATE_ON_START:-true}" != "false" ]; then
  echo "api: prisma migrate deploy"
  pnpm --filter @remarkround/db migrate:deploy
else
  echo "api: MIGRATE_ON_START=false — проверяю, что миграции применены"
  if ! pnpm --filter @remarkround/db exec prisma migrate status >/tmp/migrate-status.log 2>&1; then
    cat /tmp/migrate-status.log
    echo "api: есть непримененные миграции. Сначала бэкап, затем: docker compose run --rm api migrate (docs/PROD.md)" >&2
    exit 1
  fi
fi

if [ "${SEED_ON_START:-true}" != "false" ]; then
  if [ "${NODE_ENV:-}" = "production" ]; then
    echo "api: seed пропущен — NODE_ENV=production. Демо-данные в проде — только руками: docker compose run --rm -e SEED_FORCE=1 api seed"
  else
    echo "api: ================= ДЕМО-РЕЖИМ ================="
    echo "api: seed кладёт демо-персон с паролем «remarkround» и открывает регистрацию всем."
    echo "api: Это стенд, не прод. Прод — docker-compose.prod.yml (SEED_ON_START=false, NODE_ENV=production)."
    echo "api: =============================================="
    pnpm --filter @remarkround/api seed || echo "api: seed не удался, сервер всё равно стартует"
  fi
fi
cd /app/apps/api
exec node dist/main.js
