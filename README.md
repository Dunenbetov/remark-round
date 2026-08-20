# RemarkRound — рабочая папка проекта

Слой приёмки веб-проекта: журнал замечаний как **дело из улик**, не как Excel на почте и не как Jira.

> Jira stores work. We decide whether it is work. The spec is evidence, not a verdict.

**Код приложения здесь ещё не пишется.** Здесь эталон, контракты и фикстуры. Агент, который пишет код, сначала читает это.

## С чего начать (человек или агент)

1. [`AGENTS.md`](AGENTS.md) — 30 секунд правил.
2. [`REMARKROUND.md`](REMARKROUND.md) — доктрина. §2 важнее UI.
3. Фаза из [`docs/PHASES.md`](docs/PHASES.md) — не прыгать через порядок.
4. Контракт, который трогаешь: схема / API / WS / граф / экран.

## Карта

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
