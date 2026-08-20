# Архитектура

Один процесс API, одна БД, один MCP-процесс как фасад. Нет микросервисов.

```mermaid
flowchart LR
  subgraph clients [Клиенты]
    Web[Angular]
    IDE[Cursor / Claude Desktop]
  end

  subgraph compose [Docker Compose]
    Web --> REST[REST JWT]
    Web --> WS[WS комната remark/round]
    REST --> API[NestJS apps/api]
    WS --> API
    IDE --> MCP[apps/mcp]
    MCP --> Domain
    API --> Domain[Доменные сервисы]
    Domain --> PG[(PostgreSQL + pgvector)]
    API --> LG[LangGraph.js in-process]
    LG --> Domain
    API --> LF[Langfuse]
  end
```

## Границы

| Компонент | Можно | Нельзя |
|---|---|---|
| Angular | REST + WS, экраны из `docs/ui` | Свой бизнес-вердикт на клиенте |
| REST | CRUD + команды, которые зовут сервисы | Обходить membership |
| WS | Фазы, токены, HITL на том же `AgentRun` | Глобальный чат |
| `AgentModule` | Ноды графа вызывают сервисы | `prisma.*` в ноде |
| `apps/mcp` | Те же сервисы, что REST | Свой SQL |
| `RagModule` | Search с `WHERE project_id` | Фильтр «в промпте» |
| `DiffModule` | pixelmatch / cannot_compare | Отдать сравнение пикселей в LLM |

## Путь запроса: триаж

```mermaid
sequenceDiagram
  participant B as Бизнес
  participant UI as Angular
  participant API as Nest
  participant G as LangGraph
  participant PM as PM
  participant DB as Postgres

  B->>UI: замечание + скрин
  UI->>API: POST remarks
  API->>G: start run
  G->>DB: retrieve chunks WHERE project_id
  G->>G: vision facts, bind, classify, draft
  G-->>UI: WS run.phase / tokens
  G->>G: interrupt awaiting_pm
  PM->>UI: Approve defect
  UI->>API: WS verdict.approve
  G->>API: RemarksService.applyVerdict
  API->>DB: HumanVerdict + status defect
```

## Путь: ретест

Новый скрин → `DiffModule` → триплет old/new/diff в vision (пояснить, не закрыть) → interrupt `business` → только тогда `closed`.

## Заменяемые куски

- LLM-провайдер за `LlmModule`
- embedding-модель (одна на индекс)
- Langfuse ↔ LangSmith как бэкенд трейсов
- pixelmatch ↔ odiff

Не заменять: pgvector как основное хранилище, HITL, SQL-тенанси.
