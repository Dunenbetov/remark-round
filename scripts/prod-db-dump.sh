#!/bin/sh
# Копия боевой базы на Mac владельца (docs/defense/DEFENSE-PLAN.md, задача B1).
# Встроенные бэкапы Railway — только на Pro, внешнее хранилище отложено до корпоративного контура, а с 21.09 в базе
# рабочие данные команды. Поэтому минимум: раз в неделю и перед каждым merge с миграцией — pg_dump сюда.
#
# Как работает: `railway ssh` в сервис postgres, pg_dump в формате custom, поток через base64 (ssh-сессия может
# испортить двоичные байты), дальше проверка: заголовок PGDMP и, если запущен Docker, `pg_restore --list`.
# Нужны: Railway CLI с входом (`railway login`), SSH-ключ, зарегистрированный в Railway (`railway ssh keys add`),
# папка репозитория, привязанная к проекту (`railway link`).
#
# Файлы кладутся ВНЕ репозитория: в них персональные данные и тексты замечаний команды.
#   RR_BACKUP_DIR   — куда класть (по умолчанию ~/RemarkRound-backups)
#   RR_BACKUP_KEEP  — сколько последних копий хранить (по умолчанию 8)
set -eu

DIR="${RR_BACKUP_DIR:-$HOME/RemarkRound-backups}"
KEEP="${RR_BACKUP_KEEP:-8}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DIR/remarkround-prod-$STAMP.dump"

command -v railway >/dev/null 2>&1 || { echo "prod-db-dump: нет Railway CLI (railway) в PATH" >&2; exit 1; }
mkdir -p "$DIR"
chmod 700 "$DIR"
umask 077

START=$(date +%s)
# Переменные в одинарных кавычках раскрывает shell внутри контейнера postgres, а не локальный
# shellcheck disable=SC2016
# -Fc: сжатый формат pg_restore; --no-owner/--no-acl: восстанавливается под любым пользователем
railway ssh --service postgres -- sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl | base64' \
  | tr -d '\r' | base64 --decode > "$FILE.part"

if [ "$(head -c 5 "$FILE.part")" != "PGDMP" ]; then
  echo "prod-db-dump: ОШИБКА — ответ не похож на дамп Postgres, файл оставлен для разбора: $FILE.part" >&2
  exit 1
fi
mv "$FILE.part" "$FILE"

# Читаемость: оглавление дампа через тот же образ, что у базы (если Docker запущен)
ITEMS="не проверено (Docker не запущен)"
if docker info >/dev/null 2>&1; then
  ITEMS="$(docker run --rm -v "$DIR":/b:ro pgvector/pgvector:pg17 pg_restore --list "/b/$(basename "$FILE")" | grep -vc '^;') объектов в оглавлении"
fi

# Старые копии: оставить KEEP последних
ls -1t "$DIR"/remarkround-prod-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done

SIZE=$(wc -c < "$FILE" | tr -d ' ')
echo "prod-db-dump: OK $FILE, $((SIZE / 1024)) КБ, $(( $(date +%s) - START )) с; $ITEMS; копий в папке: $(ls -1 "$DIR"/remarkround-prod-*.dump | wc -l | tr -d ' ')"
