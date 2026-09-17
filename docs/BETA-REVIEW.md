# Ревью перед публичной бетой — 17 сентября 2026

**Для кого:** агенты, которые будут выполнять задачи из этого документа, и владелец.
**Состояние репо на момент ревью:** `main` = `aa604ae` (влит дизайн Arc · Индиго) + `chore(deps)` по dependabot. Ветки `design/arc-indigo`, `feat/web-mock-frontend` удалены, стэш «Корректура» удалён.
**Как проводилось:** четыре независимых аудита по коду (не по документации): отказоустойчивость и нагрузка; мёртвый код и устаревшие документы; приглашения, почта и администратор; демо- и мок-данные. Все ссылки `путь:строка` проверялись на текущем `main`.

**Срок:** бета в прод на этой неделе (до 25 сентября — сдача проекта). Поэтому документ разделён на «до запуска», «первые две недели беты» и «потом». Не пытаться сделать всё: раздел 7 задаёт порядок.

## Ход работ

Решения владельца от 17.09 (раздел 8): Langfuse — **Cloud**; Sentry — **да**, за `SENTRY_DSN`; презентация и старые скриншоты — **в `docs/archive/`**; A-3 и I-7 — как рекомендовано (оставить / нестрого); R-H3 — лимит 100 строк / 5 МБ на бету; лимит модели — 20 $ в сутки на проект.

| Дата | Ключи | Что сделано |
|---|---|---|
| 17.09 | R-B1, R-M6 | Langfuse-стек за профилем `observability` в прод-оверлее (демо без изменений), трейсы — в Langfuse Cloud (`LANGFUSE_CLOUD_URL`), лимиты без профиля 4,3 ГБ (postgres 1,5 / api 2 + `NODE_OPTIONS`), `x-logging` у всех сервисов включая postgres, `/health.tracing`, секреты стека без `:?` (CI-шаг `config -q` был красным из-за них), второй `config -q` с профилем в CI |
| 17.09 | R-B2 | Лимиты вида задач в самом `claim()` очереди (`maxConcurrent`/`maxPerProject` при `register`): насыщенные виды и пары (вид, проект) исключаются в `WHERE`, попытки ждущих не сгорают, задачи без проекта не блокируются (NULL-guard); `graph` — 4/2, `index_document` — 2; `JOBS_CONCURRENCY` 4 → 8; флаг `wake`; 2 теста честности в `jobs.spec` |
| 17.09 | R-B3, R-H1 | Чанки пишутся пачками по 200 в одном `INSERT` внутри транзакции с таймаутом 120 с; общий дефолт интерактивных транзакций `maxWait 10 с / timeout 30 с` в `PrismaService`; пул `connection_limit=25&pool_timeout=20`; P2024/P1001/P1002 и `PrismaClientInitializationError` → 503 `unavailable`; маппинг ошибок вынесен в чистую `errorBody`; тесты: 2 000 разделов индексируются и переиндексируются без дублей, маппинг кодов Prisma |
| 17.09 | R-H2 | Дедлайн прогона `GRAPH_RUN_TIMEOUT_MS` (5 мин, `AbortSignal.timeout` после получения слота) → `failed` с кодом `timeout` без повторов; суточный потолок `GRAPH_DAILY_USD_PER_PROJECT` (20 $, скользящие 24 ч по `SUM(costUsd)`) → `409 llm_budget` на старте разбора/ретеста; учёт токенов `takeUsage` забирается при окончательном сбое и отмене (утечка Map); контракт ошибок пропускает собственный `code` сервиса; `FakeLlm.delayMs`; спека `agent/run-deadline.spec` |
| 17.09 | R-H5 | Ключ лимита — `sub` проверенного JWT (`throttleTracker`, опция `getTracker` ThrottlerModule), анонимы и негодные токены — по IP; `/health` без лимита; `THROTTLE_AUTH_LIMIT` 30 → 120; **найден боевой баг** nginx за Caddy: `$binary_remote_addr` = адрес Caddy, а `location /api/v1/auth/` накрывал `/auth/me` при каждой загрузке SPA — весь инстанс делил один bucket 60 r/m; теперь realip из docker-подсетей, лимит 300 r/m только на `login|register|password|forgot|reset`; спека `auth/throttle.spec` |
| 17.09 | I-1, I-2, I-3, I-4 | Опция `sensitive` у вида задачи: `send_mail` удаляется после отправки, payload обнуляется при окончательном сбое; «Новая ссылка» шлёт письмо и отдаёт `emailed`; зарегистрированному при добавлении — письмо «вы в проекте» (`memberAddedMail`, `emailed` в `{ kind: 'member' }`); accept атомарен (`updateMany acceptedAt: null` → 410 второму); фронт: пометки «письмо ушло»; 2 теста в `members.spec`; ADR 009 дополнен |

---

## 0. Правила для исполнителя

1. **Ядро не переписывать.** Статусная машина (`docs/STATUS.md`), единственный путь записи через `transition` с условным `UPDATE … WHERE status IN (…)`, tenancy-фильтр `projectId` в SQL, HITL-ворота графа, очередь `Job` в Postgres, append-only триггер истории (ADR 011) — это сильные части, их не трогать. Все задачи ниже — обвязка вокруг них.
2. **Одна тема = один коммит** с обновлением доков/ADR и спеками (так велась вся работа по прошлому аудиту, см. `docs/adr/`). Коммит-сообщения на русском, как в истории.
3. **Перед задачей читать** соответствующий ADR (`docs/adr/005…011`) и `docs/PROD.md`. Если задача меняет доктрину (`REMARKROUND.md`) — сначала вопрос владельцу.
4. **Тесты:** `pnpm --filter @remarkround/api test` (нужен Postgres из `docker-compose.yml`; ~190 тестов, ~30 с; гонять 2–3 раза — были флейки под нагрузкой). Проверка типов: `pnpm --filter @remarkround/api exec tsc --noEmit -p tsconfig.json`; фронт: `pnpm --filter @remarkround/web build`. Web-тестов нет — сборка обязательна.
5. Гочи из памяти проекта: jest не должен видеть `OPENAI_API_KEY` (setup.ts удаляет); в `NODE_ENV=test` воркер очереди берёт только задачи своего `owner`; `seed.ts` строит `RagService` руками — новые зависимости добавлять и туда; `POST /remarks` сам стартует разбор — в спеках очереди карточку создавать через prisma со статусом `imported`.
6. Промпт модели (`skills/uat-triage/SKILL.md`, `llm/openai-triage-llm.ts`) **не редактировать**: evals (30/30) калиброваны на нём. Правило «без детективной лексики» касается только UI и документации.

---

## 1. Общий вердикт

| Область | Состояние | Кратко |
|---|---|---|
| Ядро продукта | Готово | Статусы, история, tenancy, очередь, HITL, evals — сделаны и покрыты тестами. |
| Приглашения по e-mail | **Уже реализовано** | ADR 005/006/009, `Invitation` с хэшем токена, `/join/:token`, регистрация по приглашению, письмо через nodemailer + очередь. Не хватает только `SMTP_URL` от провайдера и 4–5 доработок. Владелец считал, что этого нет — см. раздел 4. |
| Администратор инстанса | **Уже реализовано** | `ADMIN_EMAILS` в `.env` → страница `/admin`: выдать право создавать проекты (= сделать PM), отключить, завершить сессии. Один настоящий разрыв: админ не может пригласить будущего PM, если у того нет проекта и домен не в `REGISTRATION_DOMAINS`. См. раздел 5. |
| Мок-данные | Чисто | Во фронте моков вместо API нет. Демо-персоны только в seed и отключены в production тремя барьерами. Есть косметика (демо-пароль в бандле фронта). См. раздел 6. |
| Мёртвый код | Почти чисто | 1 компонент, 5 CSS-классов, 3 токена, 1 зависимость, 2 env-ключа, 2 дублирующих эндпоинта. Основной долг — **документация о двух предыдущих дизайнах**, на которую ссылаются `AGENTS.md` и правила Cursor. См. раздел 3. |
| Отказоустойчивость | **3 блокера** | Память одного сервера (Langfuse съедает 4,3 ГБ из 8), очередь блокируется одним большим импортом, индексация ТЗ падает по 5-секундному таймауту транзакции Prisma. См. раздел 2. |

**Главная мысль:** проект не «сырой», а «недонастроенный». За неделю нужно: 3 блокера + пул соединений и лимиты (раздел 2), SMTP-провайдер и токен из очереди (раздел 4), админское приглашение PM (раздел 5), архив старых доков (раздел 3), чеклист `.env` (раздел 6).

---

## 2. Отказоустойчивость и нагрузка

Целевая нагрузка: 50–200 одновременных пользователей, десятки проектов, импорты журналов по 100–500 строк, прогоны LLM, загрузка кадров и ТЗ до 20 МБ. Сервер один, 8 ГБ, `docker compose` с прод-оверлеем.

### 2.1 Блокеры (до запуска)

#### R-B1. Бюджет памяти: 7,2 ГБ лимитов на 8 ГБ, из них 4,3 ГБ — Langfuse
`docker-compose.prod.yml:27-30` (postgres 1g), `:38-41` (api 1536m), `:93-175` (langfuse-postgres 512m + clickhouse 1536m + minio 256m + redis 256m + langfuse-worker 768m + langfuse-web 1g). Caddy, backup, ОС и page cache — сверх этого. ClickHouse при 1,5 ГБ регулярно падает по OOM на merge'ах; `restart: always` маскирует это, а в худшем случае OOM-killer снимает `api` или `postgres` в момент, когда 200 человек работают.

**Задача:** вынести Langfuse-сервисы в compose-профиль `observability`, на бету запускать без него (`LANGFUSE_TRACING_ENABLED=false`) или перейти на Langfuse Cloud (бесплатного тарифа хватит). Убрать `depends_on: langfuse-web` у `api` в `docker-compose.yml:41-44` (сейчас api не поднимается без langfuse-web). Освободившиеся ~4 ГБ: postgres `shared_buffers=512MB`, api 2g. Обновить `docs/PROD.md` («Langfuse в проде») и `.env.example`.
**Проверка:** `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` — сумма лимитов ≤ 5,5 ГБ; `/health` показывает трейсинг выключен; CI-шаг `config -q` зелёный.

#### R-B2. Очередь: один импорт блокирует все проекты (head-of-line blocking)
`apps/api/src/jobs/jobs.service.ts:63` — 4 слота воркера; `:165-169` — claim строго FIFO по `createdAt`; `apps/api/src/agent/agent.service.ts:250-254` — обработчик **внутри слота** ждёт семафор проекта (`GRAPH_MAX_PER_PROJECT=2`). Импорт на 200 строк ставит 200 задач `graph` подряд (`imports.service.ts:128-131`): две выполняются, ещё две держат слоты в ожидании семафора, а `index_document`, `notify_digest` и триажи **всех других проектов** стоят ~30 минут. Heartbeat (`:224-227`) жив, `requeueStale` не поможет.

**Задача:** в `claim()` не брать задачу, если у её `projectId` уже занято `GRAPH_MAX_PER_PROJECT` слотов (передать список занятых `projectId` в `WHERE "projectId" IS NULL OR "projectId" NOT IN (…)`), либо при занятом семафоре бросать `RetryJobError('busy', 2000)` **без** сжигания попытки (сейчас `attempts` растёт при каждом claim, `:185`). Поднять `JOBS_CONCURRENCY` до 8, оставить `GRAPH_MAX_CONCURRENT=4`, чтобы индексация и письма не конкурировали с графом.
**Проверка:** новый тест в `jobs.spec.ts`: 10 задач проекта A + 1 задача проекта B при лимите 2 на проект — задача B выполняется до окончания A.

#### R-B3. Индексация ТЗ падает по таймауту интерактивной транзакции Prisma
`apps/api/src/rag/rag.service.ts:98-108`: `$transaction(async tx => …)` без опций → дефолт `timeout: 5000`, `maxWait: 2000`. Внутри `deleteMany` + INSERT **по одному чанку**. ТЗ на 100–200 страниц даёт сотни–тысячи чанков; при занятом пуле 5 секунд заканчиваются, транзакция откатывается, `classifyRunError` даёт `unknown` → не retryable → документ `failed` (`:120-123`). Эмбеддинги уже оплачены.

**Задача:** один multi-row `INSERT … VALUES ${Prisma.join(rows)}` батчами по 200 и `{ timeout: 60_000, maxWait: 10_000 }`. Пройтись по остальным интерактивным транзакциям в `remarks.service.ts` / `rounds.service.ts` — они короткие, но `maxWait: 2000` при исчерпанном пуле даст P2024; задать `maxWait: 10_000` общим helper'ом.
**Проверка:** тест индексации документа на 2 000 чанков с FakeEmbeddings проходит < 5 с.

### 2.2 High (до запуска или в первые дни)

#### R-H1. `connection_limit=10` мал
`docker-compose.prod.yml:60`. Каждый запрос — минимум 2 запроса к БД в guard'ах (`auth.service.ts:210`, `tenancy.service.ts:18`), интерактивные транзакции воркера удерживают соединение целиком. При пиках Prisma отдаёт P2024 через 10 с, фильтр превращает его в безымянный 500 (`http/http-exception.filter.ts:58-68` — P2024 не замаплен).
**Задача:** `connection_limit=25&pool_timeout=20` (postgres `max_connections=100` по умолчанию — хватит); в фильтре P2024 → 503 `unavailable`.

#### R-H2. Прогон графа без общего дедлайна и без лимита стоимости
`agent.service.ts:245-263`: `recursionLimit: 80`, но нет `AbortSignal.timeout`. Каждый вызов модели — до 60 с × `maxRetries: 2` (`llm/openai-client.ts:4-7`), нод до 10 с циклами rewrite/bind, сверху 3 попытки очереди с паузами 30 с / 2 мин / 8 мин. Стоимость считается (`llm/openai-triage-llm.ts:258-266`), но не ограничивается; `usage` Map не чистится, если прогон упал до `takeUsage`.
**Задача:** `AbortSignal.timeout(5 * 60_000)` в `run()`; дневной лимит USD на проект по `SUM(AgentRun.costUsd)` в `beginTriage` (409 «лимит модели на сегодня», env `GRAPH_DAILY_USD_PER_PROJECT`, по умолчанию 20); `usage.delete(runId)` в `finally`.

#### R-H3. Разбор xlsx/pdf в HTTP-запросе, всё в памяти
`imports/imports.controller.ts:48-52` + `imports.service.ts:41` — `parseJournal` (ExcelJS, до 20 МБ с картинками) синхронно в запросе, блокирует event loop; затем 500 транзакций с `FOR UPDATE` на раунд (`remarks.service.ts:113-116`) и 500 `writeFile`. Пока идёт импорт, у всех останавливаются WS и REST. Multer memoryStorage: 10 параллельных загрузок по 20 МБ = 200 МБ + копии.
**Задача (можно отложить, если на бете ограничить журнал 100 строк / 5 МБ):** `ImportJob` уже есть — принять файл, сохранить, ответить 202, разбирать в задаче `import_journal`; `createImported` батчами в одной транзакции с `timeout`. Фронт `import-page.ts` уже умеет ждать статус ImportJob — проверить.

#### R-H4. Диск: нет квот и проверки свободного места
`storage/storage.service.ts:17-24` пишет без проверки; кадры, дампы и Postgres на одном диске. ENOSPC → 500 на каждом кадре и остановка Postgres. `deploy/alerts.sh:13-16` проверяет раз в час при 15 %.
**Задача:** `statfs` перед `save` (< 2 ГБ → 507 с понятным текстом); квота на проект (сумма `RemarkScreenshot.size`), env `STORAGE_QUOTA_MB_PER_PROJECT`; в runbook — `api-storage` и `postgres-backups` на отдельный диск/volume.

#### R-H5. Лимит запросов по IP «складывает» целый офис
`app.module.ts:59-62`, `config.ts:24` — 1200/мин на IP. Компания за одним NAT: 30 человек, при отвалившемся WS карточка опрашивается каждые 3 с (`pages/remark-card-page.ts:40,965`) — 600/мин только поллинг. 429 получит весь офис. `apps/web/nginx.conf:2,37` — 60 логинов/мин на IP.
**Задача:** для аутентифицированных маршрутов трекер по `req.user.id` (переопределить `getTracker` в ThrottlerGuard), IP-лимит только для `@Public`; `THROTTLE_LIMIT` → 6000; nginx auth-лимит → 300r/m.

### 2.3 Medium (первые две недели беты)

- **R-M1. Единственный инстанс.** Семафоры (`agent/semaphore.ts`), `RunEvents`, presence (`gateway/remark.gateway.ts:46`), `TenancyService.revoke`, throttler — всё в памяти процесса. Честно описано в `docs/PROD.md:130`. Не чинить сейчас; зафиксировать как ограничение беты (нельзя поднимать 2 реплики api).
- **R-M2. `GraphCheckpoint` растёт без ретеншна.** Удаление только при cancel/повторе (`agent.service.ts:146,226`); каждый прогон пишет чекпоинты с полным состоянием (`graph-state.ts:33`). **Задача:** в `JobsService.pruneFinished` (`jobs.service.ts:143-150`) — `DELETE FROM "GraphCheckpoint" WHERE runId IN (SELECT id FROM "AgentRun" WHERE status IN ('persisted','failed','cancelled') AND createdAt < now() - interval '7 days')`; вызывать prune не только на старте (`:77-88`), а `setInterval` раз в сутки.
- **R-M3. Бэкап не отрепетирован, offsite выключен.** `docs/PROD.md:84` — «последняя — не проводилась». Без профиля `offsite` кадры не бэкапятся вообще. **Задача (ops, владелец):** `COMPOSE_PROFILES=offsite`, restore на чистой VM, записать дату и RTO в PROD.md; `BACKUP_SCHEDULE=0 */6 * * *`.
- **R-M4. WS: auth один раз на connect, `join` без лимита.** `remark.gateway.ts:104-118, 125-151`. **Задача:** счётчик join на сокет (≤ 60/мин); раз в час `userFromToken` для живых сокетов.
- **R-M5. Списки без пагинации с тяжёлым include.** `remarks.service.ts:14-25,130-160` — `REMARK_INCLUDE` тянет цитаты с текстом, все прогоны, вердикты, советы; `list`/`devQueue` без `take`. Раунд на 500 строк = мегабайты на каждое открытие у каждого из 30 человек. **Задача:** облегчённый include для списков (без `citations.quoteText`, `runs` — только последний), пагинация по 100; фронт `journal-page.ts` / `dev-queue-page.ts` — «показать ещё».
- **R-M6. Postgres без ротации логов; Node без лимита кучи.** `docker-compose.prod.yml:8-32` — у postgres нет `logging: *logging`. **Задача:** добавить якорь; `NODE_OPTIONS=--max-old-space-size=1024` в api.
- **R-M7. Кадры без кэша.** `media/media.controller.ts:68-82` — `stat` + stream на каждый просмотр. **Задача:** `Cache-Control: private, max-age=31536000, immutable` (ключи — UUID, файл неизменяем).

### 2.4 Low (потом)

- **R-L1.** Гонка в семафоре `semaphore.ts:13-21` — лимит может быть превышен на 1.
- **R-L2.** `pnpm audit --audit-level=high` в CI (`ci.yml:40-41`) — красный CI от чужих advisory; перевести в non-blocking или allowlist.
- **R-L3.** Нет web-тестов (0 spec в `apps/web`). Tenancy покрыт на API (`tenancy.leakage.spec.ts`, `tenancy.sweep.spec.ts`) — это важнее; фронт-тесты после беты.
- **R-L4.** MCP http `apps/mcp/src/main.ts:81-87` — `readBody` без лимита; слушает только 127.0.0.1, наружу не публикуется. Если командам нужен MCP снаружи — через Caddy с лимитом тела 1 МБ.
- **R-L5.** Токен в localStorage (`core/session.service.ts:4,93`) при CSP `script-src 'self'` — приемлемо; refresh-токена нет. Глобальный `ErrorHandler` (`app.config.ts:12`) не репортит — без Sentry ошибки фронта не видны. **Рекомендация на бету:** подключить Sentry (бесплатный тариф) на api и web — это единственный способ узнать о падениях у пользователей.
- **R-L6.** scrypt N=16384 (`auth/password.ts:4-5`); OWASP советует 2^17 — при следующей смене формата хеша.
- **R-L7.** Экспорт xlsx (`rounds/journal-export.ts:91,211`) — вся история в памяти; streaming при > 5 000 замечаний.

### 2.5 Что уже хорошо — не переделывать

- `main.ts`/`config.ts`: fail-fast с проверкой плейсхолдеров в production (`config.ts:57-69`), `trust proxy` по `TRUST_PROXY_HOPS`, helmet, `ValidationPipe({ whitelist })`, `enableShutdownHooks`, crash-handlers в JSON-лог.
- Логи: pino + `X-Request-Id`, redact authorization/cookie, `userId`/`projectId` в каждой строке; ротация json-file 10m×5.
- Единый контракт ошибок `{statusCode, code, message, requestId}`; P2002/P2025/P2003/P2034 замаплены.
- Очередь: `UPDATE … FOR UPDATE SKIP LOCKED` одним запросом, heartbeat, `requeueStale`, backoff, `RetryJobError`, возврат задач при SIGTERM (25 с при `stop_grace_period: 90s`), `owner` для изоляции тестов.
- Tenancy: `MembershipGuard` перечитывает membership на каждом запросе; чужой проект — 404; MCP-токен привязан к проекту; ревокация через `tokenVersion`/`passwordChangedAt`.
- Auth: scrypt async, timing-safe сравнение, security-log, инвайты как sha256, `@Throttle` на login/register/password/invitation.
- Загрузки: multer `fileSize`, sniff содержимого, SVG запрещён, ключ `<projectId>/<uuid>.<ext>` с защитой от traversal, `CSP: sandbox` + `nosniff` на отдаче.
- БД: индексы (`20260906140000`), HNSW с проверкой в `/health`, `statement_timeout 120s` / `idle_in_transaction 60s`, `pg_stat_statements`, составные FK `(id, projectId)`, append-only триггер.
- Деплой: миграции отдельным шагом, `exec node`, GHCR-образы с версией в `/health`, healthchecks, порты только на 127.0.0.1, Caddy с HSTS, ежедневный pg_dump, `alerts.sh`.
- Фронт: бюджеты бандла, sourcemap выключен, хешированные ассеты с кэшем на год, socket.io с автопереподключением и REST-фолбэком, черновики в sessionStorage.
- CI: реальный Postgres с pgvector, `migrate deploy`, тесты API включая tenancy, офлайн-evals с порогом, валидация прод-compose.

---

## 3. Мёртвый код, устаревшие документы, оптимизация

Код почти чист. Долг — документация о двух предыдущих дизайнах («тёплый стол + медь», «Корректура»), которую `AGENTS.md` и `.cursor/rules/ui.mdc` до сих пор называют эталоном: следующий агент нарисует прошлый канон.

### 3.1 Удалить (код)

| Путь | Что | Доказательство |
|---|---|---|
| `apps/web/src/app/ui/hint-line.ts` | компонент `rr-hint-line` | импортёров 0, `<rr-hint-line` в шаблонах 0 |
| `apps/web/src/app/core/copy.ts`: `HINT`, `TAGLINE`, `RETEST_EXPLANATION` | строки | `HINT` — единственный потребитель hint-line; остальные — одно вхождение (объявление) |
| `apps/web/src/app/core/models.ts`: `Tone`, `RegistrationMode` | типы | нигде не используются (остальные «неимпортируемые» типы — части `Remark`/`AddMemberResult`, оставить) |
| `apps/web/src/styles.css`: `.glass--pill`, `.h-role` (3 блока: light/dark/media), `.pill--md`, `.tag`, `.dash` | CSS | ни одного вхождения в шаблонах. **Не трогать** динамические `pill--*`, `dot--*`, `avatar--*` — собираются строкой (`status-pill.ts:9`, `team-page.ts:76`) |
| `apps/web/src/styles/tokens.css`: `--rr-ink-inverse` (light+dark), `--rr-fs-64`, `--rr-lh-64` | токены | `var(--rr-…)` нигде нет; остальные 134 используются |
| `apps/web/package.json`: `@angular/forms` | зависимость | `FormsModule|ngModel|@angular/forms` в `apps/web/src` = 0 |
| `apps/web/public/.gitkeep` | заглушка | папка непустая |
| `.env.example`: `ANTHROPIC_API_KEY`, `LANGFUSE_DATABASE_URL` | переменные | нигде не читаются (Langfuse получает `DATABASE_URL` из compose) |
| `fixtures/spec/TZ.print.html` | печатная версия ТЗ | ни одной ссылки |
| `docs/ui/tokens.css` | файл-указатель (2 строки) | ссылок не осталось |

Снять лишний `export` (косметика, не блокер): `errors.ts: serverMessage`, `shortcuts.service.ts: isEditableTarget/KeyCode/ShortcutMap`, `ws.service.ts: WS_PATH/CommandAck`, `icons.ts: ICONS`, `api.service.ts: API_BASE/MediaUpload`, `queue.service.ts: QueueSnapshot/QueuePosition`, `view-transitions.ts: VtKind/NavDirection`, `theme.service.ts: ThemeMode`, `onboarding.service.ts: TourRole`, `links.ts: RoundRef`, `brand-mark.ts: BrandMarkSize/Tone`, `drop-zone.ts: DropSize`, `group-header.ts: GroupTone`, `menu.ts: MenuHead`, `process-strip.ts: StripMode`, `round-tiles.ts: TileTone`, `skeleton.ts: SkeletonKind`.

### 3.2 Дубли — свести к одному источнику

| Что | Где | Решение |
|---|---|---|
| Шаблон журнала | `apps/web/public/template.{xlsx,csv}` (статика, `import-page.ts:169-170`) **и** `GET /imports/template.{xlsx,csv}` (`imports.controller.ts:32-43`, строит из `journal-template.ts`) | Оставить API-эндпоинт как источник (он же — контракт для MCP и обновляется вместе с кодом); фронт качать через `MediaService`/ссылку на API; статику из `public/` удалить; спеки `tenancy.sweep`, `import.missing-description:171-178` не трогать |
| `GET /documents/:documentId` (`documents.controller.ts:53`) | никто не вызывает | Удалить (или дать кнопку в UI — не нужно на бету). `POST …/reindex` оставить: админ-операция, задокументирована в `docs/API.md:40` |
| Форматирование дат | `core/format.ts` **и** inline `toLocaleDateString('ru-RU')` в `team-page.ts:441`, `admin-page.ts:247` | Заменить inline на `format.ts` |
| Подписи статусов | `apps/api/src/remarks/labels.ts: STATUS_LABEL_RU` ↔ `core/copy.ts: STATUS_LABEL` — тексты уже разошлись (`awaiting_pm`, `unspecified`) | Расхождение объяснимо (xlsx без «вы»); добавить комментарий-контракт и тест на совпадение **ключей** |
| Enum'ы web ↔ Prisma | `models.ts` повторяет `RemarkStatus`, `Role`, `VerdictCode` литералами | Осознанно (фронт не тянет `@remarkround/db`); добавить spec в API, сравнивающий `Object.values(RemarkStatus)` с константой из web (импорт через относительный путь только в тесте) |
| Разовые скрипты | `evals/make-frames.ts`, `evals/make-screenshots.ts`, `imports/make-journal-fixtures.ts`, `rag/chunking-eval.ts` — в `package.json` scripts нет, только README.md:104 | Добавить `scripts`: `make:frames`, `make:screenshots`, `make:fixtures`, `rag:eval`; иначе README-команда — единственный контракт |

### 3.3 Документы: перенести в `docs/archive/` и обновить ссылки

> **Сделано 17.09.2026 (частично):** доки прошлых дизайнов удалены, а не архивированы (история — в git): `docs/ui/reference.html`, `wireframes.html`, `REDESIGN-HANDOFF.md`, `CLAUDE-DESIGN-PROMPT.md`, `tokens.css`, `01`–`04-*.md`. Ссылки обновлены в `AGENTS.md`, `REMARKROUND.md`, `.cursor/rules/*.mdc`, `docs/ui/README.md`, `ANTI.md`, `VISUAL.md`, `AGENT-PROMPT.md`, `COPY.md`, `DEMO.md`; комментарии «закон меди» в `apps/web` заменены. **Остались:** `docs/PHASES.md` и п.2 `AGENTS.md` про фазы, презентация, `REMARKROUND.md:362` (`in_dev`), `fixtures/README.md:12`, скриншоты, `.claude/launch.json`, TODO слайдера «Сравнить».

Создать `docs/archive/README.md` («история дизайна и фаз; не эталон») и перенести:

| Путь | Почему устарел |
|---|---|
| `docs/ui/reference.html` | «живой эталон UI» по `docs/ui/README.md`, `AGENTS.md` п.4, `.cursor/rules/ui.mdc` п.4 — но палитра **старая** (`--rr-bg:#f3eee6`, `--rr-accent:#1f4a3c` зелёный, `--rr-wait:#b8893a` медь), ни Onest, ни Unbounded, ни индиго. Актуальные токены: `apps/web/src/styles/tokens.css` |
| `docs/ui/wireframes.html` | «старый серый каркас», содержит «Дело модели» |
| `docs/ui/REDESIGN-HANDOFF.md` | хендофф отменённого дизайна «Инбокс приёмки»; сам объявляет себя временным; ссылается на несуществующую ветку и `~/.claude/plans/…`. Живой TODO из него (слайдер «Сравнить», п.91) — в issue |
| `docs/ui/CLAUDE-DESIGN-PROMPT.md` | помечен «исторический», тёплый фон/стекло/IBM Plex |
| `docs/ui/01-round-list.md`, `03-import.md`, `04-developer-queue.md` | ASCII-вайрфреймы 20.08 старой навигации (`02-remark-card.md` обновлён 13.09 — оставить) |
| `docs/PHASES.md` | все фазы 0–11 закрыты; `AGENTS.md` п.2 всё ещё велит «работать только в названной фазе» |
| `docs/presentation/RemarkRound.html` + `.pdf` (2,2 МБ) | слайды защиты в старом дизайне (Golos Text, `#f3efe7`); артефакт курса — оставить в archive, PDF можно вынести в GitHub Release |

Обновить после переноса:
- `AGENTS.md`: убрать п.2 (фазы) и п.4 (reference.html); эталон UI = `apps/web/src/styles/tokens.css` + `docs/ui/VISUAL.md` + `docs/ui/COPY.md` + `docs/ui/ANTI.md`.
- `.cursor/rules/ui.mdc:18` «Светлый тёплый фон» → «светлый прохладный стол» (как в VISUAL.md); п.4 — на tokens.css.
- `docs/ui/README.md`: убрать ссылки на reference/wireframes.
- `docs/ui/COPY.md:170` — раздел назван по отменённому дизайну «Инбокс приёмки»; переименовать/слить в основной текст.
- `docs/DEMO.md:11` «дифф … с медной рамкой» — медь отменена.
- `REMARKROUND.md:362` — убрать «`in_dev` (опционально)»: `docs/STATUS.md` явно говорит «не вводим».
- `fixtures/README.md:12` «12 типов ударов судьи» → без детективной лексики (это док, не промпт).
- Комментарии в коде со старым каноном «закон меди / медная полоса»: `segmented.ts:7`, `undo-bar.ts:11`, `brand-mark.ts:8`, `process-strip.ts:24,169`, `group-header.ts:8`, `login-page.ts:408`, `dev-queue-page.ts:27,278`, `journal-page.ts:44`, `copy.ts:125` — заменить на «маркер / accent-2».
- `docs/screenshots/`: `dev-advice.png`, `dev-card.png`, `import.png`, `new-remark.png` никем не подключены — подключить в README или удалить; остальные 7 — актуальные (Arc · Индиго). Все PNG прогнать через `pngquant`.
- `.claude/launch.json` содержит абсолютный путь `/Users/diamond/.nvm/…/node` — машинно-специфичен, но в git. Заменить на `node` (с `nvm use` в runtimeExecutable через `sh -c`) или добавить в `.gitignore`.
- `ui/compare-stage.ts:20` `TODO(PR7)` — единственный TODO в репо: либо сделать слайдер «Сравнить» после беты, либо снять TODO и завести issue.

### 3.4 Что не трогать (выглядит неиспользуемым, но нужно)

`seed.ts`/`seed-remarks.ts` (`pnpm seed`, `docker-entrypoint.sh`); `evals/run-evals.ts`, `evals/golden.json`, `evals/results/*` (доказательная база A/B в `docs/EVALS.md`), `apps/api/test/*`, `fixtures/spec`, `fixtures/protocol`, `fixtures/screenshots/*`, `fixtures/journal/*`, `fixtures/evals/seed.json` (chunking-eval); `skills/uat-triage/SKILL.md` и «Улики» в `llm/openai-triage-llm.ts:274` (промпт модели); `GET /projects/:id`, `POST mcp-token` (MCP-фасад); `GET /health` (healthcheck); api deps `reflect-metadata`, `rxjs`, `@nestjs/platform-socket.io`, `pino-http`, `@opentelemetry/api` (транзитивные требования); `@fontsource-variable/onest|unbounded` (копируются `angular.json:27,32`); `docs/ui/COPY.md`, `VISUAL.md`, `ANTI.md`, `02-remark-card.md`, `AGENT-PROMPT.md`, `docs/API.md` (актуален, покрывает все эндпоинты).

---

## 4. Приглашения по e-mail

### 4.1 Что уже есть (владельцу — прочитать, это работает)

**Модель:** `packages/db/prisma/schema.prisma:184-204` — `Invitation { projectId, email, role, tokenHash (sha256, unique), invitedById, expiresAt, acceptedAt, acceptedByUserId }`, `@@unique([projectId, email])`. Сырой токен `randomBytes(24).base64url` (`tenancy/invitations.service.ts:169-171`), срок 7 дней, в БД только хэш.

**Как PM приглашает:** страница «Участники» `/<slug>/team` (`pages/team-page.ts:32-51`): e-mail + сегмент «заказчик / руководитель / разработчик» → `POST /projects/:id/members { email, role }` (`projects.controller.ts:62-66`, роли `pm`, `admin`). Сервер (`projects/members.service.ts:50-68`):
- e-mail **не зарегистрирован** → `Invitation` + **сразу письмо** через `sendLink` (`invitations.service.ts:76-84`) со ссылкой `${WEB_ORIGIN}/join/${token}`; ответ `{ kind:'invitation', invitation:{ token, expiresAt, emailed } }` — токен отдаётся **один раз**, фронт показывает ссылку и «Скопировать» (`team-page.ts:119-129`), пометка «отправлено письмом» при `emailed:true`;
- e-mail **зарегистрирован** → membership сразу с указанной ролью, письма нет (`{ kind:'member' }`).

Кнопка «Новая ссылка» → `POST /projects/:id/invitations/:invId/link` (гасит старый токен, продлевает срок, **письмо не шлёт**). «Отозвать» → `DELETE …/invitations/:invId`.

**Ссылка `/join/:token`** (`app.routes.ts:27`, `pages/join-page.ts`): `GET /invitations/:token` (public, throttle) → `{ projectName, role, inviterName, expiresAt }` (e-mail приглашённого не раскрывается); принятая — 410, отозванная/истёкшая — 404. **Аноним** → «Зарегистрироваться» (`/register?invite=<token>`) и «Войти» (`/login?next=/join/<token>`). **Вошедший** → «Принять» → `POST /invitations/:token/accept` → membership с ролью приглашения → редирект в проект.

**Регистрация по приглашению** (`pages/register-page.ts:326-344`): карточка «Вас пригласили в …», сторона предвыбрана по роли, `POST /auth/register { …, inviteToken }`. Сервер (`auth/auth.service.ts:116-134`) проверяет живость ссылки до создания пользователя, создаёт, принимает приглашение.

**Режим регистрации** (`config.ts:31-35,130`): `REGISTRATION_MODE=open|invite_only`; в production по умолчанию `invite_only`. Без `inviteToken` регистрация разрешена только: `open`, домен из `REGISTRATION_DOMAINS`, e-mail из `ADMIN_EMAILS` (`auth.service.ts:221-227`). Вход прячет «Зарегистрироваться» в `invite_only`.

**Почта** (`apps/api/src/mail/`): nodemailer по `SMTP_URL` (`mail.transport.ts:19-26`), `SMTP_FROM`. `MailService.enabled = Boolean(SMTP_URL)`; без него `enqueue` возвращает `false`, ничего не падает, в production — предупреждение при старте. Отправка — задача очереди `send_mail` в `Job`: 3 попытки, backoff 30 с / 2 мин / 8 мин. Шаблоны (`mail/templates.ts`): `invitationMail` (текст + HTML) и `digestMail` («вас ждёт кнопка»). В тестах `FakeMailTransport` (`test/harness.ts:22,50`).

**Тесты уже есть:** `auth/accounts.spec.ts:70-136`, `projects/members.spec.ts:53-153`, `notifications/notifications.spec.ts:110-146`.

**Итого: «сервис почты» строить не нужно.** Нужен аккаунт у SMTP-провайдера и одна строка в `.env`.

### 4.2 Провайдер SMTP (владелец, 0 кода)

Код на nodemailer принимает любой SMTP. Для одного сервера и < 1 000 писем/мес:

| Провайдер | Бесплатно | Плюсы / минусы |
|---|---|---|
| **Resend** (рекомендация) | 3 000/мес | проще всех: `SMTP_URL=smtps://resend:re_xxx@smtp.resend.com:465`; нужен свой домен с DKIM |
| Postmark | 100/мес, далее $15 | лучшая доставляемость транзакционных; строгая модерация домена |
| Brevo | 300/день | SMTP-relay, поддержка RU/KZ |
| Mailgun / SES | дёшево на объёме | SES требует выхода из sandbox и IAM — для пилота лишнее |
| Яндекс 360 / корп. Exchange | 0 | если у заказчика есть домен; лимиты и репутация ящика |
| Self-hosted Postfix | — | **не делать**: репутация IP, DKIM/DMARC/PTR, спам-папка |

Шаги: домен → SPF/DKIM/DMARC у провайдера → `SMTP_URL`, `SMTP_FROM='RemarkRound <rr@<domain>>'` в `.env` → `docker compose up -d api` → пригласить тестовый адрес → `docker compose logs api | grep send_mail` (`docs/PROD.md:102`).

### 4.3 Доработки (код), по приоритету

- **I-1. Сырой токен утекает в `Job.payload` (безопасность).** `mail.service.ts:34` кладёт готовый текст письма с URL `/join/<token>` в JSON `Job.payload` (`schema.prisma:474`); done-задачи хранятся 30 дней (`jobs.service.ts:146`). Это обесценивает хранение `tokenHash`. **Задача:** для `kind='send_mail'` удалять строку `Job` сразу после `done` (`jobs.service.ts:205` — `delete` вместо `update`), `lastError` без тела письма. Тест: после отправки в БД нет `Job` с `payload.text ~ '/join/'`.
- **I-2. «Отправить ещё раз».** `regenerateLink` (`invitations.service.ts:87`) должен звать `sendLink` и возвращать `{ token, expiresAt, emailed }`; `team-page.ts:411` показывает «письмо ушло». Тест в `members.spec`.
- **I-3. Письмо уже зарегистрированному** при `kind:'member'` (`members.service.ts:53-67`): шаблон `memberAddedMail(projectName, role, url=/<slug>)`, `mail.enqueue`, поле `emailed` в `MemberSummary`. Сейчас человек узнаёт о проекте только открыв приложение. Тест в `notifications.spec`.
- **I-4. Атомарность accept.** `usable()` и `accept()` в разных транзакциях (`invitations.service.ts:131-157`). **Задача:** `updateMany({ where:{ id, acceptedAt:null } })` внутри `$transaction`, `count===1` иначе 410.
- **I-5. «Забыли пароль»** (тот же SMTP; сейчас `grep forgot|reset` пуст, признано в `docs/PROD.md:133`). Приглашённый, забывший пароль, без админа не войдёт. **Задача:** `PasswordReset { userId, tokenHash, expiresAt (1 ч), usedAt }`; `POST /auth/forgot { email }` → всегда 204 (без раскрытия), письмо с `/reset/<token>`; `POST /auth/reset { token, password }` → `passwordChangedAt=now`, `tokenVersion++`. Страницы `forgot-page.ts`, `reset-page.ts`, ссылка с `/login`. Тесты: неизвестный e-mail — 204 и 0 писем; токен одноразовый; старые JWT — 401.
- **I-6. Профиль:** вернуть переключатель `notifyByEmail` при `options.mail===true` — `digestMail` ссылается на `${origin}/profile` как место выключения (`templates.ts:45-46`), а раздел из профиля убран 13.09 (ADR 009:14).
- **I-7 (опционально, за флагом).** Сверка e-mail: сейчас по ссылке может зарегистрироваться/принять любой аккаунт (осознанно, ADR 006:29; ссылка = bearer, смягчение — 7 дней + отзыв). `INVITE_EMAIL_STRICT=true` → `acceptByToken` и `register(inviteToken)` требуют совпадения, иначе 403 «Ссылка выписана на другой адрес»; `peek` отдаёт `emailHint` в маске `a***@x.com`. По умолчанию `false` (сценарий «переслал коллеге»).
- **Известно и принято на пилот:** токен в path `/join/<token>` попадает в access-логи Caddy/nginx и историю браузера; `POST /auth/register` отвечает 409 «занят» (раскрытие e-mail, ADR 005:24) — в `invite_only` перебор ограничен.

---

## 5. Администратор инстанса и права PM

### 5.1 Что уже есть

- **Кто админ:** e-mail из `ADMIN_EMAILS` (`config.ts:35,132`; `auth.service.ts:250-252` `isInstanceAdmin`). Это env, не колонка в БД; в JWT флага нет — вычисляется на каждом запросе. Guard `admin/instance-admin.guard.ts` → 403.
- **Что умеет** (`admin/admin.controller.ts`, `admin.service.ts`): `GET /admin/users` (все люди с membership по проектам), `GET /admin/projects` (имя, число участников), `PATCH /admin/users/:id { canCreateProjects?, disabled? }`, `POST /admin/users/:id/revoke-sessions`. Отключение поднимает `tokenVersion` → все JWT/MCP/WS недействительны сразу. Себя отключить нельзя (409).
- **«Право PM» = `User.canCreateProjects`** (`schema.prisma:121`); у админа всегда `true`. `POST /projects` без флага — 403 (`projects.service.ts:41`); создатель становится `pm` проекта. `preferredRole` при регистрации — только подсказка, прав не даёт.
- **UI:** `/admin` (`app.routes.ts:33`, `guards.ts:102-106`, `pages/admin-page.ts`): «Выдать/снять право создавать проекты», «Отключить/Включить», «Завершить сессии»; таблица проектов. Пункт «Администрирование» в меню — только админу (`ui/app-bar.ts:331`).
- **Bootstrap** (`docs/PROD.md:44`, ADR 006): `ADMIN_EMAILS` в `.env` (прод-compose требует) → админ регистрируется на `/register` без ссылки (единственное исключение в `invite_only`) → выдаёт право PM → PM создаёт проект и зовёт людей.
- **Тесты:** `admin/admin.spec.ts:41-99`.

**Итого: «специальная учётка админа только у меня» уже есть — это ваш e-mail в `ADMIN_EMAILS`.** Никто другой админом стать не может, кроме как через правку `.env` на сервере. Для единственного владельца это достаточно и безопаснее, чем флаг в БД.

### 5.2 Разрывы и задачи

- **A-1. Единственный настоящий разрыв: админ не может пригласить будущего PM без проекта.** `Invitation.projectId` обязателен; в `invite_only` человек не с домена компании не может появиться в системе, пока какой-то PM не создаст проект и не пригласит его. **Задача:** `Invitation.projectId` → nullable + `grantCreateProjects Boolean @default(false)` (миграция); `POST /admin/invitations { email }` (guard админа) → письмо со ссылкой `/join/<token>`; `peek` показывает «Вас приглашают как руководителя приёмки»; `accept` при `projectId=null` ставит `canCreateProjects=true`, membership не создаёт; регистрация с таким `inviteToken` — аналогично. Кнопка «Пригласить руководителя» на `/admin`. Тест в `admin.spec`. Обновить ADR 006 и `docs/PROD.md` (bootstrap: админ → приглашает PM → PM создаёт проект).
- **A-2. Проектная роль `admin` в enum `Role`** (`schema.prisma:15-20`) принимается `POST /members { role:'admin' }` (`projects/dto/add-member.dto.ts:4`, `update-member.dto.ts:4`), UI не предлагает. Это ≈ `pm` без права решать; путается с администратором инстанса. **Задача:** убрать `'admin'` из DTO (минимум) — проверить seed (`other@other-tenant.dev` имеет роль admin) и спеки с `h.auth('admin')`; удаление из enum миграцией — после беты.
- **A-3. Политика: кто раздаёт роль `pm` внутри проекта.** Сегодня PM проекта может выдать роль `pm` любому участнику своего проекта (ADR 005 «проект = команда», нужно для «последнего pm» и самостоятельности команды). Право **создавать проекты** — только админ. **Решение владельца:** если нужно «только я делаю людей PM», добавить в `MembersService.add/changeRole`: `role==='pm' && !actor.isInstanceAdmin → 403`. **Не рекомендуется** без явного запроса: ломает сценарий «PM ушёл в отпуск, передал проект».
- **A-4 (опционально).** `User.isInstanceAdmin Boolean @default(false)` с `isInstanceAdmin(email) = flag || adminEmails.has(email)` — чтобы назначить второго админа из UI без правки `.env`. Пока владелец один — **не делать**; задокументировать в PROD.md: «смена админа = правка `ADMIN_EMAILS` + `docker compose up -d api`».
- **A-5.** Админ сегодня не может: создать пользователя напрямую, сбросить чужой пароль, увидеть состав проекта поимённо (только счётчик, `admin.service.ts:53-56`), удалить пользователя. Для беты хватает A-1 + I-5 («забыли пароль»); остальное — после.

---

## 6. Демо- и мок-данные

### 6.1 Вывод
Во фронте **нет** моков вместо API (grep по `mock|demo|fake|stub|заглушка` — только `TODO(PR7)` в `compare-stage.ts:20`). Демо и прод разделены `NODE_ENV` и тремя барьерами: `seed.ts:114` отказывает в production без `SEED_FORCE=1`; `DEMO_LOGINS` в production по умолчанию `false` (`config.ts:20,128`); `docker-compose.prod.yml:43-49` явно ставит `SEED_ON_START=false`, `DEMO_LOGINS=false`, `MIGRATE_ON_START=false`. Без `OPENAI_API_KEY` production **не стартует** (`config.ts:66`) — тихой деградации в «правила» нет; `/health` отдаёт `llm: rules|openai`, `alerts.sh:36` алертит.

Пути утечки — **человеческие**: запуск базового compose без прод-оверлея (тогда `NODE_ENV=development`, seed, `JWT_SECRET=change-me`), перенос демо-тома `postgres-data` в прод, `SEED_FORCE=1` в `.env`.

### 6.2 Демо-учётки (должны не работать в проде)
`pm@remarkround.dev`, `business@remarkround.dev`, `developer@remarkround.dev`, `other@other-tenant.dev` — пароль `remarkround`; проекты `11111111-…` «Клиентский кабинет», `22222222-…` «Чужой проект». Langfuse UI: `pm@remarkround.dev` / `remarkround`, ключи `pk-lf-/sk-lf-remarkround-local`. Postgres `remarkround:remarkround`; JWT `change-me`. Всё это — в `PLACEHOLDERS` `config.ts`, прод-compose требует явных значений.

### 6.3 Задачи

- **D-1.** `seed:remove` — скрипт, удаляющий 4 демо-пользователей и 2 проекта по фиксированным id (на случай, если стенд-том попал в прод); добавить в чеклист PROD.md. Сейчас «unseed» нет.
- **D-2 (косметика).** `apps/web/src/app/core/copy.ts:413, 696-704` — `LOGIN_EXTRA.demoPassword: 'пароль remarkround'` и три демо-e-mail лежат в JS-бандле всегда, рендерятся только при `demoLogins=true`. Перенести список персон в ответ `GET /auth/options` (сервер отдаёт только при `demoLogins`).
- **D-3 (косметика).** `apps/api/Dockerfile:13` `COPY fixtures ./fixtures` кладёт демо-ТЗ и 30 кадров в прод-образ. Сузить до `fixtures/spec fixtures/protocol fixtures/screenshots/*.png` (нужны `SEED_FORCE` на стенде) или оставить.
- **D-4.** `apps/api/docker-entrypoint.sh:34-44` — `SEED_ON_START` по умолчанию `true`; инвертировать дефолт на `false` и включать явно в `docker-compose.yml` — безопаснее при ручных `docker run`.
- **D-5.** `.cursor/mcp.json:7-10` — закоммиченный демо-пароль; заменить на `${env:REMARKROUND_PASSWORD}`.
- **Оставить:** `RulesTriageLlm` (осознанный офлайн-режим `LLM_MODE=rules`), `test/fake-*.ts` (вне сборки), тур онбординга (иллюстративный текст, не данные), `evals/*`, `fixtures/*`.

### 6.4 Чеклист `.env` перед бетой (владелец)
1. Поднимать **только** `docker compose -f docker-compose.yml -f docker-compose.prod.yml` или `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` в `.env`; проверить `docker compose config | grep NODE_ENV` → `production`.
2. `JWT_SECRET` (≥ 32, `openssl rand -hex 32`), `POSTGRES_PASSWORD` ≠ `remarkround`, `ADMIN_EMAILS` = ваш реальный e-mail, `PUBLIC_HOST`; все `LANGFUSE_*`, `CLICKHOUSE_PASSWORD`, `MINIO_ROOT_PASSWORD`, `REDIS_AUTH`, `SALT`, `ENCRYPTION_KEY`, `NEXTAUTH_SECRET` — не плейсхолдеры (или Langfuse выключен по R-B1); `LANGFUSE_INIT_USER_EMAIL/PASSWORD` не демо.
3. `OPENAI_API_KEY` задан; `LLM_MODE=rules` **не** ставить.
4. `SMTP_URL`, `SMTP_FROM` (раздел 4.2). `REGISTRATION_MODE` не задавать (по умолчанию `invite_only`) или `REGISTRATION_DOMAINS=<домен компании>`.
5. `SEED_FORCE` отсутствует; `SEED_ON_START`/`DEMO_LOGINS` не переопределены на `true`.
6. Прод-БД — **новый** том. Проверить: `select email from "User" where email like '%remarkround.dev' or email like '%other-tenant.dev'` → 0 строк.
7. `TRUST_PROXY_HOPS=2`, `COMPOSE_PROFILES=offsite` + `OFFSITE_*` (лимиты после R-H5 — по пользователю, `THROTTLE_LIMIT` менять не нужно).
8. Смоук после старта (`docs/PROD.md:115-127`): `GET /api/v1/auth/options` → `{ demoLogins:false, registration:'invite_only', mail:true }`; вход `pm@remarkround.dev` → 401; `/health` → `llm:'openai'`; порты 5432/5433/8123/9000/3000 снаружи закрыты; внешний uptime-монитор на `/health`; `deploy/alerts.sh` в cron.

---

## 7. Порядок работ на неделю

Оценки — для одного агента с ревью владельца. Каждый пункт — отдельный коммит.

| День | Задачи | Из раздела |
|---|---|---|
| 1 | Владелец: аккаунт у SMTP-провайдера, DNS (SPF/DKIM/DMARC), `.env` по чеклисту 6.4. Агент: R-B1 (Langfuse в профиль, лимиты), R-M6 (logging postgres, NODE_OPTIONS) | 4.2, 6.4, 2.1, 2.3 |
| 2 | R-B2 (fair claim в очереди) + R-B3 (батчевый INSERT чанков, таймауты транзакций) + R-H1 (пул 25, P2024 → 503) | 2.1, 2.2 |
| 3 | R-H2 (дедлайн прогона, дневной USD-лимит) + R-H5 (throttle по userId) + I-1 (токен из `Job`) + I-2 («Отправить ещё раз») + I-3 (письмо зарегистрированному) | 2.2, 4.3 |
| 4 | A-1 (админское приглашение PM без проекта) + A-2 (убрать `admin` из DTO) + I-5 («забыли пароль») + I-6 (переключатель в профиле) | 5.2, 4.3 |
| 5 | Раздел 3 целиком: удаление мёртвого кода (3.1), дубли (3.2), `docs/archive/` и обновление `AGENTS.md`/`.cursor` (3.3); D-1…D-5 | 3, 6.3 |
| 6 | R-H4 (проверка диска, квота), R-M3 (offsite + **репетиция restore** с датой в PROD.md), Sentry на api+web (R-L5), R-M7 (кэш кадров). Прогон всех тестов ×3, `pnpm evals -- --offline`, сборка образов, деплой по `docs/PROD.md` | 2.2, 2.3, 2.4 |
| 7 | Резерв: R-H3 (импорт в фон) — если не успели, ограничить журнал 100 строк / 5 МБ на бету; смоук по 6.4; тег `v0.9.0-beta` | 2.2 |

Первые две недели беты: R-M2 (ретеншн чекпоинтов), R-M4 (лимит join), R-M5 (пагинация списков), I-4, I-7, R-L1…R-L7, web-тесты на критичные страницы.

---

## 8. Решения, которые должен принять владелец

1. **Langfuse на бете:** выключить (профиль) или Langfuse Cloud? Рекомендация — Cloud или выключить; на 8 ГБ вместе с приложением он не живёт.
2. **SMTP-провайдер и домен писем** (4.2). Рекомендация — Resend на вашем домене.
3. **Кто раздаёт роль `pm` внутри проекта** (A-3): оставить как есть (PM проекта может) или только админ? Рекомендация — оставить.
4. **Сверка e-mail при принятии приглашения** (I-7): строгая или «ссылку можно переслать»? Рекомендация — нестрогая на бету, флаг на будущее.
5. **Лимит журнала на бету** (R-H3): делать импорт в фоне сейчас или ограничить 100 строк / 5 МБ и сделать после? Рекомендация — ограничить, сделать во вторую неделю.
6. **Дневной лимит стоимости модели на проект** (R-H2): сумма в USD? Рекомендация — 20 $ по умолчанию, env.
7. **Sentry** (или аналог) на бету — да/нет? Рекомендация — да, бесплатного тарифа хватит; без него падения фронта невидимы.
8. **Презентация и скриншоты** в старом дизайне — перегенерировать под Arc · Индиго до публичной беты или оставить в архиве как артефакт курса?

---

## Приложение. Ключи находок

Для ссылок из коммитов и issue: `R-B1…R-B3`, `R-H1…R-H5`, `R-M1…R-M7`, `R-L1…R-L7` — раздел 2; `I-1…I-7` — раздел 4.3; `A-1…A-5` — раздел 5.2; `D-1…D-5` — раздел 6.3; задачи раздела 3 — по путям.
