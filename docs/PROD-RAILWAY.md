# Прод на Railway: runbook

Основной прод: `https://remark-round.up.railway.app`, регион `europe-west4-drams3a` (Амстердам). Второй вариант, один сервер с docker compose, описан в `docs/PROD.md`. Dockerfile (`apps/api/Dockerfile`, `apps/web/Dockerfile`), миграции, контур доступа (ADR 006) и `/health` у них общие, различаются запуск и хранение файлов.

## Схема

```
браузер ──https──▶ edge-прокси Railway ──▶ web (nginx, публичный домен)
                                              │  /api/*, /api/v1/ws  → приватная сеть Railway
                                              ▼
                                            api (Nest, порт 3000, том /app/apps/api/storage: кадры и документы)
                                              │  DATABASE_URL по приватной сети
                                              ▼
                                            postgres (pgvector/pgvector:pg17, том /var/lib/postgresql/data)
```

- Один проект Railway, окружение `production`, три сервиса: `web` и `api` из репозитория GitHub `Dunenbetov/remark-round` (ветка `main`) и `postgres` из Docker-образа. `mcp` на Railway не поднят (раздел "MCP (по желанию)").
- Деплой запускает push в `main`, но только после зеленого workflow `ci` (`.github/workflows/ci.yml`): настройка Wait for CI, шаг 5.
- Сервисы связаны приватной сетью Railway по именам `<сервис>.railway.internal`, наружу открыт только `web`.
- Два тома: у `api` (файлы) и у `postgres` (база). Копию базы снимает скрипт `scripts/prod-db-dump.sh` (раздел "Копия базы").

По сравнению с `docs/PROD.md` здесь нет Caddy (TLS дает Railway), сервисов `backup` и `offsite` (копию базы снимает скрипт) и лимитов памяти compose (Railway берет плату за фактическое потребление, шаг 7).

## Ветки

- `main` идет на Railway. Туда попадает только то, что прошло CI. Переменные и секреты в коде не хранятся, они заданы в Variables сервисов Railway.
- `dev` поднимается локальным стендом `docker compose up` (`docker-compose.yml`). На Railway из `dev` ничего не попадает, пока изменения не влиты в `main`.
- `.env` на Railway не используется. В конце `.env.example` есть блок "Railway": какие переменные задаются какому сервису.

## Шаг 0. Подготовка

1. Аккаунт Railway на плане Hobby (5 $/мес, в него включены ресурсы на 5 $). На Free/Trial нет постоянных сервисов с томами.
2. GitHub подключен к Railway: аватар → Account Settings → Integrations → GitHub. При первом "+ New → GitHub Repo" Railway сам предлагает установить свое GitHub-приложение. Приложению нужен доступ к репозиторию `Dunenbetov/remark-round`, иначе Railway не видит ветку `main` и не может ждать CI.
3. Лимит расходов: аватар → Workspace → Usage (или Settings → Usage) → Set Usage Limits. В окне два поля: Custom email alert (письмо при достижении суммы, например 15 $) и Hard limit (жесткий потолок, минимум 10 $, ставим 25 $). При достижении Hard limit Railway останавливает все сервисы и не списывает деньги сверх лимита, после повышения или снятия лимита перезапускает их сам. Ожидаемый счет 10-15 $ в месяц (шаг 7), 25 $ оставляют запас на пики.
4. Секреты генерируются локально: `openssl rand -hex 32` для `JWT_SECRET`, `openssl rand -hex 16` для пароля Postgres. Их хранят в менеджере паролей, в репозиторий они не попадают.
5. Нужны `OPENAI_API_KEY` и решение, можно ли отправлять тексты замечаний и кадры во внешнюю модель (`README.md`, раздел "Ограничения").

Railway копит изменения настроек как staged changes и применяет их кнопкой Deploy вверху канвы. Сервис из GitHub может начать деплоиться сразу после создания, до ввода переменных. Такой деплой упадет на проверке конфига API и потом пересоберется. Проще создать сервис, не нажимать Deploy, заполнить Variables и Settings и только потом нажать Deploy.

## Шаг 1. Проект и Postgres

1. New Project → Empty Project, название `remark-round`. Окружение по умолчанию называется `production`, его оставить.
2. Postgres с pgvector. Миграция `packages/db/prisma/migrations/20250820120000_init/migration.sql` выполняет `CREATE EXTENSION IF NOT EXISTS "vector"`. Официальный шаблон Postgres в Railway (`ghcr.io/railwayapp-templates/postgres-ssl`) расширений не содержит: по документации Railway, для pgvector нужен образ базы с этим расширением. Поэтому на канве: + New → Docker Image, образ `pgvector/pgvector:pg17`, тот же, что в compose. Имя сервиса `postgres`: от него зависят адрес в приватной сети и ссылки на переменные ниже.

   Шаблон сообщества `railway.com/deploy/3jJFCA` тоже дает pgvector и готовый `DATABASE_URL`, но на Postgres 18 (образ `pgvector/pgvector:pg18`), а compose и CI работают на 17.
3. Variables у `postgres` (вкладка Variables → New Variable, или Raw Editor со строками `KEY=value`):

   | Переменная | Значение | Зачем |
   |---|---|---|
   | `POSTGRES_USER` | `remarkround` | как в compose; под это имя собран `DATABASE_URL` ниже |
   | `POSTGRES_PASSWORD` | из `openssl rand -hex 16` | пароль создается при первом старте, потом его меняют только через `ALTER USER` |
   | `POSTGRES_DB` | `remarkround` | имя базы |
   | `PGDATA` | `/var/lib/postgresql/data/pgdata` | в корне тома Railway лежит `lost+found`, а `initdb` не работает в непустом каталоге, поэтому данные лежат в подкаталоге |

4. Том: правый клик по канве (или ⌘K) → Add Volume → сервис `postgres` → Mount Path `/var/lib/postgresql/data`. Без тома база стирается при каждом деплое. На Hobby том по умолчанию до 5 ГБ, размер увеличивается в настройках тома (Volume Size).
5. Необязательно: Settings → Deploy → Custom Start Command `postgres -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all`, как в compose-проде. С ним работает `pg_stat_statements` (самые дорогие запросы, `docs/PROD.md`, раздел "Обслуживание БД"). Без него миграция `20260907130000_pg_role_settings` тоже проходит: расширение создается, но статистику не собирает.
6. Deploy. В логах Deployments должна появиться строка `database system is ready to accept connections`. Публичный доступ (Settings → Networking → TCP Proxy) не включать: база нужна только `api` по приватной сети.

Адрес базы `api` получает через ссылки на переменные Railway `${{postgres.ИМЯ}}`. Railway подставляет значения при деплое, поэтому пароль хранится в одном месте и во второй сервис не копируется. Хост: `${{postgres.RAILWAY_PRIVATE_DOMAIN}}` (= `postgres.railway.internal`). В отличие от публичного TCP-прокси, трафик по приватной сети не выходит наружу и не считается исходящим.

## Шаг 2. api

1. + New → GitHub Repo → `Dunenbetov/remark-round`. Имя сервиса `api`: от него зависит адрес `api.railway.internal` для `web`. Deploy не нажимать, пока не заполнены пункты 2-5.
2. Settings → Source: Branch `main`, Root Directory `/`. Контекстом сборки должен быть весь репозиторий: `apps/api/Dockerfile` копирует `packages/db`, `skills`, `fixtures/*`. Путь к Dockerfile Railway берет из переменной `RAILWAY_DOCKERFILE_PATH` (ниже).
3. Settings → Deploy: Healthcheck Path `/api/v1/health`; Healthcheck Timeout `300` (секунд, значение Railway по умолчанию; первый старт прогоняет все миграции); Restart Policy `On Failure`, Max Retries `10`; Replicas `1`. Больше одной реплики ставить нельзя: семафоры графа и присутствие в комнате WebSocket живут в памяти процесса, второй экземпляр их не увидит, а том подключается только к одному экземпляру.
4. Том: правый клик по канве → Add Volume → сервис `api` → Mount Path `/app/apps/api/storage`. Здесь лежат кадры, документы и дифф-картинки (`STORAGE_DIR`); в compose-проде это том `api-storage`.
5. Variables у `api` (Raw Editor, по строке `KEY=value`; ссылки `${{…}}` вставлять как есть):

   | Переменная | Значение | Зачем |
   |---|---|---|
   | `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` | Dockerfile лежит не в корне репозитория |
   | `RAILWAY_RUN_UID` | `0` | том Railway монтируется от `root`, а образ работает от пользователя `node`; без этой переменной запись кадров падает с `EACCES` (рекомендация документации Railway по томам) |
   | `PORT` | `3000` | Railway подставляет `PORT` сам, значение зафиксировано, потому что `web` проксирует на `api.railway.internal:3000` |
   | `DATABASE_URL` | `postgresql://remarkround:${{postgres.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/remarkround?connection_limit=25&pool_timeout=20` | база по приватной сети; пул 25 соединений и ожидание 20 с, как в compose-проде |
   | `JWT_SECRET` | `openssl rand -hex 32` | подпись токенов; в `production` с секретом короче 32 символов API не стартует |
   | `JWT_EXPIRES_SECONDS` | `86400` | сессия на сутки, как в прод-override compose |
   | `WEB_ORIGIN` | `https://<домен web>` | CORS и ссылки. Домен появится на шаге 3, до этого `https://example.com` |
   | `ADMIN_EMAILS` | `you@company.kz` | администраторы инстанса (ADR 006): регистрируются первыми, приглашают руководителя приемки |
   | `REGISTRATION_MODE` | `open` | на бете регистрация открыта всем (ADR 006, дополнение от 17.09). Без переменной в production действует `invite_only`: регистрация только по ссылке приглашения. Право создавать проекты в обоих режимах выдает администратор |
   | `OPENAI_API_KEY` | ключ | без него API в `production` не стартует; режим правил без модели включается только явно: `LLM_MODE=rules` (черновики грубее) |
   | `STORAGE_DIR` | `/app/apps/api/storage` | совпадает с Mount Path тома |
   | `STORAGE_MIN_FREE_MB` | `512` | порог "кончается место"; значение по умолчанию 2048 для тома 5 ГБ слишком велико |
   | `STORAGE_QUOTA_MB_PER_PROJECT` | `1024` | квота файлов на проект, чтобы один импорт кадров не занял весь том |
   | `MIGRATE_ON_START` | `true` | миграции при каждом старте контейнера (`apps/api/docker-entrypoint.sh`). В compose-проде здесь `false` и отдельный шаг `run api migrate`. На Railway отдельного шага нет, экземпляр один, поэтому гонки миграций не бывает |
   | `SEED_ON_START` | `false` | демо-данных в проде нет (в образе по умолчанию тоже `false`, здесь задано явно) |
   | `TRUST_PROXY_HOPS` | `1` | см. "Почему `TRUST_PROXY_HOPS=1`" ниже |
   | `IMPORT_MAX_ROWS` / `IMPORT_MAX_BYTES` | `100` / `5242880` | лимит импорта журнала на бете, как в compose-проде |
   | `LANGFUSE_TRACING_ENABLED` | `false` | первый деплой без трейсов. Langfuse Cloud подключается в шаге 8, после проверки, что приложение работает |
   | `NODE_OPTIONS` | `--max-old-space-size=1536` | необязательно: потолок кучи Node, чтобы утечка памяти не превращалась в счет за гигабайты (Railway берет плату за фактическую память) |

   Не задавать: `NODE_ENV` (в образе уже `production`), `DEMO_LOGINS` (в production по умолчанию `false`), `REGISTRATION_DOMAINS` (работает только в `invite_only`: `company.kz` пускает сотрудников домена без ссылки). Остальные `LANGFUSE_*` и `SENTRY_*` добавляются в шаге 8.

   `GIT_SHA` тоже не нужен: версию для `/health.version` контейнер берет на старте из `RAILWAY_GIT_COMMIT_SHA` (`apps/api/docker-entrypoint.sh`), в виде `sha-` и первых 7 символов.

6. Deploy. В логах: `api: prisma migrate deploy`, список миграций, `Nest application successfully started`. Healthcheck в Deployments становится зеленым.

### Почему `TRUST_PROXY_HOPS=1`

Лимит на вход считается по IP клиента. API берет адрес из `X-Forwarded-For` через `trust proxy` Express, а число задает, скольким прокси перед API можно верить. Цепочка на Railway: браузер → edge-прокси Railway → nginx контейнера `web` → api. Edge-прокси пишет `X-Forwarded-For: <клиент>` и стирает заголовок, присланный клиентом (так ответила поддержка Railway). nginx (`apps/web/nginx.conf.template`) модулем realip берет из этого заголовка крайний левый адрес, записанный прокси, делает его `$remote_addr` и отправляет в api заголовок `X-Forwarded-For` из одного этого адреса. `$proxy_add_x_forwarded_for` не используется, потому что он дописывал бы цепочку. В итоге API всегда видит один прокси (nginx) и один адрес за ним, отсюда `1`. Так же устроено в compose-проде за Caddy и на демо-стенде. Проверка: в логах `web` первый столбец содержит адрес клиента, адреса вида `fd12:…` или `10.…` там означают ошибку.

## Шаг 3. web

1. + New → GitHub Repo → `Dunenbetov/remark-round`, имя сервиса `web`. Deploy не нажимать до пункта 4.
2. Settings → Source: Branch `main`, Root Directory `/`. Settings → Deploy: Healthcheck Path `/`, Restart Policy `On Failure`, Replicas `1`.
3. Variables у `web`:

   | Переменная | Значение | Зачем |
   |---|---|---|
   | `RAILWAY_DOCKERFILE_PATH` | `apps/web/Dockerfile` | Dockerfile лежит не в корне |
   | `PORT` | `80` | nginx слушает 80, на этот порт Railway направляет трафик домена и healthcheck |
   | `API_UPSTREAM` | `${{api.RAILWAY_PRIVATE_DOMAIN}}:3000` | куда проксировать `/api/*` и `/api/v1/ws` (= `api.railway.internal:3000`, литерал тоже подойдет) |
   | `REAL_IP_FROM` | `0.0.0.0/0 ::/0` | каким адресам верить в `X-Forwarded-For`. Контейнер доступен только через edge-прокси Railway, который стирает заголовок клиента, поэтому доверие всем адресам безопасно. Без этой переменной `$remote_addr` был бы адресом прокси, все пользователи попадали бы в один bucket лимита входа и получали 429 одновременно |
   | `DNS_RESOLVER` | не задавать | nginx берет nameserver из `/etc/resolv.conf` контейнера (скрипт `apps/web/docker-entrypoint.d/16-rr-proxy-env.envsh`). Если в логах `web` есть `api.railway.internal could not be resolved`, задать `[fd12::10]` со скобками. Этот адрес резолвера приватной сети известен из сообщества Railway, в документации его нет |

   `GIT_SHA` не нужен и здесь: `/version.txt` на старте заполняется из `RAILWAY_GIT_COMMIT_SHA` (тот же скрипт `16-rr-proxy-env.envsh`).

   nginx обращается к api по имени через `resolver`, потому что Railway выдает контейнеру новый приватный адрес на каждый деплой, а имя в `proxy_pass` nginx разрешает один раз и держит старый адрес до своего рестарта. Адрес перечитывается каждые 10 с, поэтому сразу после деплоя `api` до 10 с возможны ответы 502. Окружения, созданные после 16 октября 2025, в приватной сети двухстековые (IPv4 и IPv6), более старые работают только по IPv6. nginx слушает и `[::]:80`, api по умолчанию слушает `::`.
4. Deploy, затем Settings → Networking → Public Networking → Generate Domain, порт `80`. Railway выдает адрес вида `web-production-xxxx.up.railway.app`, у прода это `remark-round.up.railway.app`. Свой домен подключается там же через Custom Domain (CNAME по подсказке Railway); после смены домена нужно обновить `WEB_ORIGIN` у `api`. Почты нет (ADR 013), поэтому для беты хватает домена `up.railway.app`.
5. В `api` → Variables задать `WEB_ORIGIN` = `https://<домен из п. 4>` (без `/` в конце). Railway сам передеплоит `api`. Без этого браузер получает ошибку CORS на любой запрос.

## Шаг 4. Первый деплой и проверки

В терминале, с доменом прода вместо примера:

```bash
D=https://web-production-xxxx.up.railway.app
curl -s $D/api/v1/health
# {"ok":true,"db":"ok","version":"<sha или dev>","llm":"openai","vectorIndex":"ok","jobs":{"queued":0,"running":0},"tracing":"off","sentry":"off"}
curl -s $D/api/v1/auth/options
# {"demoLogins":false,"registration":"open",...}: демо-персон нет, seed не запускался
curl -s $D/version.txt                       # sha сборки фронта или dev
curl -sI $D/ | grep -i content-security     # CSP на месте
```

Поля `/health` (`apps/api/src/health/health.controller.ts`):

| Поле | Значения |
|---|---|
| `db` | `ok`: база ответила за 2 с. Иначе ответ 503 и `down` |
| `vectorIndex` | `ok`: расширение `vector` и HNSW-индекс на месте, то есть pgvector в базе есть (проверка шага 1). `missing`: индекс не создан. `unknown`: проверить не удалось |
| `llm` | `openai`: ключ модели задан, граф работает с моделью. `rules`: режим правил |
| `jobs` | очередь задач: `queued` и `running` |
| `sentry` | `off` до подключения Sentry (шаг 8) |
| `tracing` | `off` до подключения Langfuse. `on`: span'ы идут в процессор Langfuse. `degraded`: ключи заданы, но span'ы не доедут (проверка трейсов в шаге 8) |

Дальше как в `docs/PROD.md`: администратор из `ADMIN_EMAILS` регистрируется на `$D/register`, в меню аккаунта → Администрирование → "Пригласить руководителя приемки" получает ссылку `/join/<token>` и отправляет ее сам (ссылка живет 7 дней). Руководитель создает проект и приглашает участников.

Если `api` не поднялся, причина в Deployments → Build Logs / Deploy Logs. Частые ошибки:

- `Конфигурация API не прошла проверку`: в сообщении перечислены переменные, их исправляют в Variables, и Railway передеплоит сервис.
- `P1001 Can't reach database`: сервис базы назван не `postgres` или в `DATABASE_URL` опечатка.
- `EACCES` при записи в `storage`: не задан `RAILWAY_RUN_UID=0`.

## Шаг 5. Wait for CI, ветка `main`, watch paths

Изменения настроек сервиса, включая переключатель Wait for CI, сначала попадают в staged changes и применяются кнопкой Deploy в шапке проекта. Без нее настройка не действует и пропадает при следующем деплое. Если настройка применилась, новый деплой после push стоит в статусе `WAITING`, пока GitHub не закончит workflow `ci`.

1. Wait for CI у `api` и `web`: Settings → Source, блок Check Suites, переключатель Wait for CI. При первом включении Railway просит принять обновленные разрешения своего GitHub-приложения. После push в `main` деплой ждет в статусе `WAITING`, пока не завершатся все workflow GitHub Actions на этом коммите. Если `ci` красный, деплой пропускается и на проде остается прежняя версия. `ci.yml` запускается на любой push (`on: push`). Railway ждет весь workflow, включая job `images` (публикация образов в GHCR для compose-варианта), это добавляет к деплою около 10 минут. Если workflow не завершился за два часа, деплой пропускается.
2. Ветка: Settings → Source → Branch `main` у обоих сервисов (задана в шагах 2-3). Push в `dev` Railway не трогает.
3. Watch Paths (Settings → Build → Watch Paths): коммит только в `docs/` не пересобирает образы. По строке на шаблон, синтаксис как в `.gitignore`, пути от корня репозитория.

   `api`:
   ```
   /apps/api/**
   /packages/db/**
   /skills/**
   /fixtures/**
   /pnpm-lock.yaml
   /package.json
   /pnpm-workspace.yaml
   /.npmrc
   ```
   `web`:
   ```
   /apps/web/**
   /pnpm-lock.yaml
   /package.json
   /pnpm-workspace.yaml
   /.npmrc
   ```
   Коммит без изменений в этих путях дает в Deployments пропущенный деплой с пометкой про watch paths. Принудительный деплой: ⌘K → Deploy Latest Commit.

   На проде watch paths применены 18.09 без передеплоя. `railway environment edit --service-config api build.watchPatterns '[…]'` в CLI 5.57.9 отвечает "No changes to apply" на любой путь, включая `deploy.healthcheckTimeout`, поэтому они заданы через GraphQL: `railway api` → `environmentStageChanges(environmentId, input: {services: {<id>: {build: {watchPatterns: […]}}}}, merge: true)` → `environmentPatchCommitStaged(environmentId, skipDeploys: true)`. Проверка: `railway environment config --json` (поле `services.<id>.build.watchPatterns`) или `railway config pull --json`. Те же пути записаны в `build.watchPatterns` в `.railway/railway.ts`. `railway config apply` для этого не запускать: план показывает и другие расхождения (переменные, `checkSuites`).

`railway.json` в репозитории нет: новые сервисы Railway его не читают, а старые файлы перестают работать 2026-12-01. Описание тех же трех сервисов лежит в `.railway/railway.ts` (Infrastructure as Code). Push его не применяет, применение идет из Railway CLI (`railway config plan` → `railway config apply`, нужен CLI новее 4.58). Все настройки выше сделаны вручную, `.railway/railway.ts` служит справкой.

## Шаг 6. Обновления и откат

- Обновление: push (merge) в `main`. Дальше по порядку: CI → образ → миграции при старте нового контейнера `api` → healthcheck → переключение. После обновления `curl $D/api/v1/health` показывает новую `version`.
- Сервисы с томом переключаются с паузой в десятки секунд: Railway не дает двум деплоям держать один том, поэтому старый `api` останавливается до старта нового. У `web` тома нет, он переключается без паузы.
- Откат кода: Deployments → прежний успешный деплой → меню ⋯ → Rollback. Сборки нет, это около минуты.
- Миграции только вперед (`docs/adr/008-release-and-ownership.md`). Если новый `api` упал на `prisma migrate deploy`:
  1. Найти текст ошибки Prisma в Deploy Logs.
  2. Сделать Rollback на прежний деплой. Прежний код работает с прежней схемой: упавшая миграция откатилась вместе с транзакцией. Prisma применяет каждую миграцию в транзакции, кроме миграций с `CREATE INDEX CONCURRENTLY`, а таких в проекте нет.
  3. Исправить миграцию в `dev`, прогнать локально на копии данных, влить в `main`.

  Перед push миграции, которая удаляет или переписывает данные, снять копию базы: `./scripts/prod-db-dump.sh` (раздел "Копия базы").
- Любое изменение в Variables передеплоит сервис без пересборки образа.

## Шаг 7. Стоимость

Тарифы Railway (`docs.railway.com/reference/pricing/plans`): Hobby 5 $/мес, в него включены ресурсы на 5 $. Сверх этого память стоит 10 $/ГБ·мес, CPU 20 $/vCPU·мес, тома 0,15 $/ГБ·мес, все поминутно по фактическому потреблению. Оценка для беты без нагрузки: `api` ≈ 0,4-0,8 ГБ (5-8 $), `postgres` ≈ 0,2-0,3 ГБ (2-3 $), `web` ≈ 0,02 ГБ, тома 2×2 ГБ ≈ 0,6 $. Итого 10-15 $/мес, из них 5 $ покрывает план. Пики дают прогоны графа и pixel-diff (минуты CPU); сборка образов как сервис не тарифицируется. Жесткий лимит из шага 0 ограничивает счет сверху, расход виден в Workspace → Usage.

Том на Hobby по умолчанию до 5 ГБ, размер можно увеличить. Порог свободного места и квоту проекта задают `STORAGE_MIN_FREE_MB` и `STORAGE_QUOTA_MB_PER_PROJECT`.

## Шаг 8. Langfuse Cloud и Sentry

На проде оба подключены 18.09.

### Langfuse Cloud

В Variables `api`: `LANGFUSE_BASE_URL=https://cloud.langfuse.com` (регион EU; для US `https://us.cloud.langfuse.com`), `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PROJECT_ID` (из адресной строки `/project/<id>`), `LANGFUSE_TRACING_ENVIRONMENT=production`, `LANGFUSE_PUBLIC_URL=https://cloud.langfuse.com`, а `LANGFUSE_TRACING_ENABLED=false` заменить на `true`. В compose адрес задается переменной `LANGFUSE_CLOUD_URL`, и compose передает его в API как `LANGFUSE_BASE_URL`. На Railway сразу задается `LANGFUSE_BASE_URL`.

Проверка, что трейсы доходят до Cloud:

1. `/health` → `tracing: on`. При `degraded` ключи заданы, но SDK Langfuse пишет не в наш провайдер, и span'ы не уйдут; причина в Deploy Logs, строка `langfuse: …` или `otel: …`. Статус `on` не гарантирует, что Cloud принял span'ы: при неверном ключе или регионе `/health` показывает `on`, а в логах появляется `otel: … OTLPExporterError: Unauthorized`.
2. Разобрать одно замечание, войти как PM и нажать на карточке "Трейс в Langfuse". Трейс появляется через 2-5 с, батч уходит раз в 2 с. В трейсе: корень `triage`, ноды графа (`retrieve_docs`, `classify_evidence`, `draft_rationale`, …), generation с токенами и стоимостью, `environment = production`. После решения PM в том же трейсе появляется `triage.resume`.
3. В Deploy Logs нет строк `otel:`.

До 18.09 `/health` показывал `on`, а в Cloud не пришло ни одного span'а: `Sentry.init` занимал глобальный провайдер OpenTelemetry. Исправлено в `09cf64e`, теперь у Langfuse свой провайдер (тест `observability-sentry.spec.ts`).

### Sentry

В Variables `api`: `SENTRY_DSN` (api), `SENTRY_DSN_WEB` (SPA, публичный DSN), `SENTRY_ENVIRONMENT=production`. Проверка: `/health` → `sentry: on`.

В Variables `web`: `CSP_CONNECT_SRC=https://*.ingest.de.sentry.io` (регион EU; для US `https://*.ingest.us.sentry.io`). У SPA строгий CSP `connect-src 'self'`, и без этого адреса браузер молча блокирует отправку ошибок фронта. Проверка: адрес ingest виден в заголовке `Content-Security-Policy` главной страницы.

## MCP (по желанию)

Фасад для Cursor и Claude Desktop (`apps/mcp`, ADR 003) на Railway не поднят. Он нужен тем, кто работает с замечаниями из редактора, остальной продукт от него не зависит. Если понадобится: + New → GitHub Repo, имя `mcp`, Root Directory `/`, Variables: `RAILWAY_DOCKERFILE_PATH=apps/mcp/Dockerfile`, `PORT=3002`, `MCP_PORT=3002`, `MCP_TRANSPORT=http`, `REMARKROUND_API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3000/api/v1`; Healthcheck Path `/health`; публичный домен (Generate Domain, порт 3002). Клиент подключается к `https://<домен mcp>/mcp` с заголовком `Authorization: Bearer <токен из POST /projects/:id/mcp-token>`. Токен проверяет API на каждом вызове, поэтому публичный адрес допустим.

## Известные ограничения

- Один экземпляр `api`: Replicas больше 1 не ставить, с томом Railway этого и не позволит.
- Деплой `api` (сервис с томом) дает паузу в десятки секунд. Прогон графа в этот момент возвращается в очередь и продолжается на новом контейнере (задачи с протухшим `lockedAt` на старте возвращаются в `queued`).
- Файлы из тома `api` (кадры, документы) не копируются: `scripts/prod-db-dump.sh` снимает только базу (раздел "Копия базы").
- `mcp` не поднят.
- Домен `*.up.railway.app`. Писем нет (ADR 013), поэтому репутация почтового домена не нужна.
- Имена `*.railway.internal` резолвятся только внутри окружения; после деплоя `api` nginx до 10 с может отдавать 502.
- Watch Paths сверяются только с файлами конкретного push. Если push с изменениями в `apps/web` попал на красный CI и был пропущен, то и следующий зеленый push без файлов из `apps/web` не пересоберет `web`. Версию фронта показывает `/version.txt`, отставший `web` пересобирает ⌘K → Deploy Latest Commit.
- Healthcheck Railway приходит с `Host: healthcheck.railway.app`. nginx и api его принимают: `server` в nginx один и хост не проверяет.

## Копия базы

Встроенные бэкапы Railway доступны только на Pro, поэтому копию базы снимает скрипт [`scripts/prod-db-dump.sh`](../scripts/prod-db-dump.sh): `railway ssh` в `postgres` → `pg_dump -Fc` → `~/RemarkRound-backups/`, хранятся 8 последних копий. Папку и число копий меняют `RR_BACKUP_DIR` и `RR_BACKUP_KEEP`. Дампы лежат вне репозитория: в них персональные данные и тексты замечаний. Скрипт запускается раз в неделю и вручную перед каждым merge с миграцией:

```bash
./scripts/prod-db-dump.sh
```

Один раз нужны SSH-ключ в Railway (`railway ssh keys add`) и подтвержденный отпечаток сервера (`railway ssh --service postgres -- echo ok`, ответить `yes`). Восстановление проверено 18.09: дамп разворачивается во временный `pgvector/pgvector:pg17` через `pg_restore --no-owner --no-acl` со всеми миграциями, HNSW-индексом и триггерами append-only.
