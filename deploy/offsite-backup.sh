#!/bin/sh
# Копия вне сервера (аудит: backups-dr). Раз в OFFSITE_INTERVAL_SECONDS (по умолчанию сутки):
#   /backups:  дампы pg_dump сервиса backup (том postgres-backups) в $OFFSITE_REMOTE/postgres
#   /storage:  кадры, документы, диффы (том api-storage) в $OFFSITE_REMOTE/storage
# rclone sync делает зеркало: удаленные на сервере файлы пропадут и в копии, поэтому ретеншн дампов
# (14 дней / 8 недель / 6 месяцев) задает сервис backup, а не эта копия. Конфиг remote через переменные
# RCLONE_CONFIG_OFFSITE_* (см. docker-compose.prod.yml и docs/PROD.md).
set -eu
: "${OFFSITE_REMOTE:?OFFSITE_REMOTE, например offsite:rr-backups}"
INTERVAL="${OFFSITE_INTERVAL_SECONDS:-86400}"
while true; do
  echo "offsite: $(date -u +%FT%TZ) sync /backups → $OFFSITE_REMOTE/postgres"
  rclone sync /backups "$OFFSITE_REMOTE/postgres" --transfers 4 --stats-one-line --stats 0 || echo "offsite: postgres sync failed" >&2
  echo "offsite: $(date -u +%FT%TZ) sync /storage → $OFFSITE_REMOTE/storage"
  rclone sync /storage "$OFFSITE_REMOTE/storage" --transfers 8 --stats-one-line --stats 0 || echo "offsite: storage sync failed" >&2
  # Отметка последнего успешного прохода для проверки "копия свежая" (docs/PROD.md)
  date -u +%FT%TZ > /tmp/offsite-last-run
  sleep "$INTERVAL"
done
