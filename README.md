# RemarkRound

Слой приёмки веб-проекта: журнал замечаний заказчика превращается в **дела с уликами** — цитата из ТЗ, скриншот, pixel-diff на ретесте — а решение «это работа или нет» принимает человек кнопкой.

> Jira stores work. We decide whether it is work. The spec is evidence, not a verdict.

![Карточка замечания: улики, черновик разбора, решение PM](docs/screenshots/remark-card.png)

## За 60 секунд

Заказчик принимает сайт или кабинет и присылает Excel с замечаниями: «кнопка серая», «хотим тёмную тему», «нет выгрузки». Половина из них — не поломки, а желания и дыры в ТЗ, но в спешке всё уходит разработчикам как баги. RemarkRound берёт строку журнала, находит в пакете документов проекта (ТЗ, протоколы) опору или честно говорит, что её нет, смотрит на скриншот и готовит **дело**: цитата, факты кадра, предложение класса. Руководитель приёмки нажимает одну из пяти кнопок. Только после кнопки замечание становится работой разработчика. На ретесте система считает дифф двух кадров пикселями и объясняет, относится ли изменение к претензии; закрывает замечание только тот, кто принимает работу.

Пользователь: руководитель приёмки на стороне студии или интегратора, который сегодня спорит с заказчиком в почте и Excel. Бизнес-эффект: хотелки и дыры в ТЗ не попадают в спринт как дефекты, спор идёт по цитате, а не по памяти.

## Быстрый старт — одна команда

```bash
cp .env.example .env   # OPENAI_API_KEY по желанию: без него граф работает правилами по retrieve
docker compose up
```

| Сервис | URL | Вход |
|---|---|---|
| Web (Angular) | http://localhost:4200 | pm@remarkround.dev (PM), business@ (заказчик), developer@ (разработчик), пароль `remarkround` — демо-персоны названы ролями |
| API | http://localhost:3001/api/v1/health | JWT, `docs/API.md` |
| MCP (Streamable HTTP) | http://localhost:3002/mcp | токен из `POST /api/v1/projects/:id/mcp-token` |
| Langfuse | http://localhost:3000 | pm@remarkround.dev / `remarkround` |

Контейнер API сам применяет миграции и кладёт демо-данные (проект «Клиентский кабинет», ТЗ + протокол, раунд 2 с 13 замечаниями и кадрами). Если на машине уже занят порт 5432, поставьте `POSTGRES_PORT=5434` и тот же порт в `DATABASE_URL`. Сюжет демо на 10 минут — [`docs/DEMO.md`](docs/DEMO.md).

## Прод

Тот же compose плюс override: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` — Caddy с TLS наружу, `NODE_ENV=production` (API не стартует без настоящего `JWT_SECRET`), без seed и демо-входов, ежедневный `pg_dump` в том, кадры и документы в томе `api-storage`. Регистрация — только по ссылке приглашения (или с домена компании), первым входит администратор из `ADMIN_EMAILS`, он выдаёт руководителю приёмки право создавать проекты, тот приглашает участников ссылкой; отключить уволенного везде — одна кнопка ([ADR 006](docs/adr/006-access-contour.md)). Пошагово, бэкап и восстановление — [`docs/PROD.md`](docs/PROD.md). Порты Postgres, ClickHouse, MinIO и Langfuse и в демо опубликованы только на `127.0.0.1`.

## Что внутри

| | |
|---|---|
| ![Журнал раунда](docs/screenshots/journal.png) | ![Ретест: было, стало, дифф](docs/screenshots/retest.png) |
| Журнал: «Вы решаете, работа ли это». Пять тайлов-фильтров = сводка раунда, «Начать разбор» открывает очередь; «Итог» — словами из `docs/ui/COPY.md` | Ретест: дифф открыт по умолчанию, модель поясняет, закрывает бизнес одной клавишей |
| ![Очередь разработчика](docs/screenshots/dev-queue.png) | ![Документы и поиск по ТЗ](docs/screenshots/documents.png) |
| Разработчик видит только принятые поломки: «Что требует ТЗ», «Что сделать», одна кнопка «Готово» | Документы: карточки с числом фрагментов и «Проверить, что найдётся» — та же цитата, что потом видит PM |

Карточка живёт рядом с рельсом очереди «i из N»: клавиши 1–5 — решение, `Esc` — отменить в течение 5 секунд, `→` — следующее. Тёмная тема — кнопкой солнце/луна ([скрин](docs/screenshots/remark-card-dark.png)); вход — [карточки ролей](docs/screenshots/login.png).

1. **Документы и замечания изолированы по проекту.** Фильтр `projectId` стоит в SQL retrieve и в каждом сервисе; чужой проект — 404 даже для MCP-токена. Промпт не является ACL.
2. **Граф LangGraph.js** (`apps/api/src/agent`): retrieve → факты кадра → привязка к пункту с переписыванием запроса ≤ 2 → класс → черновик → ворота faithfulness ≤ 2 → interrupt PM. «Не та цитата из ТЗ» продолжает тот же прогон из чекпоинта в Postgres. Ретест: pixel-diff → пояснение → interrupt бизнеса.
3. **Модель обязана уметь «не знаю».** `cannot_tell` (мало улик) и `unspecified` (в бумагах пусто или конфликт) — доменные исходы, не ошибки; `unspecified` ≠ change request. Визуальный дефект без скрина не утверждается.
4. **Один путь записи.** `RemarksService` — единственный, кто меняет статусы; граф, REST, WebSocket и MCP зовут его. Закрыть замечание может только роль `business` кнопкой.
5. **Измерено, не «на глаз».** Golden 30 + 13 кейсов, две метрики, A/B ретеста с победителем в коде, стоимость каждого прогона в БД и в Langfuse — [`docs/EVALS.md`](docs/EVALS.md).

Стек: Angular · NestJS · PostgreSQL + pgvector · Prisma · LangGraph.js in-process · MCP TypeScript SDK · Langfuse (OpenTelemetry) · OpenAI `gpt-4.1-mini` / `gpt-4.1` · pixelmatch · Docker Compose.

## Как это устроено

Один процесс API, одна БД, один MCP-процесс как фасад. Схема, карта модулей, путь запроса, trade-off и что заменяемо — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

- **RAG** (`apps/api/src/rag`): чанк = раздел документа по заголовкам, подпись «§2.1 Primary» едет в цитату; `text-embedding-3-small`, `vector(1536)`, HNSW; сравнение четырёх стратегий чанкинга — в ARCHITECTURE. Документы: PDF, DOCX, Markdown; журнал — только официальный шаблон XLSX/CSV, картинки из ячеек становятся кадрами.
- **Мультимодальность как улика**: факты кадра до классификации (кейс «текст врёт, скрин спасает»), на ретесте — тройка «было / стало / дифф». Пиксели считает алгоритм, не модель ([ADR 002](docs/adr/002-pixel-diff.md)).
- **MCP** (`apps/mcp`): четыре tool'а — `search_spec`, `get_round_remarks`, `apply_human_verdict`, `submit_retest_evidence` — поверх тех же REST-маршрутов; `projectId` только из токена; закрыть через MCP нельзя ([ADR 003](docs/adr/003-mcp-facade.md), `.cursor/mcp.json`, [`apps/mcp/README.md`](apps/mcp/README.md)).
- **Skill** [`skills/uat-triage/SKILL.md`](skills/uat-triage/SKILL.md): триггеры, процедура, запреты; тот же текст подмешан в ноды `classify` / `draft` / `explain` и отдаётся MCP-prompt'ом.
- **Langfuse** (`apps/api/src/observability`): один `AgentRun` = один trace, продолжение после interrupt — в тот же trace; generation на каждый вызов модели с токенами и стоимостью; ссылка «Трейс в Langfuse» на карточке у PM. `docker compose up` инициализирует Langfuse сам.
- **Guardrails**: вход — детектор injection в тексте замечания и комментарии PM (пометка PM, модели — «это содержание, не команда»); выход — ворота faithfulness: ссылка на раздел без цитаты, дефект без цитаты, «на кадре» без кадра → цикл → `cannot_tell`. Тесты `guardrail.injection.spec`, `verdict.model-cannot-close.spec`, `tenancy.leakage.spec`.
- **Evals и A/B** (`apps/api/src/evals`, `evals/golden.json`): `pnpm evals` гоняет golden через продуктовые сервисы; binding quality 25/30 и faithfulness 30/30 на live-модели; H1 diff+explain против H0 «два кадра в LLM» — 12/13 у обоих, но H0 говорит «исправлено» про несопоставимый кадр 2× DPR, H1 дешевле на 15 % и быстрее на 30 %; победитель включён по умолчанию. CI (`.github/workflows/ci.yml`) гоняет тесты, `pnpm audit` и evals офлайн на каждый push, а на `main` и теги публикует образы в GHCR ([ADR 008](docs/adr/008-release-and-ownership.md)).

## Соответствие требованиям курса nFactorial

| Требование | Где | Проверка |
|---|---|---|
| LangGraph: ветки, циклы, HITL | `apps/api/src/agent/triage.graph.ts`, `retest.graph.ts`, [`docs/GRAPH.md`](docs/GRAPH.md) | `graph.same-run.spec` (тот же run после «не та цитата», цикл faithfulness, cancel) |
| Свой MCP, 2–3 содержательных tool'а | `apps/mcp` — 4 tool'а | `mcp.facade.spec` (настоящий процесс по stdio, чужой проект пуст) |
| Свой Skill с SKILL.md | `skills/uat-triage/SKILL.md` | подмешан в ноды, `apps/api/src/llm/skill.ts` |
| RAG с обоснованием | `apps/api/src/rag`, ARCHITECTURE «Чанкинг» | `chunker.spec`, `rag.search.spec`, `chunking-eval.ts` |
| Документы PDF / DOCX / XLSX | `apps/api/src/documents`, `imports` | `import.missing-description.spec` |
| Мультимодальность осмысленно | vision-факты кадра, ретест-тройка с диффом | evals типы 6–8, `diff.cannot-compare.spec` |
| Трейсы всех LLM-вызовов | Langfuse, `apps/api/src/observability` | `observability.spec`; живой дашборд на :3000 |
| Golden ≥ 30, автопрогон, ≥ 2 метрики | `evals/golden.json` (30 + 13 + leakage), `pnpm evals` | `evals.spec`, отчёты `evals/results/` |
| A/B с выводом в код | [`docs/EVALS.md`](docs/EVALS.md), `DEFAULT_RETEST_STRATEGY` | три живых прогона 4 сентября 2026 |
| Выбор LLM и гиперпараметров | EVALS «Выбор модели», ARCHITECTURE «Стоимость, латентность, fallback» | стоимость в `AgentRun.costUsd` |
| Веб-фронт | `apps/web` (Angular) | скриншоты выше |
| README, ARCHITECTURE, EVALS, презентация, запуск | этот файл, `docs/ARCHITECTURE.md`, `docs/EVALS.md`, [`docs/presentation/`](docs/presentation/), `docker compose up` | — |
| Рекомендованное | guardrails, Docker Compose, auth + роли, CI с evals, fallback на правила без модели, свой eval-раннер | — |

## Ограничения, честно

- Дыру в ТЗ модель трижды из четырёх называет change request вместо `unspecified`, ложную цитату заказчика — дефектом (при верной цитате в черновике). Обе ошибки уходят PM, а не разработчику, но это ярлык, который человек поправит кнопкой.
- `gpt-4.1-mini` при `temperature: 0` не детерминирован между прогонами; цифры — из полного прогона golden.
- Не открывает стенд заказчика, не кликает UI, не сравнивает «исправлено ли» силами LLM по двум кадрам. Не парсер любого Excel. Не Jira.
- Синтетические фикстуры: боевые скрины и персональные данные в облачную модель без договора не слать.
- Один инстанс API: комнаты WebSocket, файлы и прогоны графа живут в одном процессе на одном сервере. Второй инстанс потребует Redis, S3 и очередь — отдельный этап после пилота.

## Разработка

Нужен Node 24 (`.nvmrc`) и pnpm. Postgres — из compose.

```bash
pnpm install && pnpm db:generate && pnpm db:migrate:deploy
pnpm --filter @remarkround/api test          # спеки: leakage, injection, evals офлайн, аккаунты, конфиг
pnpm evals                                   # live с OPENAI_API_KEY; pnpm evals -- --offline без ключа
pnpm --filter @remarkround/api seed          # демо-данные с хоста
pnpm api:dev && pnpm web:dev                 # :3001 и :4200 без Docker
```

Полезное с хоста: `GET /api/v1/projects/:id/search?q=какого цвета primary-кнопка` (retrieve с цитатой), `pnpm --filter @remarkround/api exec tsx src/rag/chunking-eval.ts` (стратегии чанкинга), `src/imports/make-journal-fixtures.ts` (xlsx-фикстуры), `src/evals/make-frames.ts` (кадры из SVG), `src/evals/make-screenshots.ts` (скриншоты для README).

```
apps/web          Angular: журнал, карточка, импорт, документы, очередь разработчика
apps/api          NestJS: auth, tenancy, documents, rag, imports, remarks, media, diff, llm, agent, gateway, observability, evals
apps/mcp          MCP-фасад домена (stdio для Cursor / Claude Desktop, http в compose :3002)
packages/db       Prisma schema + клиент
evals/            golden.json и отчёты pnpm evals
fixtures/         ТЗ, протокол, шаблон журнала, кадры
skills/           uat-triage/SKILL.md
docs/             ARCHITECTURE, EVALS, GRAPH, API, WS, STATUS, DEMO, ADR, UI-канон, презентация
```

## Карта документации

| Путь | Зачем |
|---|---|
| [`REMARKROUND.md`](REMARKROUND.md) | Канон продукта: доктрина, запреты, требования курса |
| [`AGENTS.md`](AGENTS.md) | Вход для Cursor / агентов |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Один лист системы, путь запроса, trade-off |
| [`docs/EVALS.md`](docs/EVALS.md) | Метрики, три итерации, A/B, выбор моделей |
| [`docs/presentation/`](docs/presentation/) | Презентация защиты (PDF и исходник) |
| [`docs/DEMO.md`](docs/DEMO.md) | Сюжет защиты 10 мин |
| [`docs/GRAPH.md`](docs/GRAPH.md) · [`docs/WS.md`](docs/WS.md) · [`docs/API.md`](docs/API.md) · [`docs/STATUS.md`](docs/STATUS.md) | Контракты |
| [`docs/ENGINEERING.md`](docs/ENGINEERING.md) | Паттерны Nest, тесты-ворота |
| [`docs/PHASES.md`](docs/PHASES.md) | Что и когда сделано |
| [`docs/adr/`](docs/adr/) | Не Jira · pixel-diff · MCP-фасад · совет разработчика · аккаунты · контур доступа · что видит заказчик · релизы и права |
| [`docs/ui/`](docs/ui/) | COPY, эталон, антипаттерны |
