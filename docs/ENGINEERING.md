# Инженерия

Эти правила важнее «слоёв ради слоёв». Не плодить 6-уровневый Clean Architecture.

## Модули Nest (`apps/api`)

`Auth` · `Tenancy` (guard membership) · `Projects` · `Documents` · `Remarks` · `Media` · `Rag` · `Diff` · `Llm` · `Agent` · `Jobs` · `Notifications` · `Mail` · `Observability` · `Gateway`.

Публичные контроллеры тонкие. Запись Remark/Verdict/Run — `RemarksService` (и узкие сервисы рядом: `ImportService`). `AgentService` оркестрирует граф (старт, resume, cancel) и сам ничего не пишет: контроллер и WS-гейтвей зовут его, он — `RemarksService`.

## Паттерны, которые обязательны

1. **Tenancy в SQL и в схеме.** Каждый `findMany` чанков/remarks: `projectId: ctx.projectId`. Тест: чужой uuid → 0 рядов / 404. Второй эшелон — внешние ключи: `projectId` → `Project` у Remark, AgentRun, DocumentChunk, ImportJob; составной `(roundId, projectId)` → `Round(id, projectId)`, так что замечание не попадёт в раунд чужого проекта даже ручным SQL; ссылки на людей — `ON DELETE SET NULL`; `HumanVerdict.runId` обязателен. Новая тенантная колонка без FK — ошибка ревью.
2. **Один путь записи.** Graph node: `this.remarks.applyProposal(...)`. MCP tool: тот же метод. Не `prisma.remark.update` в двух местах.
3. **LLM только в `LlmModule`.** Каждый вызов — span Langfuse (имя ноды, `runId`, `projectId`, model, tokens). Нет `console.log` вместо трейса.
4. **`cannot_tell` — доменный исход.** Не Exception.
5. **Идемпотентность HITL.** Уникальность `(runId, idempotencyKey)`.
6. **Промпт не ACL.** Injection в тексте замечания не должен снять фильтр БД.
7. **Статус пишется условно.** Каждый переход — `RemarksService.transition(tx, id, fromStatuses, …)`: `updateMany` с условием по прежнему статусу внутри транзакции; `count = 0` → 409 «карточка изменилась». Два одновременных решения дают одну запись, а не произвольного победителя (`remarks.integrity.spec`).
8. **Долгое — в очередь.** Всё, что дольше HTTP-запроса (прогон графа, индексация), — задача `JobsService`, а не `void promise`: задача переживает рестарт, временная ошибка модели повторяется с паузой, отмена снимает задачу. Обработчик регистрирует модуль-владелец в `onModuleInit`; `wait: true` — только для evals и тестов.
9. **История — только дописывается.** Каждый переход оставляет `RemarkStatusChange` в той же транзакции (`transition(...)` → `writeHistory`, `createNumbered`, `failRun`, `cancelRun`): кто — имя снимком, в какой роли, каким прогоном, короткая пометка, слова человека, кадр действия. Postgres не даст поправить строку потом (триггер `rr_append_only`, ADR 011), поэтому всё, что ей нужно, известно в момент вставки: кадр пишется раньше строки. Кадры не удаляются — `supersede(...)` помечает заменённые. Прямой `remark.update({ status })` или `remarkScreenshot.delete*` вне этих мест — ошибка ревью.
10. **Цитата — снимок.** `EvidenceCitation` хранит текст цитаты и подпись документа на момент предложения; `chunkId` — живая ссылка с `ON DELETE SET NULL`. Переиндексация ТЗ не отнимает обоснование у принятых и закрытых замечаний.

## Запрещённые паттерны

- Generic `ChatService` без `remarkId`
- `Repository` в MCP, минуя сервис
- Enum статуса «In Progress / Done / Won't Do» как в Jira
- Загрузка всех чанков проекта в промпт «на всякий случай»

## Тесты, без которых нельзя мержить

| Тест | Смысл |
|---|---|
| `tenancy.leakage.spec` | retrieve/tool чужого projectId пустой |
| `tenancy.sweep.spec` | таблично все проектные маршруты: путь чужого проекта — 404, свой проект + чужой ресурс — 404, чужой ключ кадра — 422; FK не дают записать замечание в раунд чужого проекта мимо сервисов |
| `verdict.model-cannot-close.spec` | модель не переводит в `closed` |
| `verdict.idempotent.spec` | двойной approve |
| `status.illegal-transition.spec` | developer не закрывает |
| `diff.cannot-compare.spec` | разный размер кадра → cannot_tell |
| `import.missing-description.spec` | строка → `needs_human_parse` |
| `mcp.facade.spec` | tool чужого projectId пуст, `projectId` не аргумент, решение только pm, `close` через MCP нет |
| `guardrail.injection.spec` | «забудь ТЗ» не даёт дефект без цитаты |
| `evals.spec` | golden офлайн через продуктовые сервисы: leakage пуст, injection → не defect, faithfulness 100 %, ретест не `closed`, обе ветки A/B |
| `remarks.integrity.spec` | два одновременных решения → один HumanVerdict и 409; цитата переживает reindex |
| `remarks.audience.spec` | заказчик не получает советы, комментарий PM, трейс и черновик до решения PM (REST и WS) |
| `accounts.spec` · `members.spec` · `admin.spec` | контур доступа ADR 006: режимы регистрации, ссылка один раз, отключение и отзыв сессий |
| `remarks.history.spec` | строка на переход с автором, ролью и прогоном; гонка решений не даёт лишней строки; заказчик — без содержания предложений; `AgentRun` хранит предложение после решения |
| `notifications.spec` | ADR 009: письмо получает роль, которую ждёт статус, а не тот, кто нажал; несколько замечаний за окно — одно письмо; выключатель профиля; SMTP-сбой повторяется; приглашение уходит письмом без чужих e-mail |
| `jobs.spec` | очередь: 429 модели повторяется без «не получилось», осиротевшая задача исполняется заново, `run.cancel` снимает задачу, зависший прогон с живой задачей не сметается |

## Именование

Файлы: kebab-case. Классы: `RemarksService`. Статусы и коды решений — как в `docs/STATUS.md`, латиница в коде, не перевод в БД.
