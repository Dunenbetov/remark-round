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

Загрузка файлов: `multipart/form-data`, поле `file`. Скрины — отдельным upload, id кладётся в remark.

## Тело вердикта

```json
{
  "verdict": "defect",
  "comment": "optional",
  "runId": "uuid",
  "idempotencyKey": "uuid"
}
```

`verdict`: `defect | change_request | unspecified | duplicate | cannot_tell | rejected_binding`.

## Чего нет в API

`/sprints`, `/boards`, `/assignees`, `/points`, `/jira`, `/playwright`, `/chat`.
