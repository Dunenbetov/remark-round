# Прод на одном сервере — runbook

Фаза 11 (сентябрь 2026). Одна машина, docker compose, наружу смотрит только Caddy (80/443). Тысячи зарегистрированных пользователей одна нода держит; узкое место — прогоны модели, их ограничивает лимит параллельных прогонов (PR 3). Второй инстанс API — отдельный этап (Redis для socket.io, S3 вместо тома, очередь), см. `docs/ARCHITECTURE.md`.

## Что нужно

- Сервер Linux (2 vCPU / 4 ГБ хватает на пилот; Langfuse со своими ClickHouse/MinIO/Redis добавляет ~2 ГБ), Docker ≥ 24 с compose ≥ 2.24.
- DNS: `PUBLIC_HOST` (например `rr.company.kz`) → IP сервера. Caddy сам получит сертификат Let's Encrypt.
- `OPENAI_API_KEY` и решение, можно ли слать тексты замечаний и кадры заказчика во внешнюю модель (`REMARKROUND.md` §12: без договора — нельзя; альтернатива — локальная модель за `LlmModule`).

## Первый запуск

```bash
git clone <repo> remark-round && cd remark-round
cp .env.example .env
```

В `.env` заполнить (генерация: `openssl rand -hex 32`, для `ENCRYPTION_KEY` — 64 hex-символа, это как раз `openssl rand -hex 32`):

| Переменная | Зачем |
|---|---|
| `JWT_SECRET` | подпись токенов; ≥ 32 символов, иначе API не стартует |
| `POSTGRES_PASSWORD` | пароль БД приложения; задать **до** первого `up` — Postgres создаёт пользователя один раз |
| `PUBLIC_HOST` | домен для Caddy и `WEB_ORIGIN` |
| `OPENAI_API_KEY` | без него граф работает правилами по retrieve (честно, но грубее) |
| `NEXTAUTH_SECRET`, `SALT`, `ENCRYPTION_KEY`, `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`, `MINIO_ROOT_PASSWORD`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_INIT_USER_PASSWORD` | секреты Langfuse: заменить плейсхолдеры `change-me-local-dev` |
| `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` | чтобы не писать `-f` каждый раз |

Запуск и проверка:

```bash
docker compose up -d --build
docker compose ps                                   # api/web/mcp — healthy
curl -s https://$PUBLIC_HOST/api/v1/health          # {"ok":true,"db":"ok"}
curl -s https://$PUBLIC_HOST/api/v1/auth/options    # {"demoLogins":false} — демо-персон нет, seed не шёл
```

Первый пользователь регистрируется сам на `https://$PUBLIC_HOST/register` со стороной «руководитель приёмки», создаёт проект и приглашает остальных (`docs/adr/005-accounts-and-invitations.md`). Демо-аккаунтов `pm@remarkround.dev` в проде нет — и не должно быть.

Прод-override делает: `NODE_ENV=production` (fail-fast на слабом секрете), `SEED_ON_START=false`, `DEMO_LOGINS=false`, срок токена сутки (`JWT_EXPIRES_SECONDS`), `TRUST_PROXY_HOPS=2` (Caddy → nginx → API), кадры и документы в томе `api-storage`, ротация логов, `restart: always`, сервисы `caddy` и `backup`.

## Обновление

```bash
docker compose exec backup /backup.sh      # свежий дамп перед обновлением
git pull
docker compose up -d --build api web mcp   # миграции применяет entrypoint api при старте
docker compose ps && curl -s https://$PUBLIC_HOST/api/v1/health
```

Откат кода — `git checkout <tag>` и тот же `up -d --build`; откат данных — restore ниже (миграции Prisma не откатываются автоматически).

## Бэкап и восстановление

- **База.** Сервис `backup` (`prodrigestivill/postgres-backup-local`) делает `pg_dump` по `BACKUP_SCHEDULE` (по умолчанию ежедневно) в том `postgres-backups`: хранит 14 дневных, 8 недельных, 6 месячных. Список: `docker compose exec backup ls /backups/daily`. Скопировать с сервера: `docker compose cp backup:/backups/daily ./backups`. Хранить копии вне сервера (rsync/объектное хранилище) — задача оператора.
- **Файлы** (кадры, документы, дифф-картинки) в томе `api-storage` — в дамп БД **не** попадают. Архив: `docker run --rm -v remark-round_api-storage:/data -v $PWD:/out alpine tar czf /out/storage-$(date +%F).tgz -C /data .` (имя тома — `docker volume ls`). Добавить в cron рядом с копированием дампов.
- **Восстановление БД** (на остановленном api):
  ```bash
  docker compose stop api mcp
  gunzip -c backups/daily/remarkround-<дата>.sql.gz | docker compose exec -T postgres psql -U remarkround -d remarkround
  docker compose start api mcp
  ```
  Файлы: распаковать архив обратно в том (`docker run --rm -v remark-round_api-storage:/data -v $PWD:/in alpine sh -c 'cd /data && tar xzf /in/storage-<дата>.tgz'`).
- Проверять восстановление на копии хотя бы раз в квартал: дамп, который ни разу не разворачивали, — не бэкап.

## Langfuse в проде

UI Langfuse наружу не публикуется (порт 3000 только на 127.0.0.1 сервера). Смотреть трейсы: `ssh -L 3000:127.0.0.1:3000 user@server`, затем `http://localhost:3000` (вход — `LANGFUSE_INIT_USER_EMAIL` / `_PASSWORD`). Ссылка «Трейс в Langfuse» на карточке у PM ведёт на `LANGFUSE_PUBLIC_URL` (по умолчанию `http://localhost:3000`) — работает у того, кто в туннеле. В трейсах — тексты замечаний и цитаты ТЗ заказчика: это ещё одна причина держать Langfuse внутри.

## Чеклист перед запуском

- [ ] `JWT_SECRET`, `POSTGRES_PASSWORD`, `PUBLIC_HOST` заданы; плейсхолдеры `change-me-local-dev` в `.env` не остались.
- [ ] `docker compose config -q` без ошибок; `docker compose ps` — все healthy.
- [ ] `/api/v1/auth/options` → `demoLogins:false`; вход `pm@remarkround.dev` → 401.
- [ ] Регистрация PM → проект → приглашение по ссылке → второй человек вошёл.
- [ ] `docker compose exec backup ls /backups/daily` — дамп есть; архив тома `api-storage` в cron.
- [ ] Порты 5432/5433/8123/9000/3000 снаружи закрыты (`nmap` или `ss -tlnp` на сервере: только 80/443 и ssh).
- [ ] Решение по ПДн в облачной модели зафиксировано (договор или локальная модель).

## Что ещё не сделано (осознанно)

- Один инстанс API: socket.io без Redis, файлы на локальном томе, прогоны графа в процессе. Для второго инстанса нужны Redis-адаптер, S3 и очередь — отдельный этап.
- Почта: приглашения — ссылкой, «забыли пароль» — вместе с входом через Google.
- Метрики/алерты: только `/health` и логи `docker compose logs -f api`. Sentry/Prometheus — по необходимости.
