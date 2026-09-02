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
| Postgres (app) | `localhost:5432`, БД `remarkround` |

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
pnpm --filter @remarkround/api test   # tenancy.leakage.spec: чужой проект → 404
```

`DATABASE_URL` берётся из `.env`; для другого порта Postgres задайте переменную явно. Нужен Node 24 (`.nvmrc`).

Поиск по пакету документов (фаза 2): `GET /api/v1/projects/:projectId/search?q=какого цвета primary-кнопка` → чанки с разделом (`§2.1 Primary`), фрагментом и score. Загрузка документа: `POST .../documents` (multipart `file` + `kind`). Индексация требует `OPENAI_API_KEY`; без него документы остаются в статусе `uploaded`. Сравнение стратегий чанкинга: `pnpm --filter @remarkround/api exec tsx src/rag/chunking-eval.ts`.

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
