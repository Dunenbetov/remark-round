# Прод на одном сервере — runbook

Фаза 11 (сентябрь 2026). Одна машина, docker compose, наружу смотрит только Caddy (80/443). Ёмкость нагрузочно не тестировалась: узкое место — прогоны модели (лимит `GRAPH_MAX_CONCURRENT` / `GRAPH_MAX_PER_PROJECT`) и pixel-diff с разбором файлов в одном процессе API; список замечаний отдаётся без пагинации. Перед обещанием SLA нескольким командам — прогнать `autocannon`/`k6` по журналу на 300 строк и параллельным ретестам. Второй инстанс API — отдельный этап (Redis для socket.io, S3 вместо тома; очередь задач уже в Postgres), см. `docs/ARCHITECTURE.md`.

## Что нужно

- Сервер Linux **4 vCPU / 8 ГБ**: лимиты памяти в `docker-compose.prod.yml` в сумме ≈ 7 ГБ (api 1.5, postgres 1, ClickHouse 1.5, langfuse-web 1, worker 0.75, остальное по мелочи); на 4 ГБ Langfuse-стек и база начнут вытеснять друг друга. Docker ≥ 24 с compose ≥ 2.24.
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
| `ADMIN_EMAILS` | администраторы инстанса через запятую (ADR 006): регистрируются всегда, выдают право создавать проекты, отключают людей и завершают их сессии на странице «Администрирование» |
| `REGISTRATION_MODE`, `REGISTRATION_DOMAINS` | необязательно: в production регистрация по умолчанию только по ссылке приглашения (`invite_only`); `REGISTRATION_DOMAINS=company.kz` пускает сотрудников с этого домена без ссылки; `open` — как на демо |
| `OPENAI_API_KEY` | без него граф работает правилами по retrieve (честно, но грубее) |
| `NEXTAUTH_SECRET`, `SALT`, `ENCRYPTION_KEY`, `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`, `MINIO_ROOT_PASSWORD`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_INIT_USER_PASSWORD` | секреты Langfuse: заменить плейсхолдеры `change-me-local-dev` |
| `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` | чтобы не писать `-f` каждый раз |

Образы не собираются на сервере: CI публикует их в GHCR на каждый push в `main` и тег `v*` ([ADR 008](adr/008-release-and-ownership.md)). В `.env` укажите, какую сборку поднимать: `RR_TAG=sha-<короткий sha>` (или `v1.2.0`; `latest` — последний `main`). Запуск и проверка:

```bash
docker compose pull                                 # образы api/web/mcp по RR_TAG + сторонние
docker compose run --rm api migrate                 # миграции — отдельным шагом (в проде MIGRATE_ON_START=false)
docker compose up -d
docker compose ps                                   # api/web/mcp — healthy
curl -s https://$PUBLIC_HOST/api/v1/health          # {"ok":true,"db":"ok","version":"sha-…","llm":"openai","vectorIndex":"ok","jobs":{"queued":0,"running":0}}
curl -s https://$PUBLIC_HOST/api/v1/auth/options    # {"demoLogins":false,"registration":"invite_only"} — демо-персон нет, seed не шёл
```

Если реестр недоступен (закрытый контур), соберите на месте: `RR_TAG=local docker compose build` — но тогда версия в `/health` будет `dev`, а сервер потратит минуты на сборку.

Первым регистрируется администратор инстанса (e-mail из `ADMIN_EMAILS`) на `https://$PUBLIC_HOST/register` — только ему регистрация в закрытом режиме открыта без ссылки. В меню аккаунта → «Администрирование» он выдаёт руководителю приёмки право создавать проекты (или регистрирует его по ссылке приглашения); дальше руководитель создаёт проект и рассылает ссылки участникам (`docs/adr/006-access-contour.md`). Ссылка живёт 7 дней и показывается один раз: пропала — «Новая ссылка» на странице «Участники». Демо-аккаунтов `pm@remarkround.dev` в проде нет — и не должно быть.

Прод-override делает: `NODE_ENV=production` (fail-fast на слабом секрете), `SEED_ON_START=false`, `DEMO_LOGINS=false`, `REGISTRATION_MODE=invite_only`, срок токена сутки (`JWT_EXPIRES_SECONDS`), `TRUST_PROXY_HOPS=2` (Caddy → nginx → API), кадры и документы в томе `api-storage`, ротация логов, `restart: always`, сервисы `caddy` и `backup`.

## Обновление

Порядок всегда один: бэкап → миграции → новые образы → проверка. Если `migrate` упал — образы не поднимать, разбираться.

```bash
docker compose exec backup /backup.sh      # свежий дамп перед обновлением
sed -i 's/^RR_TAG=.*/RR_TAG=sha-abc1234/' .env   # какую сборку ставим (из CI: Actions → images, или git tag)
docker compose pull api web mcp
docker compose run --rm api migrate        # применит непримененные миграции и выйдет
docker compose up -d api web mcp
docker compose ps && curl -s https://$PUBLIC_HOST/api/v1/health   # version = RR_TAG
```

Миграция `20260907180000_tenancy_fks` (внешние ключи) останавливается с понятной ошибкой, если в базе есть решения без прогона или замечания в раунде чужого проекта; необязательные сироты (автор, «кто закрыл», строка импорта без замечания) она обнуляет сама. Проверить до выката:

```bash
docker compose exec postgres psql -U remarkround -c "select count(*) as verdicts_without_run from \"HumanVerdict\" v left join \"AgentRun\" a on a.id = v.\"runId\" where a.id is null" -c "select count(*) as remarks_in_foreign_round from \"Remark\" r join \"Round\" ro on ro.id = r.\"roundId\" where ro.\"projectId\" <> r.\"projectId\""
```

Во время `up -d` старый контейнер api получает SIGTERM: воркер очереди не берёт новых задач, даёт бегущим прогонам до 25 с и возвращает недоделанные в очередь; новый контейнер их подхватывает (задачи с протухшим `lockedAt` возвращаются в `queued` на старте). Карточки в «разбирается» доходят до черновика сами, кнопку «запустить снова» нажимать не нужно. Перед обновлением можно глянуть `/health` → `jobs.running`: ноль — самый спокойный момент.

Откат кода — вернуть прежний `RR_TAG` и повторить `pull && up -d` (сборки нет, минута). Откат данных — restore ниже: миграции Prisma не откатываются автоматически, поэтому миграцию, которая удаляет или переписывает данные, сначала репетируют на копии (`docs/adr/008-release-and-ownership.md`).

## Бэкап и восстановление

- **База.** Сервис `backup` (`prodrigestivill/postgres-backup-local`) делает `pg_dump` по `BACKUP_SCHEDULE` (по умолчанию ежедневно) в том `postgres-backups`: хранит 14 дневных, 8 недельных, 6 месячных. Список: `docker compose exec backup ls /backups/daily`.
- **Копия вне сервера — обязательна.** Дамп на том же диске, что и база, — не бэкап. Сервис `offsite` (профиль `offsite`) раз в сутки делает `rclone sync` дампов и тома `api-storage` в S3-совместимое хранилище (Backblaze B2, Yandex Object Storage, MinIO в другом ДЦ). В `.env`: `COMPOSE_PROFILES=offsite`, `OFFSITE_REMOTE=offsite:<bucket>`, `RCLONE_CONFIG_OFFSITE_*` (см. `.env.example`), затем `docker compose up -d`. Свежесть копии видна в `docker compose ps` (healthcheck: старше 36 часов — unhealthy) и в логах `docker compose logs offsite`. Ретеншн задаёт `backup` (sync — зеркало).
- **Файлы** (кадры, документы, дифф-картинки) в томе `api-storage` — в дамп БД **не** попадают; их копирует тот же `offsite`. Ручной архив, если профиль не включён: `docker run --rm -v remark-round_api-storage:/data -v $PWD:/out alpine tar czf /out/storage-$(date +%F).tgz -C /data .` (имя тома — `docker volume ls`).
- **Восстановление БД** (на остановленном api):
  ```bash
  docker compose stop api mcp
  gunzip -c backups/daily/remarkround-<дата>.sql.gz | docker compose exec -T postgres psql -U remarkround -d remarkround
  docker compose start api mcp
  ```
  Файлы: распаковать архив обратно в том (`docker run --rm -v remark-round_api-storage:/data -v $PWD:/in alpine sh -c 'cd /data && tar xzf /in/storage-<дата>.tgz'`).
- **Репетиция восстановления — до первого пилота и потом раз в квартал.** На чистой машине: `.env` с теми же секретами, `docker compose pull`, `docker compose up -d postgres`, restore дампа как выше, `rclone copy offsite:<bucket>/storage` в том `api-storage`, `docker compose up -d`, вход администратора, открыть карточку с кадром. Засечь время — это и есть RTO; RPO при суточной копии — до 24 часов (`BACKUP_SCHEDULE` и `OFFSITE_INTERVAL_SECONDS` можно сделать чаще). Записать дату и время репетиции сюда: последняя — _не проводилась_.
- **Пояс дат в xlsx-журнале** — `REPORT_TIMEZONE` (IANA, по умолчанию `Asia/Almaty`; неверное значение — API не стартует). Смещение подписано в шапке колонок файла.
- **Доказательная база живёт в основной БД, а не в бэкапах** (ADR 011): дампы хранятся 6 месяцев, а история замечаний, события раундов и кадры (включая заменённые) нужны годами. История только дописывается — это держит триггер `rr_append_only`; строки истории и кадры не удаляются ни приложением, ни чисткой очереди. Удаление данных заказчика по требованию — вручную, в транзакции: `ALTER TABLE "RemarkStatusChange" DISABLE TRIGGER "RemarkStatusChange_append_only"` (и `RoundEvent_append_only`, `RemarkScreenshot_no_delete`), удаление, `ENABLE TRIGGER`, затем файлы проекта из тома `api-storage`; запись о том, кто и по какому запросу это сделал, — в журнал обслуживания.
- Трейсы Langfuse (тома `langfuse-*`) **не бэкапятся** осознанно: это наблюдаемость, не данные приёмки; при потере сервера они пропадают вместе со ссылками «Трейс в Langfuse» на карточках.

## Наблюдаемость и алерты

- **Логи** — JSON-строки (pino): каждая HTTP-строка несёт `req.id` (= `X-Request-Id` ответа), `userId`, `projectId`, статус и длительность; ошибки 5xx — со стеком; события безопасности — `security.*` (вход, регистрация, приглашения, участники, отключения). Разбор инцидента: пользователь называет `requestId` из сообщения об ошибке → `docker compose logs api | grep <requestId>`. По проекту за интервал: `docker compose logs --since 14:00 --until 14:10 api | grep <projectId>`. Уровень — `LOG_LEVEL` (`info` по умолчанию).
- **Сбой прогона** виден на карточке (`runFailure`: «модель перегружена», «ключ не принят», «файл не найден») и в логе строкой `run … failed: <код>` со стеком; необработанное исключение процесса — строка `uncaughtException`/`unhandledRejection` со стеком и перезапуск контейнера.
- **Uptime.** Внешний бесплатный монитор (UptimeRobot, Better Stack, HetrixTools) на `https://$PUBLIC_HOST/api/v1/health` раз в минуту с уведомлением в Telegram или почту — единственный способ узнать, что сервер лёг, раньше пользователей. Заведите до пилота.
- **Алерты сервера** — `deploy/alerts.sh` cron'ом раз в час на хосте: свободное место на диске (< 15 %), возраст последнего дампа (> 36 ч), offsite-копия, `/health` (недоступен, `llm=rules`, нет HNSW). Уведомление — Telegram (`ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`) или webhook (`ALERT_WEBHOOK_URL`):
  ```bash
  echo '0 * * * * ALERT_TELEGRAM_BOT_TOKEN=… ALERT_TELEGRAM_CHAT_ID=… /opt/remark-round/deploy/alerts.sh' | crontab -
  ```
- **Очередь задач.** `/health` → `jobs: {queued, running}`. Растущий `queued` при `running: 0` — воркер не берёт задачи (смотреть `docker compose logs api | grep jobs`); задача, упавшая после всех попыток, — `Job.status = failed` с `lastError`, прогон при этом уже помечен `failed` с причиной на карточке. Осмотреть: `docker compose exec postgres psql -U remarkround -c "select kind, status, attempts, \"lastError\" from \"Job\" where status in ('queued','running','failed') order by \"createdAt\" desc limit 20"`.
- **Что делать, если** OpenAI лежит или ключ протух: таймауты, 429 и 5xx модели очередь повторяет сама через 30 с, 2 мин и 8 мин — карточка всё это время «разбирается»; после последней попытки и при ошибке ключа карточки показывают «сервис модели недоступен» / «ключ не принят», прогоны можно запускать снова кнопкой; ключ меняется в `.env` и `docker compose up -d api`. Диск кончился: `docker system prune`, затем проверить `docker compose ps` и `/health`; кадры и дампы — самые крупные тома (`docker system df -v`). Postgres не отвечает: `docker compose logs postgres`, `docker compose restart postgres`, затем `/health` → `db: ok`.

## Почта

`SMTP_URL=smtp://user:pass@mail.company.kz:587` (или `smtps://…:465`) и `SMTP_FROM='RemarkRound <rr@company.kz>'` в `.env`, затем `docker compose up -d api`. Уходят два вида писем (ADR 009): ссылка приглашения — сразу, и «вас ждёт кнопка» — одно письмо на всё, что накопилось у человека за `NOTIFY_DIGEST_MS` (5 минут). Проверить: добавить участника по незнакомому e-mail — в ответе `emailed: true`, в логе `job send_mail … done`. Письма не доходят: `docker compose logs api | grep -E 'send_mail|notify_digest'` — SMTP-ошибка повторяется три раза с паузой, потом уведомление помечается `failed` с текстом ошибки (`select status, error from "Notification" where status='failed'`). Без `SMTP_URL` всё работает, но писем нет: интерфейс говорит об этом в профиле и на странице участников.

## Обслуживание БД

- Роль приложения получает `statement_timeout = 120s` и `idle_in_transaction_session_timeout = 60s` (миграция `20260907130000`): зависший запрос или брошенная транзакция не держат пул из 10 соединений и не блокируют autovacuum. Тяжёлая миграция начинается с `SET statement_timeout = 0;`.
- «Почему всё висит»: `docker compose exec postgres psql -U remarkround -c "SELECT pid, now()-query_start AS age, state, left(query,80) FROM pg_stat_activity WHERE datname='remarkround' AND state<>'idle' ORDER BY age DESC;"`. Самые дорогие запросы за всё время: `… -c "SELECT calls, round(total_exec_time) AS ms, left(query,100) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 15;"` (расширение включено в образе через `shared_preload_libraries`).
- Память базы задана командой контейнера в `docker-compose.prod.yml` (`shared_buffers=256MB`, `work_mem=16MB`): при переезде на сервер с другой памятью пересчитать (shared_buffers ≈ 25 % от лимита контейнера).
- Рост таблиц: `GraphCheckpoint` (чекпоинты графа, растут с каждым прогоном) и `DocumentChunk` — смотреть `docker compose exec postgres psql -U remarkround -c "\dt+"` раз в месяц; ретеншн чекпоинтов — отдельная задача аудита (graph-checkpoint-growth).

## Langfuse в проде

UI Langfuse наружу не публикуется (порт 3000 только на 127.0.0.1 сервера). Смотреть трейсы: `ssh -L 3000:127.0.0.1:3000 user@server`, затем `http://localhost:3000` (вход — `LANGFUSE_INIT_USER_EMAIL` / `_PASSWORD`). Ссылка «Трейс в Langfuse» на карточке у PM ведёт на `LANGFUSE_PUBLIC_URL` (по умолчанию `http://localhost:3000`) — работает у того, кто в туннеле. В трейсах — тексты замечаний и цитаты ТЗ заказчика: это ещё одна причина держать Langfuse внутри.

## Чеклист перед запуском

- [ ] `JWT_SECRET`, `POSTGRES_PASSWORD`, `PUBLIC_HOST`, `ADMIN_EMAILS` заданы; плейсхолдеры `change-me-local-dev` в `.env` не остались.
- [ ] `docker compose config -q` без ошибок; `docker compose ps` — все healthy.
- [ ] `/api/v1/auth/options` → `{ demoLogins: false, registration: 'invite_only' }`; вход `pm@remarkround.dev` → 401; регистрация с чужого адреса без ссылки → 403.
- [ ] Администратор зарегистрировался → выдал право создавать проекты → PM создал проект → приглашение по ссылке → второй человек вошёл.
- [ ] Уволенного можно отключить одной кнопкой в «Администрировании»: его открытая вкладка и MCP-токен перестают работать сразу.
- [ ] `docker compose exec backup ls /backups/daily` — дамп есть; профиль `offsite` включён и `docker compose ps offsite` — healthy; репетиция восстановления проведена, дата записана выше.
- [ ] Внешний uptime-монитор на `/health` заведён; `deploy/alerts.sh` в cron и прислал тестовое сообщение (`DISK_MIN_FREE_PCT=100 ./deploy/alerts.sh`).
- [ ] `RR_TAG` в `.env` = тег из CI, `/api/v1/health` показывает его в `version`; `git tag v…` поставлен на выкаченный коммит.
- [ ] Порты 5432/5433/8123/9000/3000 снаружи закрыты (`nmap` или `ss -tlnp` на сервере: только 80/443 и ssh).
- [ ] Решение по ПДн в облачной модели зафиксировано (договор или локальная модель).

## Что ещё не сделано (осознанно)

Каждый пункт — с условием, когда его пересмотреть; иначе через полгода не отличить решение от забывчивости.

- Один инстанс API: socket.io без Redis, файлы на локальном томе. Прогоны графа и индексация уже идут через очередь в Postgres и переживают перезапуск; для второго инстанса остаются Redis-адаптер socket.io и общее хранилище файлов (S3). **Пересмотреть до подключения второй команды с требованием к аптайму деплоя.**
- Почта: приглашения и «вас ждёт кнопка» уходят письмом при заданном `SMTP_URL` (ADR 009); «забыли пароль» и подтверждение e-mail — нет. **Пересмотреть при первом же потоке обращений «сбросьте пароль» или до раскатки на несколько команд.**
- Метрики: Prometheus/Grafana нет — есть `/health` (версия, режим модели, векторный индекс), структурные логи и `deploy/alerts.sh`. Полноценные метрики и Sentry — **до раскатки на несколько команд.**
- Staging: отдельного окружения нет, релиз проверяется на демо-стенде и в CI. **Пересмотреть, когда цена сломанного релиза станет дороже второго сервера.**
- Деплой руками по этому runbook (образы из CI, но `pull && up` — человек). **Пересмотреть, когда серверов станет больше одного.**
- Прод-образ api содержит devDependencies и исходники (одна стадия сборки). **Пересмотреть при сканировании образов в CI.**
- Демо-данные в проде — только руками (`docker compose run --rm -e SEED_FORCE=1 api seed`), обычный старт их не кладёт.
