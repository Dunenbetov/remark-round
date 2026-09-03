# RemarkRound

Слой приёмки веб-проекта: журнал замечаний как **дело из улик**, не как Excel на почте и не как Jira.

> Jira stores work. We decide whether it is work. The spec is evidence, not a verdict.

Канон продукта: [`REMARKROUND.md`](REMARKROUND.md). Агентам — [`AGENTS.md`](AGENTS.md), фазы — [`docs/PHASES.md`](docs/PHASES.md).

## Быстрый старт (фаза 0)

```bash
cp .env.example .env
docker compose up
```

| Сервис | URL |
|---|---|
| Web (Angular) | http://localhost:4200 |
| API health | http://localhost:3001/api/v1/health → `{ "ok": true }` |
| Langfuse UI | http://localhost:3000 |
| Postgres (app) | `localhost:${POSTGRES_PORT:-5432}`, БД `remarkround` (свой Postgres на 5432? поставьте `POSTGRES_PORT=5434` и тот же порт в `DATABASE_URL`) |

### Prisma (опционально, с хоста)

Когда Postgres уже поднят:

```bash
pnpm install
pnpm db:generate
pnpm db:migrate:deploy
```

Для разработки с новой миграцией: `pnpm db:migrate`.

### Демо-данные и тесты API (фаза 1)

```bash
pnpm --filter @remarkround/api seed   # Дана (pm+admin), Айгерим (business), Тимур (developer), пароль remarkround
pnpm --filter @remarkround/api test   # tenancy.leakage.spec: чужой проект → 404; DATABASE_URL берётся из .env
```

`DATABASE_URL` берётся из `.env`; для другого порта Postgres задайте переменную явно. Нужен Node 24 (`.nvmrc`).

Поиск по пакету документов (фаза 2): `GET /api/v1/projects/:projectId/search?q=какого цвета primary-кнопка` → чанки с разделом (`§2.1 Primary`), фрагментом и score. Загрузка документа: `POST .../documents` (multipart `file` + `kind`). Индексация требует `OPENAI_API_KEY`; без него документы остаются в статусе `uploaded`. Сравнение стратегий чанкинга: `pnpm --filter @remarkround/api exec tsx src/rag/chunking-eval.ts`.

Замечания (фаза 3): фронт ходит в API через `/api/v1` (в dev — прокси `apps/web/proxy.conf.json`, в Docker — nginx). Seed создаёт раунд 2 с 13 замечаниями и кадрами из `fixtures/screenshots`.

Граф и комната (фаза 6): разбор замечания — граф LangGraph.js в `apps/api/src/agent` (retrieve → факты кадра → привязка к пункту с переписыванием запроса ≤ 2 → класс → черновик → проверка по документам ≤ 2 → interrupt PM), чекпоинты в Postgres (`GraphCheckpoint`, thread = `AgentRun.id`), поэтому «Не та цитата из ТЗ» продолжает тот же прогон, а «В работу разработчикам» его закрывает. REST отвечает сразу (`triaging` + `runId`), фазы, токены черновика и решения идут по WebSocket в комнату `remark:{id}` (`/api/v1/ws`, socket.io, тот же JWT, membership на join). Без `OPENAI_API_KEY` ноды работают правилами по retrieve (офлайн, честно, без выдуманных разделов); с ключом — `gpt-4.1-mini` на classify/vision/explain и `gpt-4.1` на черновик (`LLM_MODEL_FAST` / `LLM_MODEL_STRONG`). Skill `skills/uat-triage/SKILL.md` подмешан в промпт. Модель по-прежнему не закрывает ничего.

Импорт журнала (фаза 4): только официальный шаблон — `fixtures/journal/template.csv` / `template.xlsx` (кнопка «Скачать шаблон журнала» в UI). `POST /api/v1/projects/:projectId/imports` (multipart `file` + `roundId`) разбирает `.xlsx` и `.csv` с этой шапкой, чужую шапку отдаёт 422; строка без `description` становится замечанием «Допишите строку журнала» (`needs_human_parse`), картинка из ячейки xlsx — кадром. Демо-журнал: `fixtures/journal/sample-round.csv` / `.xlsx` (10 строк, одна без описания, четыре с кадрами). Пересобрать xlsx-фикстуры: `pnpm --filter @remarkround/api exec tsx src/imports/make-journal-fixtures.ts`.

Ретест (фаза 5): `POST .../remarks/:id/retest` с новым кадром строит детерминированный дифф (`apps/api/src/diff`, pixelmatch): картинка диффа становится третьим кадром карточки, кадры другого размера или формата, а также слишком разные кадры (другой экран, зум) честно дают «Не могу сравнить кадры» с причиной. Модель по диффу не закрывает ничего: закрывает бизнес.

Вход: `POST /api/v1/auth/login` `{ "email", "password" }` → `{ accessToken, user, memberships }`. Дальше `Authorization: Bearer <token>`; проектные маршруты `/projects/:projectId/...` проверяют membership (чужой проект — 404) и роль (403).

Индекс pgvector по embedding — после migrate, см. [`packages/db/README.md`](packages/db/README.md).

### Локальная разработка без Docker

```bash
pnpm install
pnpm db:generate
# postgres на localhost:5432
pnpm api:dev    # :3001 если PORT=3001 в .env
pnpm web:dev    # :4200
```

## Структура

```
apps/web          Angular
apps/api          NestJS
apps/mcp          MCP stub (фаза 7, не в compose)
packages/db       Prisma schema + клиент
docker-compose.yml
```

## Карта документации

| Путь | Зачем |
|---|---|
| [`REMARKROUND.md`](REMARKROUND.md) | Канон. Не переписывать без владельца |
| [`AGENTS.md`](AGENTS.md) | Вход для Cursor/агентов |
| [`.cursor/rules/`](.cursor/rules/) | Always-on правило в Cursor |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Один лист системы |
| [`docs/STATUS.md`](docs/STATUS.md) | Легальные статусы Remark |
| [`docs/API.md`](docs/API.md) | REST |
| [`docs/WS.md`](docs/WS.md) | Комната замечания |
| [`docs/GRAPH.md`](docs/GRAPH.md) | Ноды LangGraph |
| [`docs/ENGINEERING.md`](docs/ENGINEERING.md) | Паттерны Nest, тесты-ворота |
| [`docs/EVALS.md`](docs/EVALS.md) | Метрики и A/B (шаблон цифр) |
| [`docs/PHASES.md`](docs/PHASES.md) | Порядок работ + DoD |
| [`docs/DEMO.md`](docs/DEMO.md) | Сюжет защиты 10 мин |
| [`docs/adr/`](docs/adr/) | Три решения судьи, не переспоривать |
| [`docs/ui/`](docs/ui/) | UI-канон: COPY, эталон HTML, антипаттерны |
| [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma) | Имена сущностей |
| [`skills/uat-triage/SKILL.md`](skills/uat-triage/SKILL.md) | Skill курса |
| [`fixtures/`](fixtures/) | ТЗ, протокол, журнал, скрины, eval-семена |
| [`evals/`](evals/) | Куда класть golden set при коде |

## Стек (жёсткий)

Angular (latest stable) · NestJS · PostgreSQL + pgvector · Prisma · Docker Compose · LangGraph.js in-process · MCP TS SDK как фасад · Langfuse · официальные SDK OpenAI/Anthropic.

Нельзя: React, Python-ядро, Jira-канбан, автозакрытие, Playwright, универсальный Excel, LLM как сравнение пикселей.

## Для PM / подростка

Jira — список дел. Мы — разбор *до* списка: обещали в бумагах или просто захотели. Пока человек не нажал кнопку, у разработчика нет задачи.
