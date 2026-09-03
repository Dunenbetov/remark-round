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
| POST | `/projects/:projectId/imports` | business, pm | Журнал по шаблону: multipart `file` (.xlsx или .csv) + `roundId`. Чужая шапка → 422 |
| GET | `/projects/:projectId/imports/:jobId` | member | Строки: `parsed` vs `needs_human_parse`, номер и статус замечания по каждой |
| GET | `/projects/:projectId/imports/template.xlsx` | member | «Скачать шаблон журнала» (есть и `template.csv`) |
| POST | `/projects/:projectId/remarks/:id/fix-row` | business, pm | «Допишите строку журнала»: `{ description, pageOrScreen?, expected? }`, `needs_human_parse` → разбор |
| POST | `/projects/:projectId/remarks/:id/triage` | pm, business | Старт AgentRun: ответ сразу `triaging` + `runId`, фазы — в комнате WS |
| POST | `/projects/:projectId/remarks/:id/verdict` | pm | HITL (дубль WS, идемпотентно). `rejected_binding` отвечает `triaging`: тот же run продолжает цикл bind |
| POST | `/projects/:projectId/remarks/:id/cancel` | pm, business | `{ runId, idempotencyKey }` — дубль `run.cancel`: вердикта нет, run = cancelled, замечание → `imported` |
| POST | `/projects/:projectId/remarks/:id/ready-for-retest` | developer | |
| POST | `/projects/:projectId/remarks/:id/retest` | business | Новый скрин `{ screenshotKey }` → граф ретеста в фоне (ответ: `ready_for_retest`, `runMode: retest`, `runStatus: running`; фаза `diffing` в комнате) → pixel-diff + explain: кадр `diff` в `screenshots`, `retest.outcome` (`likely_addressed` / `likely_unchanged` / `cannot_tell`), `retest.explanation` по-русски, статус `awaiting_business_close`. Разный размер, формат не PNG/JPG, слишком разные кадры → `cannot_tell` с причиной, без диффа |
| POST | `/projects/:projectId/remarks/:id/close` | business | Только после ретест-улик |
| GET | `/projects/:projectId/dev-queue` | developer | defect + ready_for_retest |
| GET | `/projects/:projectId/search?q=&k=` | member | Поиск по пакету документов с цитатой (раздел, фрагмент, score). То же, что MCP `search_spec` |
| POST | `/projects/:projectId/media` | member | Скрин: multipart `file` (PNG, JPG, WebP, GIF, SVG, до 10 МБ) → `{ storageKey, url }` |
| GET | `/projects/:projectId/media/:fileName` | member | Отдача кадра; путь всегда внутри проекта |
| POST | `/projects/:projectId/remarks/:id/screenshot` | business, pm | Кадр по «Не хватает скрина» → новый разбор |
| POST | `/projects/:projectId/remarks/:id/not-fixed` | business | «Не исправлено» → обратно в defect |
| POST | `/projects/:projectId/remarks/:id/link-duplicate` | pm | `{ duplicateOfNumber }` |

Загрузка файлов: `multipart/form-data`, поле `file`. Скрины — отдельным upload, id кладётся в remark.

Импорт журнала: `POST /projects/:projectId/imports` принимает только официальный шаблон (колонки `external_id, page_or_screen, description, expected, severity, screenshot` — `apps/api/src/imports/journal-template.ts`; порядок любой, регистр не важен, CSV с `,` или `;`, UTF-8 или windows-1251). Другая шапка — 422 с перечнем недостающих и лишних колонок, ни одной строки не создаётся. Каждая строка становится замечанием: с описанием — `imported` и разбор в фоне (статус виден в `GET .../imports/:jobId` и в журнале), без описания — `needs_human_parse` с причиной в `reason`; ячейки хранятся как есть в `ImportRow.rawJson`. Картинка в ячейке xlsx становится кадром замечания; ссылка в колонке `screenshot` CSV не загружается — кадр прикрепляют на карточке. Ответ 201 — `ImportJobView` (`apps/api/src/imports/import.dto.ts`).

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

`POST /projects/:projectId/rounds/:roundId/remarks` — JSON `{ "description", "pageOrScreen"?, "expected"?, "screenshotKey"? }`. Сервер создаёт замечание и запускает граф разбора; ответ приходит сразу — статус `triaging`, `runId`, `runStatus: running`. Фазы прогона (`retrieving` → `vision` → `binding` → `drafting` → `awaiting_pm`) идут в комнату WS (`docs/WS.md`); когда прогон дошёл до interrupt, `GET .../remarks/:id` отдаёт `awaiting_pm` с `proposedClass`, `draft[]`, `citations[]`, `seen` (факты кадра) и тем же `runId`. Форма ответа — `apps/api/src/remarks/remark.dto.ts` (`RemarkView`), она же модель `Remark` на фронте. Те же правила у `fix-row`, `screenshot`, `triage`: они отвечают `triaging`.

## Чего нет в API

`/sprints`, `/boards`, `/assignees`, `/points`, `/jira`, `/playwright`, `/chat`.
