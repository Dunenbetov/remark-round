# Сервис `backup` на Railway (docs/PROD-RAILWAY.md, шаг 9; задача A3): запускается по расписанию (cron), делает
# pg_dump прод-базы, кладёт дамп в Backblaze B2 (S3-совместимое хранилище) и завершается.
# postgres:17-alpine — ради pg_dump/pg_restore той же мажорной версии, что у сервера (pgvector/pgvector:pg17):
# pg_dump старше сервера отказывается работать. rclone — из пакетов alpine, настраивается только переменными окружения.
FROM postgres:17-alpine
RUN apk add --no-cache rclone ca-certificates
COPY apps/backup/backup.sh /usr/local/bin/backup.sh
RUN chmod 0555 /usr/local/bin/backup.sh
# Секретов на диск не пишем; дамп живёт во временном каталоге до конца запуска
USER postgres
WORKDIR /tmp
ENTRYPOINT ["sh", "/usr/local/bin/backup.sh"]
