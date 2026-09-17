# AGENTS.md — вход для любого агента

Ты пишешь **RemarkRound**, не helpdesk, не Jira, не чат с PDF.

## Обязательно прочитай до первого diff

1. [`REMARKROUND.md`](REMARKROUND.md) — доктрина §2 и запреты §15.
2. [`docs/BETA-REVIEW.md`](docs/BETA-REVIEW.md) — актуальный список работ и «Ход работ» в начале; фазы 0–11 закрыты, их история — [`docs/archive/PHASES.md`](docs/archive/PHASES.md). Правила исполнителя — раздел 0 ревью.
3. Контракты: [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma), [`docs/API.md`](docs/API.md), [`docs/WS.md`](docs/WS.md), [`docs/GRAPH.md`](docs/GRAPH.md), [`docs/STATUS.md`](docs/STATUS.md).
4. Если трогаешь `apps/web`: [`docs/ui/COPY.md`](docs/ui/COPY.md), [`docs/ui/VISUAL.md`](docs/ui/VISUAL.md), [`docs/ui/ANTI.md`](docs/ui/ANTI.md), токены — только [`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css). Эталон дизайна «Arc · Индиго» — само приложение. Промпт: [`docs/ui/AGENT-PROMPT.md`](docs/ui/AGENT-PROMPT.md).

## Доктрина в одном абзаце

ТЗ не решает. Решает человек. Система собирает опору (чанки пакета документов, скрин, pixel-diff) и имеет право сказать `cannot_tell` / `unspecified`. `unspecified` ≠ change request. Превращение в работу разработчика — только `HumanVerdict` PM; закрытие — только кнопка заказчика (после ретеста или, если проверил сам, без нового кадра — ADR 010). Чужой `projectId` режется SQL, не промптом.

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
| Карточка как в `docs/ui/VISUAL.md` и в приложении | Канбан, ChatGPT-чат, Material фиолет, синонимы кнопок |

## Если сомневаешься

Есть ADR: [`docs/adr/`](docs/adr/). Нет ADR на «давай виджет на сайт» — значит нельзя. Спроси владельца, не улучшай доктрину.
