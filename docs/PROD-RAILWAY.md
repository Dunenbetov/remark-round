# Прод на Railway — runbook

Задача A2 из `docs/BETA-REVIEW.md` (17 сентября 2026). Второй вариант прода рядом с одним сервером (`docs/PROD.md`): те же образы (`apps/api/Dockerfile`, `apps/web/Dockerfile`), те же миграции, контур доступа (ADR 006) и `/health`; различаются запуск и хранение файлов. Написано для владельца без devops-опыта: у каждого шага — что делаем и зачем; имена переменных и пунктов меню — точные, всё, что в Railway пришлось проверять по документации, а не в живом UI, помечено «проверить в UI».

Проверено по docs.railway.com на 17.09.2026: приватная сеть, healthcheck, тома, «Wait for CI», лимиты расходов, статус config-as-code.

## Что получится

```
браузер ──https──▶ edge-прокси Railway ──▶ web (nginx, публичный домен)
                                              │  /api/*, /api/v1/ws  → приватная сеть Railway
                                              ▼
                                            api (Nest, порт 3000, том /app/apps/api/storage — кадры и документы)
                                              │  DATABASE_URL по приватной сети
                                              ▼
                                            postgres (pgvector/pgvector:pg17, том /var/lib/postgresql/data)
```

- Один проект Railway, окружение `production`, три сервиса из репозитория GitHub `Dunenbetov/remark-round`, ветка `main`; `mcp` — по желанию (см. «MCP»).
- Деплой запускает push в `main`, но только после зелёного workflow `ci` (`.github/workflows/ci.yml`) — настройка «Wait for CI» (шаг 5).
- Между сервисами — приватная сеть Railway: имена `<сервис>.railway.internal`, наружу смотрит только `web`.
- Два тома: у `api` (файлы) и у `postgres` (база). Резервные копии — снимки томов Railway (шаг 8).

Чего здесь нет по сравнению с `docs/PROD.md`: Caddy (TLS даёт Railway), сервисов `backup`/`offsite` (вместо них снимки томов), лимитов памяти compose (Railway считает деньги за фактическое потребление — см. «Стоимость»).

## Ветки

- `main` → Railway. Туда попадает только то, что прошло CI; никаких переменных и секретов в коде — всё в **Variables** сервисов Railway.
- `dev` → локальный стенд `docker compose up` (`docker-compose.yml`) — как раньше. Ничего из `dev` на Railway не едет, пока не влито в `main`.
- `.env` на Railway не используется. `.env.example` в конце содержит блок «Railway» — это шпаргалка, какие переменные к какому сервису.

## Шаг 0. Подготовка

1. **Аккаунт Railway, план Hobby** (5 $/мес, в него включены 5 $ ресурсов). Зачем Hobby: на Free/Trial нет постоянных сервисов с томами.
2. **GitHub подключён к Railway.** В Railway: аватар → **Account Settings → Integrations → GitHub** (или при первом «+ New → GitHub Repo» Railway сам попросит установить своё GitHub-приложение). Дайте доступ к репозиторию `Dunenbetov/remark-round`. Зачем: без этого Railway не увидит ветку `main` и не сможет ждать CI.
3. **Потолок расходов.** Аватар → **Workspace → Usage** (или **Settings → Usage**) → кнопка **Set Usage Limits** → в окне два поля: **Custom email alert** (письмо при достижении, например 15 $) и **Hard limit** (жёсткий потолок, минимум 10 $ — рекомендуем **25 $**). Зачем: при достижении жёсткого потолка Railway останавливает *все* сервисы и не берёт денег сверх него; вернуть их — поднять или снять лимит, Railway сам всё перезапустит. Ожидаемый счёт — 10–15 $ в месяц (шаг 7), так что 25 $ — запас на пик, а не на утечку.
4. Локально сгенерируйте секреты (терминал на Mac): `openssl rand -hex 32` — для `JWT_SECRET`; `openssl rand -hex 16` — для пароля Postgres. Сохраните в менеджере паролей, не в репозитории.
5. Держите под рукой `OPENAI_API_KEY` и решение из `REMARKROUND.md` §12 (тексты замечаний и кадры уходят во внешнюю модель).

> Railway **копит изменения настроек как staged changes** и применяет их кнопкой **Deploy** вверху канвы. Сервис из GitHub может начать деплоиться сразу после создания — до того, как вы ввели переменные. Это не страшно (первый деплой упадёт на проверке конфига API и будет переделан), но проще: создать сервис, **не нажимать Deploy**, заполнить Variables и Settings, и только потом Deploy.

## Шаг 1. Проект и Postgres

1. **New Project → Empty Project.** Название — `remark-round`. Окружение по умолчанию называется `production` — оставить.
2. **Postgres с pgvector.** Миграция `packages/db/prisma/migrations/20250820120000_init/migration.sql` делает `CREATE EXTENSION IF NOT EXISTS "vector"`. Официальный шаблон Postgres Railway (`ghcr.io/railwayapp-templates/postgres-ssl`) расширений **не содержит** — в документации прямо: «Extensions that aren't available need to be deployed from templates, since they require additional features in the database's image, like pgvector». Поэтому:
   - **Основной путь — Docker-образ, тот же, что в compose.** На канве **+ New → Docker Image**, образ `pgvector/pgvector:pg17`. Имя сервиса — **`postgres`** (от имени зависит адрес в приватной сети и ссылки на переменные ниже).
   - **Запасной путь — шаблон сообщества** `railway.com/deploy/3jJFCA` («pgvector», образ `pgvector/pgvector:pg18`, поддерживает Brody, не Railway). Даёт готовый `DATABASE_URL`, но версия Postgres 18, а не 17, как в compose и CI. Берите, только если образ по какой-то причине не поднимается.
3. **Variables у `postgres`** (вкладка **Variables** сервиса → **New Variable**; можно **Raw Editor** и вставить строками `KEY=value`):

   | Переменная | Значение | Зачем |
   |---|---|---|
   | `POSTGRES_USER` | `remarkround` | как в compose — `DATABASE_URL` ниже собран под это имя |
   | `POSTGRES_PASSWORD` | из `openssl rand -hex 16` | пароль создаётся при **первом** старте; потом менять только `ALTER USER` |
   | `POSTGRES_DB` | `remarkround` | имя базы |
   | `PGDATA` | `/var/lib/postgresql/data/pgdata` | в корне тома Railway лежит `lost+found`, а `initdb` отказывается от непустого каталога — данные кладём в подкаталог |

4. **Том.** Правый клик по канве (или ⌘K) → **Add Volume** (в старом UI: **Volume**) → выбрать сервис `postgres` → **Mount Path** `/var/lib/postgresql/data`. Зачем: без тома база стирается при каждом деплое. У Hobby том по умолчанию до 5 ГБ (расширяется из настроек тома, **Volume Size**).
5. Необязательно, как в compose-проде: **Settings → Deploy → Custom Start Command** `postgres -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all` — тогда работает `pg_stat_statements` («какие запросы едят базу», `docs/PROD.md`). Без него миграция `20260907130000_pg_role_settings` всё равно проходит (расширение создаётся, просто не собирает статистику).
6. **Deploy.** В **Deployments** → логи: `database system is ready to accept connections`. Публичный доступ (**Settings → Networking → TCP Proxy**) **не включать**: база нужна только `api` по приватной сети.

Как `api` узнает адрес базы: не копируйте пароль во второй сервис — используйте **ссылки на переменные** Railway `${{postgres.ИМЯ}}` (подстановка при деплое; при смене пароля поменяется в одном месте). Хост — `${{postgres.RAILWAY_PRIVATE_DOMAIN}}` (= `postgres.railway.internal`), а не публичный TCP-прокси: трафик по приватной сети не считается и не выходит наружу.

## Шаг 2. api

1. **+ New → GitHub Repo → `Dunenbetov/remark-round`.** Имя сервиса — **`api`** (от него зависит `api.railway.internal` для `web`). Не нажимать Deploy, пока не заполнены пункты 2–5.
2. **Settings → Source:** **Branch** `main`; **Root Directory** оставить `/` (корень). Зачем корень: `apps/api/Dockerfile` копирует `packages/db`, `skills`, `fixtures/*` — контекст сборки должен быть весь репозиторий. Путь к Dockerfile Railway берёт из переменной `RAILWAY_DOCKERFILE_PATH` (ниже); если в **Settings → Build** есть поле **Dockerfile Path** — можно задать и там, значение то же (проверить в UI).
3. **Settings → Deploy:** **Healthcheck Path** `/api/v1/health`; **Healthcheck Timeout** `300` (секунд — это дефолт Railway; первый старт прогоняет все миграции, это может занять минуту); **Restart Policy** `On Failure`, **Max Retries** `10`; **Replicas** `1` — **никогда больше**: семафоры графа и присутствие в комнате WebSocket живут в памяти процесса (R-M1 в `docs/BETA-REVIEW.md`), второй инстанс их не увидит, а том всё равно можно примонтировать только к одному.
4. **Том:** правый клик по канве → **Add Volume** → сервис `api` → **Mount Path** `/app/apps/api/storage`. Это каталог кадров, документов и дифф-картинок (`STORAGE_DIR`); в compose-проде это том `api-storage`.
5. **Variables у `api`** (Raw Editor, по строке `KEY=value`; ссылки `${{…}}` вставлять как есть):

   | Переменная | Значение | Зачем |
   |---|---|---|
   | `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` | Dockerfile не в корне репозитория |
   | `RAILWAY_RUN_UID` | `0` | том Railway монтируется от `root`, а образ работает от пользователя `node` — без этого запись кадров упадёт с `EACCES` (так рекомендует документация Railway по томам) |
   | `PORT` | `3000` | Railway сам подставляет `PORT`, но мы фиксируем: `web` проксирует на `api.railway.internal:3000` |
   | `DATABASE_URL` | `postgresql://remarkround:${{postgres.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/remarkround?connection_limit=25&pool_timeout=20` | база по приватной сети; пул 25 и ожидание 20 с — как в compose-проде (R-H1) |
   | `JWT_SECRET` | `openssl rand -hex 32` | подпись токенов; в `production` короче 32 символов API не стартует |
   | `JWT_EXPIRES_SECONDS` | `86400` | сессия сутки (как прод-оверлей) |
   | `WEB_ORIGIN` | `https://<домен web>` | CORS и ссылки; домен появится на шаге 3 — пока поставьте `https://example.com`, потом замените |
   | `ADMIN_EMAILS` | `you@company.kz` | администраторы инстанса (ADR 006): регистрируются первыми, приглашают руководителя приёмки |
   | `REGISTRATION_MODE` | `open` | решение владельца 17.09 (ADR 006, дополнение): на бете регистрация открыта всем; без переменной в production — `invite_only` (только по ссылке приглашения). Право создавать проекты всё равно выдаёт администратор |
   | `OPENAI_API_KEY` | ключ | без него API в `production` не стартует (или явно `LLM_MODE=rules` — черновики правилами, грубее) |
   | `STORAGE_DIR` | `/app/apps/api/storage` | = Mount Path тома |
   | `STORAGE_MIN_FREE_MB` | `512` | порог «кончается место» (R-H4); дефолт 2048 на томе 5 ГБ отказал бы слишком рано |
   | `STORAGE_QUOTA_MB_PER_PROJECT` | `1024` | квота файлов на проект — чтобы один импорт кадров не занял весь том |
   | `MIGRATE_ON_START` | `true` | миграции при каждом старте контейнера (`apps/api/docker-entrypoint.sh`). На одном сервере compose это `false` и отдельный шаг `run api migrate`, потому что там есть куда его запустить; на Railway отдельного шага нет, а инстанс один — гонки миграций быть не может, режим правильный |
   | `SEED_ON_START` | `false` | демо-данных в проде нет (в образе и так `false`, ставим явно) |
   | `TRUST_PROXY_HOPS` | `1` | см. «Почему 1» ниже |
   | `IMPORT_MAX_ROWS` / `IMPORT_MAX_BYTES` | `100` / `5242880` | бета-лимит импорта журнала (R-H3), как в compose-проде |
   | `LANGFUSE_TRACING_ENABLED` | `false` | первый запуск без трейсов. Langfuse Cloud и Sentry подключаются потом («Что дальше») — и это осознанно: сначала убедиться, что приложение живёт |
   | `GIT_SHA` | `${{RAILWAY_GIT_COMMIT_SHA}}` | необязательно: версия сборки в `/health.version` вместо `dev` (Dockerfile принимает `ARG GIT_SHA`, Railway отдаёт переменные сборке). Если в `/health` всё равно `dev` — переменная не подставилась, можно убрать |
   | `NODE_OPTIONS` | `--max-old-space-size=1536` | необязательно: потолок кучи Node, чтобы утечка не превратилась в счёт за гигабайты (Railway тарифицирует фактическую память) |

   **Не задавать:** `NODE_ENV` (в образе уже `production`), `DEMO_LOGINS` (в production и так `false`), `REGISTRATION_DOMAINS` (нужна только в `invite_only`: `company.kz` пустит сотрудников домена без ссылки — на открытой бете не требуется), `LANGFUSE_*` кроме `LANGFUSE_TRACING_ENABLED`, `SENTRY_*`.

6. **Deploy.** Логи: `api: prisma migrate deploy` → список миграций → `Nest application successfully started`. Healthcheck в **Deployments** станет зелёным.

**Почему `TRUST_PROXY_HOPS=1`.** Лимит на вход считается по IP клиента (R-H5), и API берёт его из `X-Forwarded-For` через `trust proxy` Express: число — сколько прокси перед API можно верить. Цепочка на Railway: браузер → edge-прокси Railway (пишет `X-Forwarded-For: <клиент>` и **стирает** то, что прислал клиент — так ответила поддержка Railway; при CDN может дописать в конец свой адрес) → nginx контейнера `web` → api. nginx (`apps/web/nginx.conf.template`) модулем realip берёт из этого заголовка крайний левый адрес — он записан прокси, а не клиентом, — делает его `$remote_addr` и отправляет в api заголовок `X-Forwarded-For` **из одного этого адреса** (не `$proxy_add_x_forwarded_for`, который дописывал бы цепочку). Значит, API всегда видит ровно один прокси (nginx) и один адрес за ним — `1`, одинаково на Railway, в compose-проде за Caddy и на демо-стенде. Проверка: в логах `web` первый столбец — адрес клиента, не `fd12:…`/`10.…`.

## Шаг 3. web

1. **+ New → GitHub Repo → `Dunenbetov/remark-round`**, имя сервиса — **`web`**. Не нажимать Deploy до пункта 4.
2. **Settings → Source:** Branch `main`, Root Directory `/`. **Settings → Deploy:** Healthcheck Path `/`, Restart Policy `On Failure`, Replicas `1` (можно и больше — nginx без состояния, но незачем).
3. **Variables у `web`:**

   | Переменная | Значение | Зачем |
   |---|---|---|
   | `RAILWAY_DOCKERFILE_PATH` | `apps/web/Dockerfile` | Dockerfile не в корне |
   | `PORT` | `80` | nginx слушает 80; на этот порт Railway шлёт трафик домена и healthcheck |
   | `API_UPSTREAM` | `${{api.RAILWAY_PRIVATE_DOMAIN}}:3000` | куда проксировать `/api/*` и `/api/v1/ws` (= `api.railway.internal:3000`; литерал тоже подойдёт) |
   | `REAL_IP_FROM` | `0.0.0.0/0 ::/0` | каким адресам верить `X-Forwarded-For`. Контейнер достижим **только** через edge-прокси Railway, а тот стирает заголовок клиента — поэтому «верить всем» безопасно. Без этого `$remote_addr` был бы адресом прокси, все пользователи делили бы один bucket лимита входа и получали 429 разом — ровно баг R-H5 |
   | `DNS_RESOLVER` | **не задавать** | nginx берёт nameserver из `/etc/resolv.conf` контейнера (скрипт `apps/web/docker-entrypoint.d/16-rr-proxy-env.envsh`). Только если в логах `web` есть `api.railway.internal could not be resolved` — задать `[fd12::10]` (адрес резолвера приватной сети Railway по опыту сообщества, в документации не зафиксирован; со скобками) |
   | `GIT_SHA` | `${{RAILWAY_GIT_COMMIT_SHA}}` | необязательно: `/version.txt` |

   Почему nginx ходит к api по имени через `resolver`, а не как раньше: Railway выдаёт контейнеру новый приватный адрес на каждый деплой, и nginx с именем в `proxy_pass` запомнил бы старый до своего рестарта. Теперь адрес перечитывается каждые 10 с; после деплоя `api` возможны ~10 с ошибок 502 — это ожидаемо. Окружения, созданные после 16 октября 2025, в приватной сети двухстековые (IPv4 + IPv6), старые — только IPv6; конфиг слушает и `[::]:80`, а api по умолчанию слушает `::`.
4. **Deploy.** Затем **Settings → Networking → Public Networking → Generate Domain**; в диалоге порт — `80`. Получите адрес вида `web-production-xxxx.up.railway.app`. Свой домен — там же **Custom Domain** (CNAME по подсказке Railway); почты нет (ADR 013), так что домен `up.railway.app` для беты годится.
5. **Вернуться в `api` → Variables → `WEB_ORIGIN`** = `https://<домен из п. 4>` (без завершающего `/`). Railway передеплоит `api` сам. Без этого браузер получит ошибку CORS на любой запрос.

## Шаг 4. Первый деплой и проверки

В терминале (замените домен):

```bash
D=https://web-production-xxxx.up.railway.app
curl -s $D/api/v1/health
# {"ok":true,"db":"ok","version":"<sha или dev>","llm":"openai","vectorIndex":"ok","jobs":{"queued":0,"running":0},"tracing":"off","sentry":"off"}
curl -s $D/api/v1/auth/options
# {"demoLogins":false,"registration":"invite_only",...}  — демо-персон нет, seed не шёл
curl -s $D/version.txt                       # sha сборки фронта или dev
curl -sI $D/ | grep -i content-security     # CSP на месте
```

Что значит каждое поле `/health` (`apps/api/src/health/health.controller.ts`): `db: ok` — база отвечает за 2 с (иначе 503 и `db: down`); `vectorIndex: ok` — расширение `vector` и HNSW-индекс на месте, то есть **pgvector в базе есть** (это и есть проверка шага 1; `missing` — индекс не создан, `unknown` — не удалось проверить); `llm: openai` — ключ модели принят; `jobs` — очередь; `tracing`/`sentry` — `off` до подключения.

Дальше — как в `docs/PROD.md`: администратор из `ADMIN_EMAILS` регистрируется на `$D/register` (только ему регистрация открыта без ссылки), в меню аккаунта → **Администрирование** → «Пригласить руководителя приёмки» — ссылка `/join/<token>`, которую он отправляет сам (живёт 7 дней); руководитель создаёт проект и приглашает участников.

Если `api` не поднялся: **Deployments → Build Logs / Deploy Logs**. Частое: `Конфигурация API не прошла проверку` (перечислит переменные — поправить в Variables, Railway передеплоит), `P1001 Can't reach database` (имя сервиса не `postgres` или `DATABASE_URL` с опечаткой), `EACCES` при записи в `storage` (нет `RAILWAY_RUN_UID=0`).

## Шаг 5. «Wait for CI», ветка `main`, watch paths

> **Важно про Settings в Railway:** любое изменение настроек сервиса (в том числе переключатель «Wait for CI») сначала попадает в черновик (staged changes) и применяется только кнопкой **Deploy** в шапке проекта. Без неё настройка не действует и «слетает» при следующем деплое. Признак, что всё сработало: новый деплой после push стоит в состоянии `WAITING`, пока GitHub не закончит workflow `ci`.

1. **Wait for CI** — у `api` и у `web`: **Settings → Source** (рядом с веткой; в документации блок называется **Check Suites**, переключатель — **Wait for CI**; проверить в UI). При первом включении Railway попросит принять обновлённые разрешения своего GitHub-приложения — принять. Что это даёт: после push в `main` деплой висит в статусе `WAITING`, пока не завершатся все workflow GitHub Actions на этом коммите; **красный `ci` = деплой пропущен, на проде остаётся прежняя версия**. Наш `ci.yml` запускается на любой push (`on: push`), это подходит. Учтите: Railway ждёт весь workflow, включая job `images` (публикация в GHCR для compose-варианта) — плюс ~10 минут к деплою. Если workflow не завершился за два часа — деплой пропускается.
2. **Ветка**: Settings → Source → Branch `main` у обоих сервисов (уже сделано в шагах 2–3). Push в `dev` Railway не трогает.
3. **Watch Paths** — чтобы коммит только в `docs/` не пересобирал образы (**Settings → Build → Watch Paths**, проверить в UI; по строке на шаблон, синтаксис как в `.gitignore`, пути от корня репозитория):

   `api`:
   ```
   /apps/api/**
   /packages/db/**
   /skills/**
   /fixtures/**
   /pnpm-lock.yaml
   /package.json
   /pnpm-workspace.yaml
   ```
   `web`:
   ```
   /apps/web/**
   /pnpm-lock.yaml
   /package.json
   /pnpm-workspace.yaml
   ```
   Если после этого «ничего не деплоится» — в **Deployments** будет пропущенный деплой с пометкой про watch paths; принудительно — ⌘K → **Deploy Latest Commit**.

Почему без `railway.json`: он больше не читается новыми сервисами («New services cannot opt into Config as Code», старые файлы перестают работать 2026-12-01). Замена — `.railway/railway.ts` (Infrastructure as Code): в репозитории лежит описание тех же трёх сервисов, но применяется оно **не на push, а из Railway CLI** (`railway config plan` → `railway config apply`, нужен CLI новее 4.58). Для беты это справочник, а не обязательный шаг; всё выше настраивается руками.

## Шаг 6. Обновления и откат

- **Обновление** = push (merge) в `main`. Порядок сам собой: CI → образ → миграции при старте нового контейнера `api` → healthcheck → переключение. Проверка после: `curl $D/api/v1/health` — `version` сменился.
- **Сервисы с томом переключаются с короткой паузой:** Railway не даёт двум деплоям держать один том, поэтому старый `api` останавливается до старта нового (десятки секунд). `web` без тома — без паузы.
- **Откат кода:** **Deployments** → у прежнего успешного деплоя меню **⋯ → Rollback** (или **Redeploy**; проверить в UI). Минута, сборки нет.
- **Миграции только вперёд** (`docs/adr/008-release-and-ownership.md`). Если новый `api` упал на `prisma migrate deploy`: (1) в **Deploy Logs** — текст ошибки Prisma; (2) **Rollback** на прежний деплой — прежний код работает с прежней схемой, потому что упавшая миграция откатилась транзакцией (Prisma применяет каждую миграцию в транзакции; исключение — миграции с `CREATE INDEX CONCURRENTLY`, у нас таких нет); (3) починить миграцию в `dev`, прогнать локально на копии данных, влить в `main`. Если миграция удаляет или переписывает данные — перед push сделать снимок тома `postgres` (шаг 8).
- **Переменные**: любое изменение в Variables = передеплой сервиса (без пересборки образа).

## Шаг 7. Стоимость

Тарифы Railway (`docs.railway.com/reference/pricing/plans`): Hobby 5 $/мес с включёнными 5 $ ресурсов; сверх — память 10 $/ГБ·мес, CPU 20 $/vCPU·мес, тома 0,15 $/ГБ·мес, всё по минутам фактического потребления. Ориентир для простаивающей беты: `api` ≈ 0,4–0,8 ГБ (5–8 $), `postgres` ≈ 0,2–0,3 ГБ (2–3 $), `web` ≈ 0,02 ГБ, тома 2×2 ГБ ≈ 0,6 $ — **итого 10–15 $/мес**, из них 5 $ покрыты планом. Пики: прогоны графа и pixel-diff (минуты CPU) и сборки образов (билд не тарифицируется как сервис). Жёсткий потолок из шага 0 защищает от сюрпризов; смотреть расход — **Workspace → Usage**.

Тома у Hobby: до 5 ГБ на том по умолчанию (расширяется). Кадры и документы растут — следите за `/health` и `STORAGE_*`.

## Шаг 8. Что дальше

- **Снимки томов (A3, «backups»)**: у сервисов `postgres` и `api` → **Settings → Backups** (вкладка сервиса с томом): расписание **Daily** (хранится 6 дней), **Weekly** (27 дней), **Monthly** (89 дней) — включить Daily у обоих. Восстановление — там же **Restore** у нужной метки времени: Railway создаёт новый том из снимка и переключает сервис, старый том остаётся неподключённым. Снимки инкрементальные, платится только за уникальные данные. Это снимок диска, а не `pg_dump`: при желании логический дамп — `railway ssh` в сервис `postgres` → `pg_dump -U remarkround remarkround | gzip > /tmp/dump.sql.gz` и `railway volume files`/`scp` наружу. Раз в месяц — **репетиция restore** (R-M3), как в `docs/PROD.md`.
- **Uptime-монитор**: UptimeRobot (бесплатно) на `https://<домен>/api/v1/health` каждые 5 минут, ключевое слово `"ok":true`. `/health` без лимита запросов — монитор не выбьет 429.
- **Langfuse Cloud** (решение владельца 17.09, R-B1): в Variables `api` задать `LANGFUSE_BASE_URL=https://cloud.langfuse.com` (регион EU; US — `https://us.cloud.langfuse.com`), `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PROJECT_ID` (из адресной строки `/project/<id>`), `LANGFUSE_TRACING_ENVIRONMENT=production`, `LANGFUSE_PUBLIC_URL=https://cloud.langfuse.com`, и заменить `LANGFUSE_TRACING_ENABLED=false` на `true`. Внимание: в compose переменная называлась `LANGFUSE_CLOUD_URL` — это compose переименовывал её в `LANGFUSE_BASE_URL`; на Railway задаётся сразу `LANGFUSE_BASE_URL`. Проверка: `/health` → `tracing: on`.
- **Sentry** (R-L5): `SENTRY_DSN` (api), `SENTRY_DSN_WEB` (SPA, публичный DSN), `SENTRY_ENVIRONMENT=production` в Variables `api`. Проверка: `/health` → `sentry: on`. В Variables **`web`** — `CSP_CONNECT_SRC=https://*.ingest.de.sentry.io` (регион EU; для US — `https://*.ingest.us.sentry.io`): у SPA строгий CSP `connect-src 'self'`, без этого адреса браузер молча блокирует отправку ошибок фронта. Проверка: в заголовке `Content-Security-Policy` главной страницы виден адрес ingest.
- **Свой домен** для `web` — когда появится; тогда же обновить `WEB_ORIGIN`.

## MCP (по желанию)

Фасад для Cursor / Claude Desktop (`apps/mcp`, ADR 003) **можно не поднимать**: он нужен только тем, кто работает с замечаниями из редактора; продукт без него полон. Если нужен: **+ New → GitHub Repo**, имя `mcp`, Root Directory `/`, Variables: `RAILWAY_DOCKERFILE_PATH=apps/mcp/Dockerfile`, `PORT=3002`, `MCP_PORT=3002`, `MCP_TRANSPORT=http`, `REMARKROUND_API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3000/api/v1`; Healthcheck Path `/health`; публичный домен (**Generate Domain**, порт 3002) — клиент подключается к `https://<домен mcp>/mcp` с заголовком `Authorization: Bearer <токен из POST /projects/:id/mcp-token>`. Токен проверяет API на каждом вызове, поэтому публичный адрес допустим.

## Известные ограничения

- **Один инстанс `api`** — не ставить Replicas > 1 (R-M1); Railway и не даст с томом.
- **Пауза при деплое `api`** (том) — десятки секунд; прогон графа в этот момент вернётся в очередь и продолжится на новом контейнере (задачи с протухшим `lockedAt` возвращаются в `queued` на старте).
- **Бэкапы — снимки томов Railway**, а не `pg_dump` + offsite, как в `docs/PROD.md`; копия вне Railway — вручную (см. шаг 8).
- **Без `mcp` по умолчанию.**
- **Домен `*.up.railway.app`** приемлем: писем нет (ADR 013), репутация домена почты не нужна.
- **Приватная сеть**: имена `*.railway.internal` резолвятся только внутри окружения; после деплоя `api` nginx до 10 с может отдавать 502.
- **Healthcheck Railway приходит с `Host: healthcheck.railway.app`** — nginx и api это устраивает (единственный `server` без проверки хоста).

## Что из этого стоит перепроверить в UI Railway

Документация Railway описывает поведение, но не всегда точные названия пунктов; в тексте выше такие места помечены «проверить в UI»: где именно лежит переключатель **Wait for CI** (Settings → Source, блок Check Suites); **Watch Paths** (Settings → Build); есть ли поле **Dockerfile Path** в Settings → Build (если нет — переменная `RAILWAY_DOCKERFILE_PATH` работает точно); название пункта отката (**Rollback** / **Redeploy**); подставляется ли `${{RAILWAY_GIT_COMMIT_SHA}}` в `GIT_SHA` (если нет — в `/health` останется `dev`, не страшно); адрес резолвера `[fd12::10]` — нужен только если автоопределение из `resolv.conf` не сработало.
