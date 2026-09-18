#!/bin/sh
# Бэкап базы RemarkRound в Backblaze B2 (или любое S3-совместимое хранилище). Задача A3, аудит R-M3.
# Режимы:
#   (без аргументов)                      — pg_dump → загрузка в s3:$B2_BUCKET/db/ → сверка размера → чистка старых дампов;
#   restore-test                          — скачать самый свежий дамп и прочитать его оглавление (pg_restore --list);
#                                           ни одна база не трогается — это проверка «дамп читается»;
#   restore <имя-объекта> --yes-i-know    — восстановить дамп В БАЗУ ИЗ DATABASE_URL. Отказывается, если в ней уже есть
#                                           пользователи (таблица "User" не пуста), пока не добавлен --force;
#   list                                  — показать дампы в хранилище.
# Переменные: DATABASE_URL, B2_BUCKET, B2_ENDPOINT (s3.<регион>.backblazeb2.com), B2_KEY_ID, B2_APP_KEY,
#             BACKUP_KEEP_DAYS (30) — сколько дней хранить дампы; BACKUP_KEEP_MIN (7) — меньше стольких не оставлять никогда.
# Секреты уходят в rclone только через окружение (RCLONE_CONFIG_B2_*): ни на диск, ни в логи они не попадают.
# Любая ошибка — ненулевой код выхода: Railway пометит запуск cron как failed.
set -eu

MODE="${1:-backup}"
PREFIX="remarkround-"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
KEEP_MIN="${BACKUP_KEEP_MIN:-7}"

die() {
  echo "backup: ОШИБКА: $*" >&2
  exit 1
}

for v in B2_BUCKET B2_ENDPOINT B2_KEY_ID B2_APP_KEY; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || die "не задана переменная $v (docs/PROD-RAILWAY.md, шаг 9)"
done
case "$KEEP_DAYS" in '' | *[!0-9]*) die "BACKUP_KEEP_DAYS должно быть целым числом дней" ;; esac
case "$KEEP_MIN" in '' | *[!0-9]*) die "BACKUP_KEEP_MIN должно быть целым числом" ;; esac

# Remote rclone по имени «b2» целиком из окружения. provider Other + force_path_style: годится и для B2, и для MinIO.
# Endpoint можно дать без схемы (s3.eu-central-003.backblazeb2.com) — rclone подставит https.
# Файла конфигурации нет и не будет — без этого rclone на каждый вызов пишет NOTICE «Config file not found»
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_B2_TYPE=s3
export RCLONE_CONFIG_B2_PROVIDER=Other
export RCLONE_CONFIG_B2_ENDPOINT="$B2_ENDPOINT"
export RCLONE_CONFIG_B2_ACCESS_KEY_ID="$B2_KEY_ID"
export RCLONE_CONFIG_B2_SECRET_ACCESS_KEY="$B2_APP_KEY"
export RCLONE_CONFIG_B2_FORCE_PATH_STYLE=true
# Регион для подписи запросов — из адреса B2 (s3.eu-central-003.backblazeb2.com → eu-central-003); для прочих хранилищ — по умолчанию
case "$B2_ENDPOINT" in
  *s3.*.backblazeb2.com*)
    region="${B2_ENDPOINT#*s3.}"
    export RCLONE_CONFIG_B2_REGION="${region%%.backblazeb2.com*}"
    ;;
esac
# Ключ B2 ограничен одним бакетом: проверять/создавать бакет ему нельзя, и не нужно
export RCLONE_CONFIG_B2_NO_CHECK_BUCKET=true
REMOTE="b2:${B2_BUCKET}/db"
RCLONE="rclone --retries 3 --low-level-retries 5 --contimeout 30s --timeout 5m"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
trap 'exit 143' INT TERM

# Имена дампов в хранилище, по одному на строку, от старых к новым (дата в имени сортируется как текст)
remote_dumps() {
  $RCLONE lsf --files-only --include "${PREFIX}*.dump" "$REMOTE/" | sort
}

# Размер объекта в байтах; пусто, если объекта нет
remote_size() {
  $RCLONE lsf --files-only --format s --include "$1" "$REMOTE/" | head -n 1
}

need_db() {
  [ -n "${DATABASE_URL:-}" ] || die "не задана переменная DATABASE_URL"
  # Параметры пула Prisma (?connection_limit=…) libpq не понимает — отрезаем всё после «?»
  DB_URL="${DATABASE_URL%%\?*}"
}

human() {
  awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.1f МБ", b / 1048576; else printf "%.1f КБ", b / 1024 }'
}

do_backup() {
  need_db
  started="$(date +%s)"
  name="${PREFIX}$(date -u +%Y%m%d-%H%M%S).dump"
  file="$WORK/$name"

  # -Fc: сжатый формат pg_restore (можно восстановить выборочно); владельцы и права не пишем — на новом сервере роль может зваться иначе
  pg_dump -Fc --no-owner --no-privileges -d "$DB_URL" -f "$file" || die "pg_dump не удался"
  local_size="$(wc -c < "$file" | tr -d ' ')"
  [ "$local_size" -gt 0 ] || die "pg_dump дал пустой файл"
  pg_restore --list "$file" > /dev/null || die "свежий дамп не читается pg_restore"

  $RCLONE copyto "$file" "$REMOTE/$name" || die "загрузка в хранилище не удалась"
  uploaded="$(remote_size "$name")"
  [ "$uploaded" = "$local_size" ] || die "размер в хранилище (${uploaded:-нет объекта}) не равен локальному ($local_size)"

  pruned="$(prune)"
  total="$(remote_dumps | wc -l | tr -d ' ')"
  echo "backup: OK $name, $(human "$local_size") ($local_size байт), $(( $(date +%s) - started )) с; в хранилище дампов: $total, удалено старых: $pruned"
}

# Удаляет дампы старше KEEP_DAYS, но так, чтобы осталось не меньше KEEP_MIN: если cron месяц не работал,
# чистка не должна съесть последние рабочие копии. BACKUP_PRUNE_DRY_RUN=1 — только показать. Печатает число удалённых.
prune() {
  cutoff="$(date -u -d "@$(( $(date +%s) - KEEP_DAYS * 86400 ))" +%Y%m%d%H%M%S)"
  all="$(remote_dumps)"
  count="$(printf '%s\n' "$all" | grep -c . || true)"
  deleted=0
  for f in $all; do
    [ $(( count - deleted )) -gt "$KEEP_MIN" ] || break
    stamp="${f#"$PREFIX"}"
    stamp="$(printf %s "${stamp%.dump}" | tr -d '-')"
    # Имя не по шаблону ГГГГММДД-ЧЧММСС (кто-то положил файл руками) — не трогаем
    case "$stamp" in '' | *[!0-9]*) continue ;; esac
    # Список отсортирован от старых к новым: первый «молодой» дамп — дальше старых нет
    [ "$stamp" -lt "$cutoff" ] || break
    if [ "${BACKUP_PRUNE_DRY_RUN:-}" = "1" ]; then
      echo "backup: (dry-run) удалил бы $f" >&2
    else
      $RCLONE deletefile "$REMOTE/$f" >&2 || die "не удалось удалить старый дамп $f"
      echo "backup: удалён старый дамп $f" >&2
    fi
    deleted=$(( deleted + 1 ))
  done
  echo "$deleted"
}

fetch() {
  $RCLONE copyto "$REMOTE/$1" "$WORK/$1" || die "не удалось скачать $1"
  [ -s "$WORK/$1" ] || die "в хранилище нет объекта $1 (список: backup.sh list)"
}

do_restore_test() {
  newest="$(remote_dumps | tail -n 1)"
  [ -n "$newest" ] || die "в хранилище нет ни одного дампа"
  fetch "$newest"
  entries="$(pg_restore --list "$WORK/$newest" | grep -c '^[0-9]' || true)"
  tables="$(pg_restore --list "$WORK/$newest" | grep -c ' TABLE DATA ' || true)"
  [ "$tables" -gt 0 ] || die "в дампе $newest нет данных таблиц"
  echo "backup: restore-test OK $newest, $(human "$(wc -c < "$WORK/$newest" | tr -d ' ')"), объектов в оглавлении: $entries, таблиц с данными: $tables"
}

do_restore() {
  object="${2:-}"
  confirm=""
  force=""
  if [ "$#" -ge 2 ]; then shift 2; else shift "$#"; fi
  for a in "$@"; do
    case "$a" in
      --yes-i-know) confirm=1 ;;
      --force) force=1 ;;
      *) die "неизвестный аргумент $a" ;;
    esac
  done
  [ -n "$object" ] || die "укажите имя дампа: restore <имя-объекта> --yes-i-know (список: backup.sh list)"
  [ -n "$confirm" ] || die "restore перезапишет базу из DATABASE_URL; подтвердите флагом --yes-i-know"
  need_db

  # Защита от «восстановил поверх живого прода»: непустая таблица "User" — значит, базой пользуются
  # Два запроса: в пустой базе таблицы ещё нет, и count(*) по ней упал бы на разборе
  has_users="$(psql "$DB_URL" -Atc "SELECT to_regclass('public.\"User\"') IS NOT NULL")" || die "не удалось подключиться к базе из DATABASE_URL"
  users=0
  if [ "$has_users" = "t" ]; then
    users="$(psql "$DB_URL" -Atc 'SELECT count(*) FROM "User"')"
  fi
  if [ "$users" -gt 0 ] && [ -z "$force" ]; then
    die "в целевой базе уже есть пользователи ($users). Восстанавливать нужно в пустую базу; если вы точно хотите затереть эту — добавьте --force"
  fi

  fetch "$object"
  started="$(date +%s)"
  # --clean --if-exists: дамп сначала удаляет свои объекты (в пустой базе — ничего), затем создаёт заново; одна транзакция — либо всё, либо ничего
  pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction -d "$DB_URL" "$WORK/$object" || die "pg_restore не удался — база осталась как была (одна транзакция)"
  users="$(psql "$DB_URL" -Atc 'SELECT count(*) FROM "User"')"
  echo "backup: restore OK $object за $(( $(date +%s) - started )) с; пользователей в базе: $users"
}

case "$MODE" in
  backup) do_backup ;;
  restore-test) do_restore_test ;;
  restore) do_restore "$@" ;;
  list) remote_dumps ;;
  prune) echo "backup: старых дампов под чистку: $(prune)" ;;
  *) die "неизвестный режим «$MODE» (backup | restore-test | restore <объект> --yes-i-know [--force] | list | prune)" ;;
esac
