# AGENTS.md — вход для любого агента

Ты пишешь **RemarkRound**, не helpdesk, не Jira, не чат с PDF.

## Обязательно прочитай до первого diff

1. [`REMARKROUND.md`](REMARKROUND.md) — доктрина §2 и запреты §15.
2. [`docs/PHASES.md`](docs/PHASES.md) — работай **только** в названной фазе. Не начинай с графа.
3. Контракт фазы: Prisma / API / WS / GRAPH / UI.
4. Если трогаешь `apps/web`: [`docs/ui/COPY.md`](docs/ui/COPY.md), [`docs/ui/reference.html`](docs/ui/reference.html), [`docs/ui/ANTI.md`](docs/ui/ANTI.md). Промпт: [`docs/ui/AGENT-PROMPT.md`](docs/ui/AGENT-PROMPT.md).

## Доктрина в одном абзаце

ТЗ не судья. Судья — человек. Система собирает улики (чанки пакета документов, скрин, pixel-diff) и имеет право сказать `cannot_tell` / `unspecified`. `unspecified` ≠ change request. Превращение в работу разработчика — только `HumanVerdict` PM; закрытие — только кнопка заказчика (после ретеста или, если проверил сам, без нового кадра — ADR 010). Чужой `projectId` режется SQL, не промптом.

## Стек

TypeScript strict · Angular · NestJS · Prisma · PostgreSQL/pgvector · LangGraph.js внутри Nest · MCP = фасад тех же сервисов · Langfuse · pixelmatch, не LLM-пиксели.

Запись в БД: только доменные сервисы (`RemarksService` и соседи). Граф и MCP **не** ходят в Prisma сами.

## Сделай / не делай

| Делай | Не делай |
|---|---|
| Фильтр `projectId` в SQL | Канбан, спринты, story points |
| HITL interrupt, checkpoint | Авто-accept / авто-close |
| Шаблон xlsx + `needs_human_parse` | Парсер «любого журнала» |
| Pixel-diff + LLM explain на ретесте | «Исправлено?» двумя кадрами в GPT |
| `cannot_tell` как 200-й бизнес-исход | 500 на «модель не знает» |
| Цитаты из retrieve | Выдуманный раздел ТЗ |
| Тест leakage чужого проекта | React, Python-ядро, Qdrant, Playwright |
| Карточка как в `reference.html` | Канбан, ChatGPT-чат, Material фиолет, синонимы кнопок |

## Если сомневаешься

Есть ADR: [`docs/adr/`](docs/adr/). Нет ADR на «давай виджет на сайт» — значит нельзя. Спроси владельца, не улучшай доктрину.
