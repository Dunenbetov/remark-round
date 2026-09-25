#!/bin/sh
# Старт API в compose. Режимы:
#   (без аргументов): сервер. Миграции при старте только если MIGRATE_ON_START != false (демо), иначе проверка
#                      `migrate status`: непримененные миграции дают понятную ошибку вместо тихого автоприменения
#                      под restart: always (прод, docs/PROD.md, "Обновление");
#   migrate:           применить миграции и выйти, `docker compose run --rm api migrate` перед `up -d` в проде;
#   seed:              демо-данные и выйти (в production seed сам откажется без SEED_FORCE=1);
#   seed:remove:       убрать демо-персон и демо-проекты по фиксированным id (если том стенда попал на прод, docs/PROD.md).
# Демо-стенд: SEED_ON_START=true (docker-compose.yml ставит явно) кладет демо-персоны с известным паролем, в логах баннер.
# По умолчанию в образе seed выключен (D-4): ручной `docker run` не насыпает демо-данных.
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
  seed:remove)
    exec pnpm --filter @remarkround/api seed:remove
    ;;
esac

if [ "${MIGRATE_ON_START:-true}" != "false" ]; then
  echo "api: prisma migrate deploy"
  pnpm --filter @remarkround/db migrate:deploy
else
  echo "api: MIGRATE_ON_START=false, проверяю, что миграции применены"
  if ! pnpm --filter @remarkround/db exec prisma migrate status >/tmp/migrate-status.log 2>&1; then
    cat /tmp/migrate-status.log
    echo "api: есть непримененные миграции. Сначала бэкап, затем: docker compose run --rm api migrate (docs/PROD.md)" >&2
    exit 1
  fi
fi

if [ "${SEED_ON_START:-false}" = "true" ]; then
  if [ "${NODE_ENV:-}" = "production" ]; then
    echo "api: seed пропущен, NODE_ENV=production. Демо-данные в проде только руками: docker compose run --rm -e SEED_FORCE=1 api seed"
  else
    echo "api: ================= ДЕМО-РЕЖИМ ================="
    echo "api: seed кладет демо-персон с паролем \"remarkround\" и открывает регистрацию всем."
    echo "api: Это стенд, не прод. Прод: docker-compose.prod.yml (SEED_ON_START=false, NODE_ENV=production)."
    echo "api: =============================================="
    pnpm --filter @remarkround/api seed || echo "api: seed не удался, сервер все равно стартует"
  fi
fi
# Railway собирает образ без build-arg GIT_SHA: версию для /health берем из RAILWAY_GIT_COMMIT_SHA на старте
if [ "${APP_VERSION:-dev}" = "dev" ] && [ -n "${RAILWAY_GIT_COMMIT_SHA:-}" ]; then
  export APP_VERSION="sha-$(printf %s "$RAILWAY_GIT_COMMIT_SHA" | cut -c1-7)"
fi
cd /app/apps/api
exec node dist/main.js
