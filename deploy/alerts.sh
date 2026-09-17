#!/bin/sh
# Дешёвые алерты одного сервера (аудит: metrics-and-alerts, минимальный шаг до Prometheus). Запускать cron'ом раз в час
# на хосте: `0 * * * * /opt/remark-round/deploy/alerts.sh`. Проверки: свободное место на диске, возраст последнего дампа,
# offsite-копия, здоровье API. Сообщение уходит в Telegram (ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID) или в webhook
# (ALERT_WEBHOOK_URL, POST JSON {"text": …}); без них — только stdout/cron mail. Внешний uptime-монитор на /health — отдельно.
set -u
cd "$(dirname "$0")/.." || exit 1
DISK_MIN_FREE_PCT="${DISK_MIN_FREE_PCT:-15}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-36}"
PUBLIC_HOST="${PUBLIC_HOST:-$(grep -E '^PUBLIC_HOST=' .env 2>/dev/null | cut -d= -f2)}"
problems=""

used=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ -n "$used" ] && [ "$((100 - used))" -lt "$DISK_MIN_FREE_PCT" ]; then
  problems="$problems\n• Диск: свободно $((100 - used)) % (порог $DISK_MIN_FREE_PCT %)"
fi

latest=$(docker compose exec -T backup sh -c 'ls -t /backups/daily 2>/dev/null | head -1' 2>/dev/null)
if [ -z "$latest" ]; then
  problems="$problems\n• Бэкап: дампов нет"
else
  mtime=$(docker compose exec -T backup sh -c "stat -c %Y /backups/daily/$latest" 2>/dev/null)
  now=$(date +%s)
  if [ -n "$mtime" ] && [ "$(( (now - mtime) / 3600 ))" -ge "$BACKUP_MAX_AGE_HOURS" ]; then
    problems="$problems\n• Бэкап: последний дамп старше $BACKUP_MAX_AGE_HOURS ч ($latest)"
  fi
fi

if docker compose ps --format '{{.Service}} {{.Status}}' 2>/dev/null | grep -q 'offsite.*unhealthy'; then
  problems="$problems\n• Offsite: копия вне сервера устарела (docker compose logs offsite)"
fi

health=$(curl -s -m 10 -o /tmp/rr-health.json -w '%{http_code}' "http://127.0.0.1:${API_PORT:-3001}/api/v1/health" 2>/dev/null)
if [ "$health" != "200" ]; then
  problems="$problems\n• API: /health → ${health:-нет ответа}"
elif grep -q '"llm":"rules"' /tmp/rr-health.json 2>/dev/null; then
  problems="$problems\n• API: граф работает правилами без модели (llm=rules)"
elif grep -q '"vectorIndex":"missing"' /tmp/rr-health.json 2>/dev/null; then
  problems="$problems\n• API: нет HNSW-индекса (retrieve полным сканом)"
else
  # Очередь задач: сотня ждущих задач при исправном API — воркер не берёт их или модель лежит дольше всех повторов
  queued=$(sed -n 's/.*"jobs":{"queued":\([0-9]*\).*/\1/p' /tmp/rr-health.json 2>/dev/null)
  if [ -n "$queued" ] && [ "$queued" -ge "${JOBS_QUEUED_ALERT:-100}" ]; then
    problems="$problems\n• API: в очереди задач $queued ждущих (docker compose logs api | grep jobs)"
  fi
fi

[ -z "$problems" ] && exit 0
text="RemarkRound ${PUBLIC_HOST:-server} — проблемы:$problems"
printf '%b\n' "$text"
if [ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]; then
  curl -s -m 10 -X POST "https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT_ID}" --data-urlencode "text=$(printf '%b' "$text")" >/dev/null
fi
if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  payload=$(printf '%b' "$text" | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}')
  curl -s -m 10 -X POST -H 'Content-Type: application/json' -d "{\"text\":\"$payload\"}" "$ALERT_WEBHOOK_URL" >/dev/null
fi
exit 1
