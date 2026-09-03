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
- [x] Карточка: три колонки улики | черновик разбора | решение
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

Сделано 3 сентября 2026: `apps/api/src/agent` — граф LangGraph.js (`triage.graph.ts`: ingest → retrieve → maybe_vision → bind → [rewrite ≤ 2] → classify → draft → faithfulness → [bind ≤ 2] → propose → interrupt PM → persist | pause; `retest.graph.ts`: load → pixel_diff → explain → apply → interrupt business), чекпоинты в Postgres через `PrismaCheckpointSaver` (таблица `GraphCheckpoint`, thread_id = `AgentRun.id`), `AgentService` — старт/продолжение/отмена прогона, `RunEvents` — шина событий комнаты. LLM только в `LlmModule`: `OpenAiTriageLlm` (gpt-4.1-mini для vision/rewrite/classify/explain, gpt-4.1 для draft, стрим токенов) и `RulesTriageLlm` без ключа (и в тестах — `test/fake-llm.ts`); Skill `skills/uat-triage/SKILL.md` подмешан в system-промпт. Faithfulness — детерминированная нода (`faithfulness.ts`): ссылка на раздел вне retrieve, дефект без цитаты или «на кадре» без кадра → цикл bind, после двух — `cannot_tell`. WS: `apps/api/src/gateway` (socket.io, путь `/api/v1/ws`, JWT в middleware, membership на `join`, комната `remark:{id}`, `verdict.approve` / `verdict.reject_binding` / `run.cancel` идут в те же методы, что REST, presence по комнате). Разбор идёт в фоне: REST отвечает `triaging` + `runId`, фазы — в комнату; `RemarksService` остался единственным путём записи (`beginTriage` / `applyProposal` / `verdict` / `cancelRun` / `beginRetest` / `applyRetest`), заглушка `triage-stub.service.ts` удалена. Фронт: `core/ws.service.ts`, `TriageRun.applyEvent` вместо таймеров, стрим черновика в колонке «Черновик разбора», «Смотрит: …» из presence, «Остановить» в фазовой строке, `?run=1` убран; без сокета — перечитывание раз в 3 с. Тесты: `graph.same-run.spec` (тот же run после reject_binding, faithfulness-цикл, cancel), `ws.room.spec` (auth, чужой проект, фазы, вердикт по сокету идемпотентен, второе окно видит presence и `run.persisted`), `faithfulness.spec`; старые спеки ждут статус через `h.waitFor`.

## Фаза 7 — MCP + Skill

- [ ] `apps/mcp` фасад
- [ ] 3 tool’а, auth, project из токена
- [ ] `skills/uat-triage/SKILL.md` в нодах
- [ ] Cursor находит спеку своего проекта

**DoD:** ментор может дернуть MCP не из Angular.

## Фаза 8 — Langfuse на каждый LLM-вызов

**DoD:** открыл UI Langfuse, виден сценарий DEMO.

## Фаза 9 — evals ≥30 + A/B

- [ ] Добить golden от seed
- [ ] Две метрики
- [ ] A/B цифры в EVALS.md и дефолт в коде

**DoD:** `pnpm evals` в CI или одной командой.

## Фаза 10 — guardrails и артефакты сдачи

- [ ] Injection in, no fake cites out
- [ ] README портфолио (не «LLM Engineer»)
- [ ] ARCHITECTURE.md, EVALS.md, презентация, compose polish

**DoD:** чеклист nFactorial из `REMARKROUND.md` §6.1 зелёный.
