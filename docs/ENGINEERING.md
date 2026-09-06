# Инженерия

Эти правила важнее «слоёв ради слоёв». Не плодить 6-уровневый Clean Architecture.

## Модули Nest (`apps/api`)

`Auth` · `Tenancy` (guard membership) · `Projects` · `Documents` · `Remarks` · `Media` · `Rag` · `Diff` · `Llm` · `Agent` · `Observability` · `Gateway`.

Публичные контроллеры тонкие. Запись Remark/Verdict/Run — `RemarksService` (и узкие сервисы рядом: `ImportService`). `AgentService` оркестрирует граф (старт, resume, cancel) и сам ничего не пишет: контроллер и WS-гейтвей зовут его, он — `RemarksService`.

## Паттерны, которые обязательны

1. **Tenancy в SQL.** Каждый `findMany` чанков/remarks: `projectId: ctx.projectId`. Тест: чужой uuid → 0 рядов / 404.
2. **Один путь записи.** Graph node: `this.remarks.applyProposal(...)`. MCP tool: тот же метод. Не `prisma.remark.update` в двух местах.
3. **LLM только в `LlmModule`.** Каждый вызов — span Langfuse (имя ноды, `runId`, `projectId`, model, tokens). Нет `console.log` вместо трейса.
4. **`cannot_tell` — доменный исход.** Не Exception.
5. **Идемпотентность HITL.** Уникальность `(runId, idempotencyKey)`.
6. **Промпт не ACL.** Injection в тексте замечания не должен снять фильтр БД.
7. **Статус пишется условно.** Каждый переход — `RemarksService.transition(tx, id, fromStatuses, …)`: `updateMany` с условием по прежнему статусу внутри транзакции; `count = 0` → 409 «карточка изменилась». Два одновременных решения дают одну запись, а не произвольного победителя (`remarks.integrity.spec`).
8. **Улика — снимок.** `EvidenceCitation` хранит текст цитаты и подпись документа на момент предложения; `chunkId` — живая ссылка с `ON DELETE SET NULL`. Переиндексация ТЗ не отнимает обоснование у принятых и закрытых замечаний.

## Запрещённые паттерны

- Generic `ChatService` без `remarkId`
- `Repository` в MCP, минуя сервис
- Enum статуса «In Progress / Done / Won't Do» как в Jira
- Загрузка всех чанков проекта в промпт «на всякий случай»

## Тесты, без которых нельзя мержить

| Тест | Смысл |
|---|---|
| `tenancy.leakage.spec` | retrieve/tool чужого projectId пустой |
| `verdict.model-cannot-close.spec` | модель не переводит в `closed` |
| `verdict.idempotent.spec` | двойной approve |
| `status.illegal-transition.spec` | developer не закрывает |
| `diff.cannot-compare.spec` | разный размер кадра → cannot_tell |
| `import.missing-description.spec` | строка → `needs_human_parse` |
| `mcp.facade.spec` | tool чужого projectId пуст, `projectId` не аргумент, вердикт только pm, `close` через MCP нет |
| `guardrail.injection.spec` | «забудь ТЗ» не даёт дефект без улик |
| `evals.spec` | golden офлайн через продуктовые сервисы: leakage пуст, injection → не defect, faithfulness 100 %, ретест не `closed`, обе ветки A/B |
| `remarks.integrity.spec` | два одновременных вердикта → один HumanVerdict и 409; цитата переживает reindex |
| `remarks.audience.spec` | заказчик не получает советы, комментарий PM, трейс и черновик до вердикта (REST и WS) |
| `accounts.spec` · `members.spec` · `admin.spec` | контур доступа ADR 006: режимы регистрации, ссылка один раз, отключение и отзыв сессий |

## Именование

Файлы: kebab-case. Классы: `RemarksService`. Статусы и вердикты — как в `docs/STATUS.md`, латиница в коде, не перевод в БД.
