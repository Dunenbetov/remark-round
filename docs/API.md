# REST API (черновик контракта)

База: `/api/v1`. Auth: `Authorization: Bearer <jwt>`.  
`projectId` берётся из URL или из membership выбранного проекта. **Нельзя** доверять `projectId` в теле, если он не совпал с membership.

Ошибки: `401` нет токена, `403` нет членства / роли, `404` чужой id выглядит как 404 (не светить чужое), `409` нелегальный переход статуса, `422` шаблон журнала / валидация.

`cannot_tell` — **200** с телом вердикта, не 500.

## Ресурсы

| Метод | Путь | Роли | Смысл |
|---|---|---|---|
| POST | `/auth/login` | — | JWT |
| GET | `/projects` | any | Список membership |
| POST | `/projects` | — | Создать (пилот: любой залогиненный / admin) |
| GET | `/projects/:projectId` | member | Карточка |
| GET/POST | `/projects/:projectId/members` | admin | Membership |
| GET/POST | `/projects/:projectId/documents` | admin, pm | Пакет документов |
| GET | `/projects/:projectId/documents/:id` | member | Мета + статус индекса |
| POST | `/projects/:projectId/documents/:id/reindex` | admin | |
| GET/POST | `/projects/:projectId/rounds` | member POST: pm/business | Раунды |
| GET | `/projects/:projectId/rounds/:roundId/remarks` | по роли фильтр | Список. Developer — только defect+ |
| POST | `/projects/:projectId/rounds/:roundId/remarks` | business, pm | Ручное замечание + upload screenshot |
| GET | `/projects/:projectId/remarks/:remarkId` | member + ACL очереди | Карточка |
| POST | `/projects/:projectId/imports` | business, pm | xlsx шаблон |
| GET | `/projects/:projectId/imports/:jobId` | member | parsed vs needs_human_parse |
| POST | `/projects/:projectId/remarks/:id/triage` | pm, business | Старт AgentRun |
| POST | `/projects/:projectId/remarks/:id/verdict` | pm | HITL (дубль WS, идемпотентно) |
| POST | `/projects/:projectId/remarks/:id/ready-for-retest` | developer | |
| POST | `/projects/:projectId/remarks/:id/retest` | business | Новый скрин, запуск диффа+explain |
| POST | `/projects/:projectId/remarks/:id/close` | business | Только после ретест-улик |
| GET | `/projects/:projectId/dev-queue` | developer | defect + ready_for_retest |
| GET | `/projects/:projectId/search?q=&k=` | member | Поиск по пакету документов с цитатой (раздел, фрагмент, score). То же, что MCP `search_spec` |
| POST | `/projects/:projectId/media` | member | Скрин: multipart `file` (PNG, JPG, WebP, GIF, SVG, до 10 МБ) → `{ storageKey, url }` |
| GET | `/projects/:projectId/media/:fileName` | member | Отдача кадра; путь всегда внутри проекта |
| POST | `/projects/:projectId/remarks/:id/screenshot` | business, pm | Кадр по «Не хватает скрина» → новый разбор |
| POST | `/projects/:projectId/remarks/:id/not-fixed` | business | «Не исправлено» → обратно в defect |
| POST | `/projects/:projectId/remarks/:id/link-duplicate` | pm | `{ duplicateOfNumber }` |

Загрузка файлов: `multipart/form-data`, поле `file`. Скрины — отдельным upload, id кладётся в remark.

Документы: `POST /projects/:projectId/documents` — поля `file` (PDF, DOCX, Markdown, текст, до 20 МБ), `kind` (`spec | protocol | addendum | journal_source`), необязательный `effectiveAt` (ISO-дата). Ответ 201 со статусом `uploaded`; индексация идёт в фоне: `parsed` → `indexed` | `failed`, статус и число чанков видны в `GET .../documents`.

## Тело вердикта

```json
{
  "verdict": "defect",
  "comment": "optional",
  "runId": "uuid",
  "idempotencyKey": "uuid"
}
```

`verdict`: `defect | change_request | unspecified | duplicate | cannot_tell | rejected_binding`. Для `duplicate` можно передать `duplicateOfNumber`. `runId` берётся из ответа замечания (`runId`); повтор с тем же `idempotencyKey` возвращает тот же результат без второго вердикта.

## Тело замечания

`POST /projects/:projectId/rounds/:roundId/remarks` — JSON `{ "description", "pageOrScreen"?, "expected"?, "screenshotKey"? }`. Сервер сразу запускает разбор (заглушка фазы 3, граф в фазе 6) и отвечает замечанием в `awaiting_pm` с `proposedClass`, `draft[]`, `citations[]` и `runId`. Форма ответа — `apps/api/src/remarks/remark.dto.ts` (`RemarkView`), она же модель `Remark` на фронте.

## Чего нет в API

`/sprints`, `/boards`, `/assignees`, `/points`, `/jira`, `/playwright`, `/chat`.
