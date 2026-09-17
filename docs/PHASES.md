# Фазы реализации

Не начинать с графа. Одна фаза = один фокус агента. Следующая — только если DoD предыдущей зелёный.

## Фаза 0 — каркас репо

- [x] `apps/web` Angular, `apps/api` Nest, `packages/db` Prisma, compose: api+web+postgres+langfuse
- [x] `.env.example` без секретов
- [x] Этот набор docs не удалять

**DoD:** `docker compose up` поднимает пустые сервисы.

## Фаза 1 — тенанси

- [x] Prisma как в `packages/db/prisma/schema.prisma`
- [x] Auth JWT, Project, Membership
- [x] Тест leakage

**DoD:** два проекта, пользователь A не читает документы B.

Сделано 2 сентября 2026: `apps/api/src/{auth,tenancy,projects,documents}`, тест `tenancy.leakage.spec.ts` (8 проверок), seed `apps/api/src/seed.ts`.

## Фаза 2 — RAG без агента

- [x] Upload PDF/DOCX в пакет
- [x] Chunk по заголовкам, embed, pgvector
- [x] Search с цитатой, SQL-фильтр
- [x] Кусок обоснования чанкинга в ARCHITECTURE (что пробовали)

**DoD:** вопрос «какого цвета primary-кнопка?» возвращает § из `fixtures/spec`.

Сделано 3 сентября 2026: `apps/api/src/{llm,storage,rag,documents}`, миграция `vector(1536)` + HNSW, тесты `chunker.spec.ts` и `rag.search.spec.ts` (без сети, фейковые эмбеддинги), `GET /projects/:id/search`.

## Фаза 3 — замечание и карточка

Канон UI: `docs/ui/COPY.md`, `VISUAL.md`, `ANTI.md`, `reference.html`. Промпт: `docs/ui/AGENT-PROMPT.md`.

- [x] Round, Remark, screenshot upload
- [x] Карточка: три колонки — замечание | черновик разбора | решение
- [x] Подписи кнопок **дословно** из COPY.md (не Approve)
- [x] Шапка с ролью («Вы решаете, работа ли это»)
- [x] Скрин крупнее текста модели; клик — на весь экран
- [x] Нет канбана, чата, Material indigo, % уверенности (ANTI.md чист)
- [x] Пустые состояния из COPY.md
- [x] Ещё без LLM, можно заглушка черновика

**DoD:** бизнес создаёт замечание со скрином; PM на карточке за 30 секунд понимает, что жать. Сверка с `reference.html`.

Сделано 3 сентября 2026: `apps/api/src/{rounds,remarks,media}` (RemarksService — единственный путь записи, переходы по STATUS.md, 409 на нелегальные), заглушка черновика `triage-stub.service.ts` поверх настоящего retrieve, тесты `status.illegal-transition`, `verdict.idempotent`, `verdict.model-cannot-close`; фронт переведён с моков на API (`apps/web/src/app/core/{api.service,remarks.store,session.service,media.service}.ts`). Ретест пока без диффа (фаза 5), импорт журнала — мок до фазы 4.

## Фаза 4 — импорт шаблона

- [x] Скачать `fixtures/journal/template.csv` / xlsx
- [x] Парсер только этих колонок
- [x] Пустой description → `needs_human_parse`
- [x] Картинки из xlsx, если есть

**DoD:** `sample-round.csv` даёт смесь parsed + needs_human_parse. Чужой Excel с другой шапкой не «магически» маппится.

Сделано 3 сентября 2026: `apps/api/src/imports` (`journal-template.ts` — колонки шаблона в одном месте и генерация xlsx; `journal-parser.ts` — CSV/XLSX только с нашей шапкой, чужая → 422, картинка из ячейки xlsx → `RemarkScreenshot`; `ImportService` пишет `ImportJob`/`ImportRow`, замечания создаёт через `RemarksService.createImported`, разбор распарсенных строк идёт в фоне после ответа), `POST /remarks/:id/fix-row` («Допишите строку журнала» → `imported` → разбор), тест `import.missing-description.spec.ts` (7 проверок), фикстуры `fixtures/journal/{template,sample-round}.xlsx` и PNG-кадры в `fixtures/screenshots` (генератор `make-journal-fixtures.ts`). Фронт: страница импорта грузит настоящий файл, строки без описания дописываются там же или на карточке; кнопка «Скачать шаблон журнала» отдаёт xlsx. Ссылку из колонки `screenshot` в CSV сервер не тянет (SSRF): кадр прикрепляют на карточке.

## Фаза 5 — pixel-diff

- [x] `DiffModule` на `fixtures/screenshots`
- [x] Несопоставимые кадры → `cannot_compare`

**DoD:** before/after даёт картинку диффа; before vs zoom → cannot_compare или явный шум.

Сделано 3 сентября 2026: `apps/api/src/diff/diff.service.ts` — pixelmatch 5 (CJS) поверх pngjs/jpeg-js, порог 0.1 без антиалиасинга, кадры не масштабируются: другой размер, не PNG/JPG больше 35 % изменённых пикселей или рамка изменений шире 40 % кадра → `cannot_compare` с причиной по-русски; иначе PNG диффа (старый кадр серым, изменения красным) и рамка изменений с описанием места («слева снизу»). `RemarksService.retest` пишет кадр диффа как `RemarkScreenshot.kind = diff`; исход модели пока `cannot_tell` с текстом «Относится ли это к претензии — решите вы» (нода explain — фаза 6), `likely_unchanged` при совпадении пиксель в пиксель. Seed кладёт PNG-кадры и настоящий дифф. Тест `diff.cannot-compare.spec.ts` (юнит на фикстурах + ретест через API).

## Фаза 6 — граф + WS

- [x] Ноды `docs/GRAPH.md`, циклы max 2, interrupt
- [x] WS `docs/WS.md`
- [x] Persist только через RemarksService
- [x] Два окна: reject_binding продолжает тот же run

**DoD:** сюжет DEMO шаги 4–5 без фанеры «setTimeout имитация».

Сделано 3 сентября 2026: `apps/api/src/agent` — граф LangGraph.js (`triage.graph.ts`: ingest → retrieve → maybe_vision → bind → [rewrite ≤ 2] → classify → draft → faithfulness → [bind ≤ 2] → propose → interrupt PM → persist | pause; `retest.graph.ts`: load → pixel_diff → explain → apply → interrupt business), чекпоинты в Postgres через `PrismaCheckpointSaver` (таблица `GraphCheckpoint`, thread_id = `AgentRun.id`), `AgentService` — старт/продолжение/отмена прогона, `RunEvents` — шина событий комнаты. LLM только в `LlmModule`: `OpenAiTriageLlm` (gpt-4.1-mini для vision/rewrite/classify/explain, gpt-4.1 для draft, стрим токенов) и `RulesTriageLlm` без ключа (и в тестах — `test/fake-llm.ts`); Skill `skills/uat-triage/SKILL.md` подмешан в system-промпт. Faithfulness — детерминированная нода (`faithfulness.ts`): ссылка на раздел вне retrieve, дефект без цитаты или «на кадре» без кадра → цикл bind, после двух — `cannot_tell`. WS: `apps/api/src/gateway` (socket.io, путь `/api/v1/ws`, JWT в middleware, membership на `join`, комната `remark:{id}`, `verdict.approve` / `verdict.reject_binding` / `run.cancel` идут в те же методы, что REST, presence по комнате). Разбор идёт в фоне: REST отвечает `triaging` + `runId`, фазы — в комнату; `RemarksService` остался единственным путём записи (`beginTriage` / `applyProposal` / `verdict` / `cancelRun` / `beginRetest` / `applyRetest`), заглушка `triage-stub.service.ts` удалена. Фронт: `core/ws.service.ts`, `TriageRun.applyEvent` вместо таймеров, стрим черновика в колонке «Черновик разбора», «Смотрит: …» из presence, «Остановить» в фазовой строке, `?run=1` убран; без сокета — перечитывание раз в 3 с. Тесты: `graph.same-run.spec` (тот же run после reject_binding, faithfulness-цикл, cancel), `ws.room.spec` (auth, чужой проект, фазы, решение по сокету идемпотентно, второе окно видит presence и `run.persisted`), `faithfulness.spec`; старые спеки ждут статус через `h.waitFor`.

## Фаза 7 — MCP + Skill

- [x] `apps/mcp` фасад
- [x] 3 tool’а, auth, project из токена
- [x] `skills/uat-triage/SKILL.md` в нодах
- [x] Cursor находит спеку своего проекта

**DoD:** ментор может дернуть MCP не из Angular.

Сделано 3 сентября 2026: `apps/mcp` — сервер на официальном TypeScript SDK (`src/server.ts`), фасад тех же REST-маршрутов, что у Angular, без Prisma и своего SQL (ADR 003). Четыре tool’а: `search_spec`, `get_round_remarks`, `apply_human_verdict` (сам берёт `runId`, генерирует `idempotencyKey`, только `awaiting_pm`), `submit_retest_evidence` (локальный файл или `screenshotKey` → pixel-diff); tool’а закрытия нет. Prompt `uat-triage` отдаёт тот же `SKILL.md`, что подмешан в ноды `classify` / `draft` / `explain` (`apps/api/src/llm/skill.ts`, фаза 6). Проект — из токена: `POST /projects/:id/mcp-token` выпускает JWT с `projectId` из membership, `MembershipGuard` и WS `join` отдают 404 на любой другой проект даже при membership; ни один tool не принимает `projectId`, роли режет тот же `RolesGuard`, отказы приходят модели текстом. Транспорты: stdio (Cursor / Claude Desktop, `.cursor/mcp.json` с демо-логином; токен или логин из env) и Streamable HTTP без сессий в compose (`mcp` на 3002, токен в `Authorization` каждого запроса). Тест `apps/api/src/mcp/mcp.facade.spec.ts` (8 проверок) поднимает настоящий процесс `apps/mcp` по stdio: чужой проект пуст при том, что REST его документ находит; решение бизнеса отклонено; ретест-кадр даёт дифф.

## Фаза 8 — Langfuse на каждый LLM-вызов

- [x] `ObservabilityModule`: generation-span на каждый вызов OpenAI, embedding-span на эмбеддинги
- [x] Один trace на `AgentRun`, продолжение после interrupt — в тот же trace
- [x] Langfuse поднимается из compose готовым: проект, ключи, пользователь UI
- [x] Ссылка на trace с карточки (PM)

**DoD:** открыл UI Langfuse, виден сценарий DEMO.

Сделано 4 сентября 2026: `apps/api/src/observability` — Langfuse JS SDK v5 поверх OpenTelemetry (`LangfuseSpanProcessor` + `NodeTracerProvider`, регистрируется один раз на процесс; без ключей или с `LANGFUSE_TRACING_ENABLED=false` — noop, код нод не меняется). `AgentService.run` оборачивает каждый вызов графа в корневой span прогона: traceId детерминирован из `runId` (sha256), поэтому старт и продолжение после interrupt (решение PM, закрытие бизнесом — другой HTTP-запрос, через часы) ложатся в один trace; `propagateAttributes` даёт всем вложенным span'ам userId (кто нажал), sessionId = remarkId (все прогоны замечания — одна сессия), теги `triage` / `retest` и metadata projectId / remarkId / runId / model. Внутри: ноды LangGraph через `@langfuse/langchain` CallbackHandler (видны циклы rewrite / bind и interrupt), `generation` на каждый вызов OpenAI через `observeOpenAI` с именем ноды (`vision` / `rewrite` / `classify` / `draft` / `explain`; модель, параметры, токены, стрим — Langfuse считает стоимость), `embedding` на каждый вызов `EmbeddingsService`, `retrieve` (retriever) с запросом, projectId и найденными разделами, `index_document` — свой trace на индексацию. Compose: `langfuse-web` инициализируется headless (`LANGFUSE_INIT_*`: организация, проект `remarkround`, ключи, пользователь UI dana@remarkround.dev / remarkround), `api` шлёт span'ы на `http://langfuse-web:3000` теми же ключами, так что `docker compose up` даёт трейсы без ручной настройки; `.env.example` — те же локальные плейсхолдеры для API с хоста. `RemarkView.traceUrl` → «Трейс в Langfuse» в подвале карточки у PM. Тест `observability.spec.ts`: экспортёр в памяти, прогон с FakeLlm — один traceId у старта и продолжения, ноды графа и `retrieve` внутри, metadata прогона; OpenAI-обёртка на заглушке клиента даёт generation с моделью и токенами. Спеки по умолчанию идут с `LANGFUSE_TRACING_ENABLED=false`.

## Фаза 9 — evals ≥30 + A/B

- [x] Добить golden от seed
- [x] Две метрики
- [x] A/B цифры в EVALS.md и дефолт в коде

**DoD:** `pnpm evals` в CI или одной командой.

Сделано 4 сентября 2026: golden `evals/golden.json` — 30 кейсов триажа по 12 типам возражений комиссии (дефект с опорой, CR, дыра, конфликт, дубль, «текст врёт — скрин спасает», injection, визуальная претензия без кадра, ложная цитата), 13 ретест-кейсов (дифф не про претензию, зум, другой размер, 2× DPR, «почти тот» hex, secondary вместо primary, пиксель в пиксель, три настоящих исправления; новые кадры — `fixtures/screenshots`, растеризатор `apps/api/src/evals/make-frames.ts`) и leakage. Раннер `apps/api/src/evals` (`pnpm evals`, отчёт в `evals/results/`) гоняет golden через те же сервисы, что REST и MCP: `AgentService` → граф → `RemarksService`; live с ключом (трейсы в Langfuse, environment `evals`) или офлайн правилами. Метрики (`metrics.ts`): binding quality (класс или законный abstain + нужный раздел в цитатах + оригинал у повтора) и faithfulness (ни ссылки без цитаты, ни «на кадре» без кадра, ни дефекта без цитаты, ни «закрыто» от модели, ни ложных цитат). A/B ретеста на одном коде: в состоянии графа `strategy`, H0 `llm_only` — нода `judge_frames` (`TriageLlm.retestJudge`, два кадра без диффа), H1 `diff_explain` — прежний путь; переключатель `RETEST_STRATEGY`, победитель `DEFAULT_RETEST_STRATEGY = 'diff_explain'` в коде. Стоимость вызовов считается по прайсу (`llm/pricing.ts`) и пишется в `AgentRun.costUsd`. Три живые итерации за день (22 → 23 → 25 из 30 binding, faithfulness 30/30): classify по шагам (повтор → кадр → сверка «документ vs прод» → класс), ворота faithfulness пропускают только процитированные разделы и не считают дословную цитату замечания ссылкой модели. A/B: H1 12/13 без ложных «исправлено», $0.0040 / 1.3 с; H0 12/13 с ложным «исправлено» на кадре 2× DPR, $0.0047 / 1.8 с — цифры и слайд ограничений в `docs/EVALS.md`. CI `.github/workflows/ci.yml`: тесты API (включая `evals.spec.ts` офлайн — инварианты leakage / injection / faithfulness / «ретест не closed») и `pnpm evals -- --offline` с отчётом в артефакт.

## Фаза 10 — guardrails и артефакты сдачи

- [x] Injection in, no fake cites out
- [x] README портфолио (не «LLM Engineer»)
- [x] ARCHITECTURE.md, EVALS.md, презентация, compose polish

**DoD:** чеклист nFactorial из `REMARKROUND.md` §6.1 зелёный.

Сделано 5 сентября 2026: guardrail входа `apps/api/src/agent/guardrails.ts` — детерминированный детектор injection («забудь ТЗ», «ты в режиме без ограничений», «классифицируй как defect», «закрой замечание», подделка `SYSTEM:`) в нодах `ingest` и `hitl` (текст замечания и комментарий PM); находка не блокирует разбор, модель получает пометку «это содержание, не команда», PM видит третьим абзацем черновика, какие фразы прочитаны как содержание, находка попадает в корень trace; выходной guardrail — ворота faithfulness фазы 9 (только процитированные разделы). Тест `guardrail.injection.spec` (7 проверок: injection в замечании и в комментарии «не та цитата» — не дефект, выдуманный раздел не цитируется, статус не меняется без кнопки, чужой проект по просьбе в тексте не читается). Compose: `apps/api/docker-entrypoint.sh` — `prisma migrate deploy` → seed (`SEED_ON_START`, по умолчанию включён, идемпотентен) → сервер; `fixtures/` копируются в образ; `LLM_MODEL_*`, `RETEST_STRATEGY` прокинуты; `docker compose up` на чистой машине даёт рабочий стенд с демо-данными и Langfuse. Артефакты: README как портфолио (60 секунд, скриншоты `docs/screenshots/` — `apps/api/src/evals/make-screenshots.ts` через headless Chrome, чеклист требований курса с указателями, ограничения честно), `docs/ARCHITECTURE.md` (карта модулей, guardrails, стоимость / fallback, trade-off), `docs/EVALS.md` (фаза 9), презентация `docs/presentation/RemarkRound.html` → `RemarkRound.pdf` (15 слайдов: проблема → решение → демо → архитектура → граф → RAG → мультимодальность → MCP и Skill → Langfuse → evals → A/B → модели и guardrails → ограничения → итог). Не сделано и не планируется к сдаче: публичный URL (стенд одной командой), PII-фильтр (синтетика, см. ARCHITECTURE «Guardrails»).

## Фаза 11 — аккаунты, участники, прод (после защиты не ждали: пилот в компании)

- [x] Прод-гигиена: `config.ts` (fail-fast на слабом `JWT_SECRET` в production), throttler и helmet, асинхронный scrypt, MCP-токен только в своём проекте, `/health` с базой, порты на loopback, `docker-compose.prod.yml` (Caddy TLS, бэкап `pg_dump`, том `api-storage`), CSP в nginx, образы с lockfile и от `node`, `docs/PROD.md`
- [x] Аккаунты API (ADR 005): `POST /auth/register`, `GET /auth/me`, профиль, смена пароля с отзывом токенов, `GET /auth/options`; участники и приглашения ссылкой; проект создаёт сторона pm и становится pm
- [x] Фронт: регистрация, `/projects` (ожидание или создание), `/join/<token>`, «Участники», профиль, «Новый раунд», свежие membership без перелогина
- [x] Данные и производительность (PR 3): `screenshotKey` только своего проекта (и цитаты только из своего пакета), индексы горячих путей, номера под блокировкой строки раунда/проекта, таймауты OpenAI, лимит параллельных прогонов (`GRAPH_MAX_CONCURRENT`, `GRAPH_MAX_PER_PROJECT`), `hnsw.iterative_scan`, SVG не принимается

**DoD:** незнакомый человек регистрируется, руководитель приёмки создаёт проект, добавляет разработчика и заказчика (по ссылке и по e-mail), команда проходит ритуал §3.3 без seed; прод-override поднимается на чистом сервере по `docs/PROD.md`; демо-путь `docker compose up` с карточками ролей не изменился.

Сделано 6 сентября 2026: `apps/api/src/config.ts`, `auth/{register,update-profile,change-password}.dto.ts`, `tenancy/invitations.service.ts`, `projects/{members.service,invitations.controller}.ts`, миграция `20260906130000_accounts_invitations`, тесты `accounts.spec`, `members.spec`, `password.spec`, `config.spec`, `health.spec`, `semaphore.spec`, `remarks.number.spec` (+ расширенный `tenancy.leakage.spec`); миграция `20260906140000_perf_indexes`, `agent/semaphore.ts`, `llm/openai-client.ts`; фронт `pages/{register,projects,team,profile,join}-page.ts`, `core/account.service.ts`, `ui/sheet.ts`; `docker-compose.prod.yml`, `deploy/Caddyfile`, `docs/PROD.md`, `docs/adr/005-accounts-and-invitations.md`, `docs/API.md`, `docs/ui/COPY.md`.
