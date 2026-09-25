# Прод на одном сервере: runbook

Основной прод работает на Railway (план Hobby, деплой из ветки `main` после зеленого CI), его runbook: [`docs/PROD-RAILWAY.md`](PROD-RAILWAY.md). Этот файл описывает второй вариант: один сервер с docker compose, наружу открыт только Caddy (порты 80 и 443). Dockerfile, миграции, контур доступа и `/health` у вариантов общие, различаются запуск и хранение файлов.

## Что нужно

- Сервер Linux 4 vCPU / 8 ГБ. Лимиты памяти в `docker-compose.prod.yml` без профиля `observability` в сумме ≈ 4,3 ГБ (api 2, postgres 1,5, остальное понемногу у web, mcp, caddy и backup), оставшуюся память занимают ОС и page cache. Self-hosted Langfuse (профиль `observability`, еще 4,3 ГБ лимитов) требует сервер на 16 ГБ, поэтому трейсы идут в Langfuse Cloud (раздел "Langfuse в проде"). Docker ≥ 24, compose ≥ 2.24.
- DNS: `PUBLIC_HOST` (например, `rr.company.kz`) указывает на IP сервера. Сертификат Let's Encrypt Caddy получает сам.
- `OPENAI_API_KEY` и решение, можно ли отправлять тексты замечаний и кадры заказчика во внешнюю модель. Без договора с заказчиком нельзя; другой вариант: локальная модель за `LlmModule`. Какие данные уходят в OpenAI и Langfuse Cloud, описано в `README.md`, раздел "Ограничения".

## Первый запуск

```bash
git clone <repo> remark-round && cd remark-round
cp .env.example .env
```

Заполнить `.env`. Секреты генерируются командой `openssl rand -hex 32`; `ENCRYPTION_KEY` должен состоять из 64 hex-символов, это тот же `openssl rand -hex 32`.

| Переменная | Зачем |
|---|---|
| `JWT_SECRET` | подпись токенов; не короче 32 символов, иначе API не стартует |
| `POSTGRES_PASSWORD` | пароль БД приложения. Задать до первого `up`: Postgres создает пользователя один раз |
| `PUBLIC_HOST` | домен для Caddy и `WEB_ORIGIN` |
| `ADMIN_EMAILS` | администраторы инстанса через запятую (ADR 006). Регистрируются в любом режиме, выдают право создавать проекты, отключают людей и завершают их сессии на странице "Администрирование" |
| `REGISTRATION_MODE`, `REGISTRATION_DOMAINS` | необязательно. В production регистрация по умолчанию только по ссылке приглашения (`invite_only`). `REGISTRATION_DOMAINS=company.kz` пускает сотрудников этого домена без ссылки, `open` открывает регистрацию всем, как на демо |
| `OPENAI_API_KEY` | ключ OpenAI для модели и эмбеддингов. Без него API в production не стартует; режим правил без модели включается только явно: `LLM_MODE=rules` |
| `LANGFUSE_CLOUD_URL`, `LANGFUSE_PROJECT_ID`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Langfuse Cloud: адрес региона, id проекта и ключи из настроек проекта. Без трейсов: `LANGFUSE_TRACING_ENABLED=false`. Плейсхолдеры `pk-lf-/sk-lf-remarkround-local` API в production не примет. Секреты self-hosted стека (`NEXTAUTH_SECRET`, `SALT`, `ENCRYPTION_KEY`, `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`, `MINIO_ROOT_PASSWORD`, `LANGFUSE_DB_PASSWORD`, `LANGFUSE_INIT_USER_PASSWORD`) нужны только с профилем `observability` |
| `REPORT_TIMEZONE` | необязательно: часовой пояс дат в xlsx-журнале (IANA, по умолчанию `Asia/Almaty`). С неверным значением API не стартует. Смещение подписано в шапке колонок файла |
| `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` | чтобы не писать `-f` в каждой команде |

Образы на сервере не собираются: CI публикует их в GHCR на каждый push в `main` и на тег `v*` ([ADR 008](adr/008-release-and-ownership.md)). Сборка задается в `.env`: `RR_TAG=sha-<короткий sha>`, `v1.2.0` или `latest` (последний `main`). Запуск и проверка:

```bash
docker compose pull                                 # образы api/web/mcp по RR_TAG и сторонние
docker compose run --rm api migrate                 # миграции отдельным шагом (в проде MIGRATE_ON_START=false)
docker compose up -d
docker compose ps                                   # api/web/mcp: healthy
curl -s https://$PUBLIC_HOST/api/v1/health          # {"ok":true,"db":"ok","version":"sha-…","llm":"openai","vectorIndex":"ok","jobs":{"queued":0,"running":0}}
curl -s https://$PUBLIC_HOST/api/v1/auth/options    # {"demoLogins":false,"registration":"invite_only",...}: демо-персон нет, seed не запускался
```

Без доступа к реестру (закрытый контур) образы собираются на месте: `RR_TAG=local docker compose build`. Тогда в `/health` будет версия `dev`, а сборка на сервере займет несколько минут.

Первым регистрируется администратор инстанса (e-mail из `ADMIN_EMAILS`) на `https://$PUBLIC_HOST/register`: в закрытом режиме только ему регистрация доступна без ссылки. В меню аккаунта → "Администрирование" → "Пригласить руководителя приемки" он получает ссылку `/join/<token>` и отправляет ее сам, писем нет (ADR 013). По ссылке человек регистрируется и получает право создавать проекты; уже зарегистрированному право выдается сразу. Руководитель создает проект и рассылает ссылки участникам (`docs/adr/006-access-contour.md`, дополнение от 17.09), уже зарегистрированные принимают приглашение в колокольчике. Ссылка живет 7 дней и показывается один раз. Если она потерялась, на странице "Участники" есть кнопка "Новая ссылка".

Демо-аккаунтов вроде `pm@remarkround.dev` в проде нет. Демо-данные кладутся только вручную: `docker compose run --rm -e SEED_FORCE=1 api seed`. Обычный старт их не создает: в образе `SEED_ON_START` по умолчанию выключен, демо-стенд включает его в `docker-compose.yml`. Удаление демо-данных: `docker compose run --rm api seed:remove`.

Что задает прод-override (`docker-compose.prod.yml`): `NODE_ENV=production` (со слабым секретом API не стартует), `SEED_ON_START=false`, `DEMO_LOGINS=false`, `REGISTRATION_MODE=invite_only`, срок токена сутки (`JWT_EXPIRES_SECONDS`), `TRUST_PROXY_HOPS=1` (цепочка Caddy → nginx → API: nginx берет адрес клиента из `X-Forwarded-For` от Caddy и передает в API один адрес), кадры и документы в томе `api-storage`, лимиты памяти и кучу Node ниже лимита контейнера (`NODE_OPTIONS`), ротацию логов у всех сервисов, `restart: always`, сервисы `caddy` и `backup`. Langfuse-стек убран за профиль `observability` и не поднимается.

## Обновление

Порядок: бэкап, миграции, новые образы, проверка. Если `migrate` упал, новые образы не поднимать, пока ошибка не разобрана.

```bash
docker compose exec backup /backup.sh      # свежий дамп перед обновлением
sed -i 's/^RR_TAG=.*/RR_TAG=sha-abc1234/' .env   # какую сборку ставим (из CI: Actions → images, или git tag)
docker compose pull api web mcp
docker compose run --rm api migrate        # применит непримененные миграции и выйдет
docker compose up -d api web mcp
docker compose ps && curl -s https://$PUBLIC_HOST/api/v1/health   # version = RR_TAG
```

Миграция `20260907180000_tenancy_fks` (внешние ключи) останавливается с понятной ошибкой, если в базе есть решения без прогона или замечания в раунде чужого проекта. Необязательные ссылки-сироты (автор, "кто закрыл", строка импорта без замечания) она обнуляет сама. Проверка до выката:

```bash
docker compose exec postgres psql -U remarkround -c "select count(*) as verdicts_without_run from \"HumanVerdict\" v left join \"AgentRun\" a on a.id = v.\"runId\" where a.id is null" -c "select count(*) as remarks_in_foreign_round from \"Remark\" r join \"Round\" ro on ro.id = r.\"roundId\" where ro.\"projectId\" <> r.\"projectId\""
```

При `up -d` старый контейнер api получает SIGTERM. Воркер очереди перестает брать новые задачи, дает бегущим прогонам до 25 с и возвращает недоделанные в очередь, новый контейнер их подхватывает (задачи с протухшим `lockedAt` на старте возвращаются в `queued`). Карточки в статусе "разбирается" доходят до черновика сами, нажимать "запустить снова" не нужно. Спокойнее всего обновлять, когда в `/health` значение `jobs.running` равно нулю.

Откат кода: вернуть прежний `RR_TAG` и повторить `pull && up -d`. Сборки нет, это около минуты. Откат данных: восстановление из дампа (ниже). Миграции Prisma сами не откатываются, поэтому миграцию, которая удаляет или переписывает данные, сначала прогоняют на копии базы (`docs/adr/008-release-and-ownership.md`).

## Бэкап и восстановление

### База

Сервис `backup` (`prodrigestivill/postgres-backup-local`) делает `pg_dump` по `BACKUP_SCHEDULE` (по умолчанию раз в сутки) в том `postgres-backups` и хранит 14 дневных, 8 недельных и 6 месячных копий. Список: `docker compose exec backup ls /backups/daily`.

### Копия вне сервера

Дамп на том же диске, что и база, от потери сервера не спасает, поэтому нужна копия вне сервера. Сервис `offsite` (профиль `offsite`) раз в сутки делает `rclone sync` дампов и тома `api-storage` в S3-совместимое хранилище (Backblaze B2, Yandex Object Storage, MinIO в другом ДЦ). Включение: в `.env` задать `COMPOSE_PROFILES=offsite`, `OFFSITE_REMOTE=offsite:<bucket>` и `RCLONE_CONFIG_OFFSITE_*` (см. `.env.example`), затем `docker compose up -d`. Свежесть копии видна в `docker compose ps` (healthcheck: копия старше 36 часов дает unhealthy) и в `docker compose logs offsite`. Сроки хранения задает `backup`, `sync` держит зеркало.

### Файлы

Кадры, документы и дифф-картинки лежат в томе `api-storage` и в дамп БД не попадают, их копирует тот же `offsite`. Ручной архив без профиля: `docker run --rm -v remark-round_api-storage:/data -v $PWD:/out alpine tar czf /out/storage-$(date +%F).tgz -C /data .` (имя тома покажет `docker volume ls`).

### Восстановление

База восстанавливается при остановленном api:

```bash
docker compose stop api mcp
gunzip -c backups/daily/remarkround-<дата>.sql.gz | docker compose exec -T postgres psql -U remarkround -d remarkround
docker compose start api mcp
```

Файлы: распаковать архив обратно в том, `docker run --rm -v remark-round_api-storage:/data -v $PWD:/in alpine sh -c 'cd /data && tar xzf /in/storage-<дата>.tgz'`.

Проверка восстановления на чистой машине: `.env` с теми же секретами, `docker compose pull`, `docker compose up -d postgres`, восстановление дампа как выше, `rclone copy offsite:<bucket>/storage` в том `api-storage`, `docker compose up -d`, вход администратора, открыть карточку с кадром. Время всей процедуры и есть RTO. RPO при суточной копии до 24 часов; `BACKUP_SCHEDULE` и `OFFSITE_INTERVAL_SECONDS` можно сделать чаще.

### История замечаний и трейсы

История замечаний хранится в основной БД (ADR 011). Дампы хранятся 6 месяцев, а история замечаний, события раундов и кадры, включая замененные, нужны годами. История только дописывается, это обеспечивает триггер `rr_append_only`; ни приложение, ни чистка очереди не удаляют строки истории и кадры. Данные заказчика по его требованию удаляются вручную, в транзакции: `ALTER TABLE "RemarkStatusChange" DISABLE TRIGGER "RemarkStatusChange_append_only"` (и `RoundEvent_append_only`, `RemarkScreenshot_no_delete`), удаление, `ENABLE TRIGGER`, затем файлы проекта из тома `api-storage`. Кто и по какому запросу это сделал, записывается в журнал обслуживания.

Трейсы Langfuse в бэкап не входят. В Langfuse Cloud их хранит провайдер по своим срокам. При self-hosted профиле (тома `langfuse-*`) трейсы пропадают вместе с сервером, и ссылки "Трейс в Langfuse" на карточках перестают открываться.

## Наблюдаемость и алерты

### Логи

Логи пишутся JSON-строками (pino). Каждая HTTP-строка содержит `req.id` (он же `X-Request-Id` ответа), `userId`, `projectId`, статус и длительность. Ошибки 5xx пишутся со стеком, события безопасности идут как `security.*` (вход, регистрация, приглашения, участники, отключения). Уровень задает `LOG_LEVEL` (по умолчанию `info`).

Разбор инцидента: пользователь называет `requestId` из сообщения об ошибке, дальше `docker compose logs api | grep <requestId>`. Логи проекта за интервал: `docker compose logs --since 14:00 --until 14:10 api | grep <projectId>`.

Сбой прогона виден на карточке (`runFailure`: "модель перегружена", "ключ не принят", "файл не найден") и в логе строкой `run … failed: <код>` со стеком. Необработанное исключение процесса пишется строкой `uncaughtException` или `unhandledRejection` со стеком, после чего контейнер перезапускается.

### Sentry

`SENTRY_DSN` (api) и `SENTRY_DSN_WEB` (SPA; DSN публичный, SPA получает его из `GET /auth/options`) задаются в `.env`, затем `docker compose up -d api`; в `/health` появляется `sentry: 'on'`. В Sentry уходят ответы 5xx с `requestId`, падения процесса, сбои прогона с кодом `unknown` (ошибка в коде графа) и ошибки фронта у пользователей (глобальный `ErrorHandler`). Без DSN Sentry не инициализируется. Трейсинг и replay выключены.

### Uptime

Внешний монитор (UptimeRobot, Better Stack, HetrixTools) настраивается на `https://$PUBLIC_HOST/api/v1/health`: проверка раз в минуту, уведомление в Telegram или на почту.

### Алерты сервера

`deploy/alerts.sh` запускается на хосте cron'ом раз в час и проверяет свободное место на диске (< 15 %), возраст последнего дампа (> 36 ч), offsite-копию и `/health` (недоступен, `llm=rules`, нет HNSW). Уведомления уходят в Telegram (`ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`) или в webhook (`ALERT_WEBHOOK_URL`):

```bash
echo '0 * * * * ALERT_TELEGRAM_BOT_TOKEN=… ALERT_TELEGRAM_CHAT_ID=… /opt/remark-round/deploy/alerts.sh' | crontab -
```

### 429 у целого офиса

Лимит API считается по вошедшему пользователю (`THROTTLE_LIMIT`, 1200/мин по JWT), для анонимных маршрутов и входа по IP (`THROTTLE_AUTH_LIMIT`, 120/мин). nginx за Caddy берет адрес клиента из `X-Forwarded-For` и ограничивает только `login|register|password|forgot|reset` (300/мин). `/health` без лимита. Если 429 приходит всем сразу, проверить `TRUST_PROXY_HOPS=1` и что nginx видит настоящие адреса: в `docker compose logs web` первый столбец должен содержать адрес клиента, адрес Caddy там означает ошибку в цепочке прокси.

### Очередь задач

`/health` → `jobs: {queued, running}`. Если `queued` растет при `running: 0`, воркер не берет задачи: смотреть `docker compose logs api | grep jobs`. Рост `queued` при `running` = `GRAPH_MAX_CONCURRENT` после большого импорта нормален: прогоны идут по `GRAPH_MAX_PER_PROJECT` на проект, остальные виды задач (индексация, уведомления) их не ждут. Второй экземпляр api удвоил бы эти лимиты, поэтому он не поднимается. Задача, упавшая после всех попыток, получает `Job.status = failed` и `lastError`, прогон к этому моменту уже помечен `failed` с причиной на карточке. Осмотр очереди:

```bash
docker compose exec postgres psql -U remarkround -c "select kind, status, attempts, \"lastError\" from \"Job\" where status in ('queued','running','failed') order by \"createdAt\" desc limit 20"
```

## Типовые сбои

| Ситуация | Что делать |
|---|---|
| OpenAI недоступен или ключ протух | Таймауты, 429 и 5xx модели очередь повторяет сама через 30 с, 2 мин и 8 мин, все это время карточка в статусе "разбирается". После последней попытки и при ошибке ключа карточка показывает "сервис модели недоступен" или "ключ не принят", прогон запускается снова кнопкой. Ключ меняется в `.env`, затем `docker compose up -d api` |
| Прогон упал по дедлайну: на карточке "не уложился в 5 мин", код `timeout` (`GRAPH_RUN_TIMEOUT_MS`) | Модель отвечала по минуте с повторами. Запустить прогон снова |
| `409 Лимит стоимости модели на сутки исчерпан` | Проект израсходовал `GRAPH_DAILY_USD_PER_PROJECT` (20 $) за скользящие сутки. Расход по проектам: `select "projectId", round(sum("costUsd"), 2) from "AgentRun" where "createdAt" > now() - interval '1 day' group by 1`. При необходимости поднять переменную в `.env` (`0` снимает лимит) и выполнить `docker compose up -d api` |
| `507 storage_full` ("кончается место") | Кадры и документы перестают приниматься заранее, когда свободно меньше `STORAGE_MIN_FREE_MB` (2 ГБ). `docker system prune`, затем проверить `docker compose ps` и `/health`. Самые крупные тома: кадры и дампы (`docker system df -v`). Тома `api-storage` и `postgres-backups` лучше держать на отдельном диске |
| Проект получает `507` ("исчерпал квоту") | Сумма файлов проекта больше `STORAGE_QUOTA_MB_PER_PROJECT` (2 ГБ, `0` без квоты). Поднять значение в `.env`, затем `docker compose up -d api` |
| Импорт отвечает 422 ("больше 100 строк") или 413 | Это потолки беты `IMPORT_MAX_ROWS`/`IMPORT_MAX_BYTES`, разбор идет в запросе. Разбить журнал на части |
| Postgres не отвечает | `docker compose logs postgres`, `docker compose restart postgres`, затем `/health` → `db: ok` |

## Без почты (ADR 013)

Почтового домена и SMTP нет, настраивать нечего. Незарегистрированному человеку приглашение отправляется ссылкой `/join/<token>`: PM копирует ее или отправляет кнопкой Telegram или WhatsApp на странице "Участники". Зарегистрированный видит приглашение в колокольчике и принимает сам.

Забытый пароль: человек пишет администратору инстанса, тот открывает "Администрирование" → человек → "Ссылка для смены пароля" (`POST /admin/users/:userId/reset-link`). Ссылка `/reset/<token>` одноразовая, живет сутки, новая гасит прежнюю, отключенному пользователю не выдается. След в логах: `docker compose logs api | grep -E 'security.(password.reset_link|password.reset|invitation.accept|invitation.decline)'`.

## Обслуживание БД

- Роль приложения получает `statement_timeout = 120s` и `idle_in_transaction_session_timeout = 60s` (миграция `20260907130000`): зависший запрос или брошенная транзакция не держат пул и не блокируют autovacuum. Тяжелая миграция начинается с `SET statement_timeout = 0;`.
- Пул Prisma: `connection_limit=25&pool_timeout=20` в `DATABASE_URL` прод-override. Каждый запрос делает минимум два обращения к базе в guard'ах, интерактивные транзакции воркера держат соединение целиком. У Postgres по умолчанию `max_connections=100`, этого хватает на api, backup и psql. При исчерпанном пуле или упавшей базе API отвечает `503 unavailable` с просьбой повторить через минуту. Интерактивные транзакции ждут соединение до 10 с и живут до 30 с (`PrismaService`), индексация ТЗ живет до 120 с и пишет чанки пачками по 200.
- Долгие запросы сейчас: `docker compose exec postgres psql -U remarkround -c "SELECT pid, now()-query_start AS age, state, left(query,80) FROM pg_stat_activity WHERE datname='remarkround' AND state<>'idle' ORDER BY age DESC;"`. Самые дорогие запросы за все время: `… -c "SELECT calls, round(total_exec_time) AS ms, left(query,100) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 15;"` (расширение подключено через `shared_preload_libraries` в команде контейнера).
- Память базы задана командой контейнера в `docker-compose.prod.yml` (`shared_buffers=512MB`, `work_mem=16MB`). При переезде на сервер с другой памятью ее пересчитывают: `shared_buffers` около трети лимита контейнера.
- `GraphCheckpoint` чистится сам: чекпоинты прогонов, завершенных больше недели назад, удаляются на старте api и раз в сутки (бегущие и ожидающие решения прогоны не трогаются). Завершенные задачи очереди удаляются по тому же расписанию (30/90 дней). `DocumentChunk` растет вместе с пакетом документов, размер таблиц раз в месяц смотрят через `docker compose exec postgres psql -U remarkround -c "\dt+"`.

## Langfuse в проде

Трейсы уходят в Langfuse Cloud: self-hosted стек на сервере 8 ГБ занимал 4,3 ГБ лимитов, и ClickHouse падал по OOM. В `.env` задаются `LANGFUSE_CLOUD_URL`, `LANGFUSE_PROJECT_ID` и ключи проекта, затем `docker compose up -d api`; в `/health` появляется `tracing: 'on'`. Ссылка "Трейс в Langfuse" на карточке у PM ведет на `LANGFUSE_PUBLIC_URL` (по умолчанию тот же адрес, что `LANGFUSE_CLOUD_URL`).

В трейсах есть тексты замечаний и цитаты ТЗ заказчика, и во внешний сервис они уходят так же, как в модель OpenAI. Поэтому разрешение на передачу данных фиксируется сразу для модели и для Langfuse. Трейсы выключаются полностью через `LANGFUSE_TRACING_ENABLED=false` (`tracing: 'off'`, ключи не нужны).

Self-hosted стек (6 сервисов) остался за профилем `observability`. Для него нужны сервер на 16 ГБ, `COMPOSE_PROFILES=offsite,observability`, все секреты стека в `.env` (`NEXTAUTH_SECRET`, `SALT`, `ENCRYPTION_KEY`, `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`, `MINIO_ROOT_PASSWORD`, `LANGFUSE_DB_PASSWORD`, `LANGFUSE_INIT_USER_PASSWORD`, ключи) и `LANGFUSE_PUBLIC_URL=http://localhost:3000`; `LANGFUSE_CLOUD_URL` не задается. UI наружу не публикуется, порт 3000 открыт только на 127.0.0.1: `ssh -L 3000:127.0.0.1:3000 user@server`, затем `http://localhost:3000` (вход: `LANGFUSE_INIT_USER_EMAIL` / `_PASSWORD`). Ссылка с карточки открывается только через этот туннель.

Compose не проверяет секреты выключенного профиля. При включенном профиле с пустыми секретами langfuse-web, langfuse-worker и minio не стартуют, а clickhouse и redis поднимаются без пароля, поэтому после `up` нужно проверить `docker compose ps`.

## Чеклист перед запуском

- [ ] `JWT_SECRET`, `POSTGRES_PASSWORD`, `PUBLIC_HOST`, `ADMIN_EMAILS` заданы; ключи Langfuse Cloud настоящие (или `LANGFUSE_TRACING_ENABLED=false`); в `.env` не осталось плейсхолдеров `change-me-local-dev`; в `COMPOSE_PROFILES` нет `observability`.
- [ ] `docker compose config -q` проходит без ошибок, в `docker compose ps` все сервисы healthy.
- [ ] `/api/v1/auth/options` → `{ demoLogins: false, registration: 'invite_only' }` без `demoAccounts`; вход `pm@remarkround.dev` → 401; регистрация с чужого адреса без ссылки → 403. Если в прод попал том стенда (запрос `select email from "User" where email like '%remarkround.dev'` не пустой), выполнить `docker compose run --rm api seed:remove`: команда удаляет 5 демо-персон и 2 демо-проекта по фиксированным id и больше ничего не трогает.
- [ ] Администратор зарегистрировался и пригласил руководителя приемки ссылкой. Руководитель зарегистрировался по ссылке, создал проект и пригласил участника по ссылке, участник вошел. Зарегистрированный пользователь принял приглашение в колокольчике. Администратор выдал ссылку смены пароля, и пароль по ней сменился.
- [ ] Уволенного сотрудника отключают одной кнопкой в "Администрировании": его открытая вкладка и MCP-токен сразу перестают работать.
- [ ] `docker compose exec backup ls /backups/daily` показывает дамп; профиль `offsite` включен, `docker compose ps offsite` показывает healthy; восстановление проверено на чистой машине.
- [ ] Внешний uptime-монитор на `/health` заведен; `deploy/alerts.sh` стоит в cron и прислал тестовое сообщение (`DISK_MIN_FREE_PCT=100 ./deploy/alerts.sh`).
- [ ] `RR_TAG` в `.env` совпадает с тегом из CI, `/api/v1/health` показывает его в `version`; на выкаченный коммит поставлен `git tag v…`.
- [ ] Порты 5432 (и 5433/8123/9000/3000 при профиле `observability`) снаружи закрыты: `nmap` или `ss -tlnp` на сервере показывают только 80/443 и ssh. `/health` → `tracing: 'on'`.
- [ ] Решение по ПДн в облачной модели зафиксировано (договор или локальная модель).

## Известные ограничения

- Нагрузочное тестирование не проводилось. Узкие места: прогоны модели (лимиты `GRAPH_MAX_CONCURRENT` / `GRAPH_MAX_PER_PROJECT`) и pixel-diff с разбором файлов в одном процессе API. Список замечаний отдается без пагинации.
- Один экземпляр API: socket.io без Redis, файлы на локальном томе. Прогоны графа и индексация идут через очередь в Postgres и переживают перезапуск. Для второго экземпляра нужны Redis-адаптер socket.io и общее хранилище файлов (S3), см. `docs/ARCHITECTURE.md`.
- Почты нет (ADR 013). Подтверждения e-mail при регистрации тоже нет, поэтому приглашение в колокольчике видит тот, кто первым зарегистрировал адрес (PM видит имя аккаунта).
- Prometheus и Grafana нет. Есть `/health` (версия, режим модели, векторный индекс, трейсинг, Sentry), структурные логи, `deploy/alerts.sh` и Sentry при заданном `SENTRY_DSN`.
- Отдельного staging нет, релиз проверяется на демо-стенде и в CI.
- Деплой ручной: образы собирает CI, `pull && up` по этому runbook запускает человек.
- Прод-образ api содержит devDependencies и исходники (одна стадия сборки).
- Полное восстановление по этой схеме (дамп и файлы на чистой машине) не проводилось.
