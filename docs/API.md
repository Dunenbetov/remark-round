# REST API (черновик контракта)

База: `/api/v1`. Auth: `Authorization: Bearer <jwt>`.  
`projectId` берётся из URL или из membership выбранного проекта. **Нельзя** доверять `projectId` в теле, если он не совпал с membership.

Ошибки: `401` нет токена или он отозван (смена пароля, отключение, «завершить сессии»), `403` нет членства / роли / права, `404` чужой id выглядит как 404 (не светить чужое), `409` нелегальный переход статуса или карточка изменилась параллельно (перечитать), `422` шаблон журнала / валидация / файл не того типа.

Тело любой ошибки одно: `{ statusCode, code, message, requestId }` — `code` для программ (`unauthorized`, `forbidden`, `not_found`, `conflict`, `unprocessable`, `too_many_requests`, `unavailable` — база занята или недоступна, повторить через минуту, `storage_full` — 507: место на сервере или квота проекта на файлы, `internal`…), `message` для людей (строка или список от валидации), `requestId` — тот же, что в заголовке `X-Request-Id` ответа и в строке лога API. Прокси может прислать свой `X-Request-Id` (8–64 символов `[\w.-]`), иначе сервер сгенерирует. Внутренняя ошибка — `500 internal` без подробностей наружу, стек — в логе по `requestId`.

`cannot_tell` — **200** с обычным телом ответа, не 500.

## Ресурсы

| Метод | Путь | Роли | Смысл |
|---|---|---|---|
| POST | `/auth/login` | — | JWT + `user` (`preferredRole`, `canCreateProjects`, `isInstanceAdmin`) + `memberships`. Отключённый администратором — 403. Лимит `THROTTLE_AUTH_LIMIT`/мин с IP |
| POST | `/auth/register` | — | `{ name, email, password ≥ 8, preferredRole: business \| pm \| developer, inviteToken? }` → 201, ответ как у входа; дубликат e-mail — 409. Режим (ADR 006): `open` — всем; `invite_only` (в production по умолчанию) — только с живым `inviteToken` (мёртвая ссылка — 404, аккаунт не создаётся), с домена из `REGISTRATION_DOMAINS` или e-mail из `ADMIN_EMAILS`; иначе 403. Приглашение принимается по ссылке или из колокольчика (`/auth/invitations`, ADR 013) |
| GET | `/auth/me` | any | Свежие `{ user, memberships }` без перелогина — страница ожидания опрашивает это. Membership: `{ projectId, projectName, projectSlug, role }`; `projectSlug` — первый сегмент адреса SPA |
| PATCH | `/auth/profile` | any | `{ name?, preferredRole? }` |
| POST | `/auth/password` | any | `{ current, next ≥ 8 }` → `{ accessToken }`; неверный текущий — 422; все прежние токены (и MCP) недействительны |
| GET | `/auth/invitations` | any | Колокольчик (ADR 013): живые приглашения в проекты на e-mail вошедшего, старые сверху — `[{ id, projectId, projectName, projectSlug, role, inviterName, createdAt, expiresAt }]`. Приглашения руководителя без проекта сюда не попадают. MCP-токен — 404 |
| POST | `/auth/invitations/:invitationId/accept` | any | Принять → 200 `{ user, memberships }` (как `/invitations/:token/accept`); не на мой e-mail, неизвестное или истёкшее — 404, уже принятое — 410 |
| POST | `/auth/invitations/:invitationId/decline` | any | Отклонить → 204, строка приглашения удаляется; те же 404 и 410 |
| GET | `/auth/notifications?limit=30&before=<id>` | any | Колокольчик о замечаниях (ADR 016): `{ items: NotificationView[], unread, hasMore }`, от новых к старым; `limit` 1…50 (по умолчанию 30), `before` — id последней строки предыдущей страницы. Только свои строки в текущей роли в проекте. MCP-токен — 404 |
| POST | `/auth/notifications/read` | any | Ровно одно из `{ ids: uuid[] ≤ 100 }`, `{ remarkId }`, `{ all: true }` (иначе 422) → 200 `{ unread }`; чужие id не трогаются; остальным вкладкам — `notification.read` по WS. MCP-токен — 404 |
| POST | `/auth/reset` | — | `{ token, password ≥ 8 }` → 204: пароль заменён, все прежние токены (и MCP) недействительны, сессия не выдаётся — вход на `/login`; неизвестная или истёкшая ссылка — 404, использованная — 410. Ссылку выдаёт администратор инстанса (`/admin/users/:userId/reset-link`, ADR 013) |
| GET | `/auth/options` | — | `{ demoLogins, registration: open \| invite_only, release, demoAccounts?, demoPassword?, sentryDsn? }` — карточки демо-персон на входе приходят только при `demoLogins` (в production выключены), режим регистрации, версия сборки, DSN Sentry для SPA (только при `SENTRY_DSN_WEB`) |
| GET | `/projects` | any | Список membership: `{ id, name, slug, role, createdAt }` |
| POST | `/projects` | `canCreateProjects` | Создать: только с правом от администратора инстанса (иначе 403); создатель становится `pm` проекта. `slug` — транслит названия (`Клиентский кабинет` → `klientskiy-kabinet`), занятый — с суффиксом `-2`; при переименовании не меняется |
| GET | `/projects/:projectId` | member | Карточка |
| GET | `/projects/:projectId/members` | pm, admin | `{ members[], invitations[] }` — участники и ожидающие приглашения `{ id, email, role, inviteeName, createdAt, expiresAt }` (без токена: в БД только хэш; `inviteeName` — имя аккаунта на этот e-mail или `null`, ADR 013) |
| POST | `/projects/:projectId/members` | pm, admin | `{ email, role: business \| pm \| developer }` (проектная роль `admin` снаружи не выдаётся — путалась с администратором инстанса; в enum остаётся до миграции после беты): уже участник → `{ kind: 'member', member }` — роль меняется (последний pm — 409); любой другой, зарегистрированный или нет (ADR 013), → `{ kind: 'invitation', invitation }` с `inviteeName` и сырым `token` для `/join/<token>` — показывается один раз; зарегистрированный видит приглашение в колокольчике. Напрямую в проект никого не записываем; e-mail администратора инстанса — 409 «Администратор инстанса не участвует в проектах» (ADR 006, 20.09); принять проектное приглашение он тоже не может — 409 |
| PATCH | `/projects/:projectId/members/:userId` | pm, admin | `{ role: business \| pm \| developer }`; единственный pm не понижается — 409; сокеты человека выкидываются из комнат проекта (роль на join закеширована) |
| DELETE | `/projects/:projectId/members/:userId` | pm, admin | 204; единственный pm — 409; сокеты удалённого выкидываются из комнат проекта |
| DELETE | `/projects/:projectId/invitations/:invitationId` | pm, admin | Отозвать ссылку |
| POST | `/projects/:projectId/invitations/:invitationId/link` | pm, admin | «Новая ссылка»: `{ token, expiresAt }` один раз; прежняя перестаёт работать, срок продлевается (7 дней) |
| GET | `/invitations/:token` | — | Что за приглашение: `{ kind: project \| instance, projectName, role, inviterName, expiresAt }` (e-mail приглашённого не показывается; `instance` — приглашение руководителя от администратора, `projectName: null`); принятое — 410, неизвестное или истёкшее (7 дней) — 404 |
| POST | `/invitations/:token/accept` | any | Принять по ссылке вошедшим пользователем (e-mail может отличаться) → `{ user, memberships }`; два параллельных принятия одной ссылки — одно 200, второе 410 |
| POST | `/projects/:projectId/mcp-token` | member | Токен для MCP-фасада (`apps/mcp`): JWT с `projectId` из membership, срок `MCP_TOKEN_EXPIRES_SECONDS` (30 дней). С ним существует только `/projects/:projectId/*` этого проекта: другой проект, `/projects`, `/auth/*`, `/invitations/*`, `/admin/*` — 404, даже при membership. Смена пароля, отключение и «завершить сессии» отзывают и его |
| GET | `/admin/users` | администратор инстанса | Люди поперёк проектов: `{ id, email, name, preferredRole, canCreateProjects, isInstanceAdmin, disabledAt, createdAt, memberships[] }`. Остальным — 403 (проектная роль `admin` — тоже) |
| GET | `/admin/projects` | администратор инстанса | `{ id, name, createdAt, members }` по всем проектам |
| PATCH | `/admin/users/:userId` | администратор инстанса | `{ canCreateProjects?, disabled? }`; отключение — вход 403, все токены и сокеты недействительны сразу; себя — 409 |
| POST | `/admin/users/:userId/revoke-sessions` | администратор инстанса | 204: все токены человека (и MCP) — 401, он входит заново |
| POST | `/admin/users/:userId/reset-link` | администратор инстанса | 200 `{ token, expiresAt }` (ADR 013): одноразовая ссылка `/reset/<token>` на 24 часа, сырой токен один раз; прежние неиспользованные ссылки человека гаснут; неизвестный — 404, отключённый — 409 |
| GET | `/admin/invitations` | администратор инстанса | Ожидающие приглашения руководителей приёмки без проекта (ADR 006, 17.09): `{ id, email, role: 'pm', inviteeName, createdAt, expiresAt }` без токена |
| POST | `/admin/invitations` | администратор инстанса | `{ email }`: зарегистрированный → `{ kind: 'user', user }` — право создавать проекты выдано сразу; незнакомый → `{ kind: 'invitation', invitation }` с сырым `token` один раз; повтор на тот же e-mail выпускает новую ссылку. Принятие по ссылке ставит `canCreateProjects`, membership не создаёт |
| DELETE | `/admin/invitations/:invitationId` | администратор инстанса | Отозвать; 204 |
| POST | `/admin/invitations/:invitationId/link` | администратор инстанса | «Новая ссылка»: `{ token, expiresAt }`; прежняя перестаёт работать |
| GET | `/projects/:projectId/documents` | member | Пакет документов — читает вся команда, включая разработчика (20.09) |
| POST | `/projects/:projectId/documents` | admin, pm | Загрузка; заказчику и разработчику — 403 |
| GET | `/projects/:projectId/documents/:id` | member | Мета + статус индекса одного документа (фронт берёт список; маршрут держат спеки и внешние клиенты) |
| GET | `/projects/:projectId/documents/:id/file` | member | Файл как загрузили: `Content-Disposition: attachment` с именем по RFC 5987 (кириллица), `Cache-Control: private, no-store`, CSP `sandbox` — скачать, не открыть (20.09) |
| POST | `/projects/:projectId/documents/:id/reindex` | admin, pm | |
| GET/POST | `/projects/:projectId/rounds` | member POST: pm/business | Раунды: `{ id, number, status, remarks, pending, closed, changeRequests, duplicates, createdAt, closedAt, closedByName, closedByRole }`; `pending` — нерешённые замечания (всё, кроме `closed` / `change_request` / `duplicate`); кто закрыл — имя и роль на момент закрытия (событие раунда, ADR 011). Каждое открытие, закрытие и повторное открытие пишет `RoundEvent`. Новый раунд — 409, пока в проекте есть нерешённые: «Новый раунд можно открыть, когда в раунде N не останется нерешённых замечаний (ещё K)» |
| POST | `/projects/:projectId/rounds/:roundId/close` | pm, business | «Здесь мы остановились»: только когда все замечания решены (`closed` / `change_request` / `duplicate`), иначе 409 с перечнем нерешённого. Закрытый раунд — только для чтения: нельзя добавить замечание, импортировать журнал и связать повтор (409) |
| POST | `/projects/:projectId/rounds/:roundId/reopen` | pm, business | Открыть раунд снова |
| GET | `/projects/:projectId/rounds/export.xlsx` | pm, business, admin | Журнал приёмки всего проекта (ADR 011): листы «Раунды» (открыт, закрыт, кто закрыл, всего / закрыто / новые желания / повторы / не решено), «Замечания» (кто создал, решил, исправил, закрыл — с датами; как закрыто; повтор претензии; ссылка на карточку), «История» (строка на действие и событие раунда). Даты — даты Excel в поясе `REPORT_TIMEZONE`, смещение в шапке («Когда (GMT+5)»); фильтр и закреплённая шапка на каждом листе. Заказчику — без комментариев команды и предложений модели (ADR 007). Разработчику — 403 |
| GET | `/projects/:projectId/rounds/:roundId/export.xlsx` | pm, business, admin | Тот же журнал, ограниченный одним раундом — итог раунда для акта |
| POST | `/projects/:projectId/remarks/:id/reopen` | business | `{ roundId, screenshotKey? }` — повтор закрытой претензии в открытом раунде: новое замечание `reopened` с `origin` (оригинал получает `reopenedBy`); дальше обычный `triage` |
| GET | `/projects/:projectId/rounds/:roundId/remarks` | по роли фильтр | Список. Developer — только defect+ |
| POST | `/projects/:projectId/rounds/:roundId/remarks` | business, pm | Ручное замечание + upload screenshot |
| GET | `/projects/:projectId/remarks/:remarkId` | member + ACL очереди | Карточка; `runFailure` — причина последнего сбоя прогона по-русски (модель перегружена, ключ не принят, файл не найден…). Developer — defect+ и `awaiting_pm` (чтобы посоветовать); в ответе `advice[]` — советы разработчиков. Заказчику (business) карточка собирается без `advice`, `verdict.comment`, `traceUrl`, `proposedClass`, а `draft`/`seen` — только после решения PM (ADR 007); то же для списков |
| GET | `/projects/:projectId/remarks/at/:roundNumber/:number` | member + ACL очереди | Та же карточка по номеру раунда и номеру замечания — для адреса SPA `/<slug>/round-2/12`; нет такого номера или роль его не видит — 404 |
| GET | `/projects/:projectId/remarks/:remarkId/history` | member + ACL карточки | История (ADR 011): `[{ at (ISO), action, fromStatus?, toStatus, by?: { userId?, name, role }, runId?, detail?, comment?, shot?: { kind, url, current } }]` — строка на каждое действие (create, import, reopen, reopened_as, fix_row, attach_screenshot, triage, proposal, rejected_binding, verdict, link_duplicate, ready_for_retest, retest, retest_result, close, not_fixed, cancel, run_failed); `by.name` — имя на момент действия, `by` пуст — действие системы; `shot` — кадр действия, `current: false` — его потом заменили. Заказчику не отдаются `detail` предложений модели и `comment` команды (ADR 007) |
| GET | `/projects/:projectId/advisory-queue` | developer | Что сейчас на приёмке у PM (`awaiting_pm`) — можно посоветовать; не очередь работы |
| PUT | `/projects/:projectId/remarks/:id/advice` | developer | `{ code, comment? }` — совет PM (`code` — те же пять кнопок, без `duplicate`; ≤ 500 символов). Один на человека: повтор меняет. Только для `awaiting_pm`, иначе 409. Статус не меняет; в комнату уходит `remark.advice` |
| DELETE | `/projects/:projectId/remarks/:id/advice` | developer | Снять свой совет; тоже `remark.advice` |
| POST | `/projects/:projectId/imports` | business, pm | Журнал по шаблону: multipart `file` (.xlsx или .csv) + `roundId`. Чужая шапка → 422; длиннее `IMPORT_MAX_ROWS` строк (500, на бете 100) → 422 «разбейте файл»; тяжелее `IMPORT_MAX_BYTES` (20 МБ, на бете 5) → 413 |
| GET | `/projects/:projectId/imports/:jobId` | member | Строки: `parsed` vs `needs_human_parse`, номер и статус замечания по каждой |
| GET | `/projects/:projectId/imports/template.xlsx` | member | «Скачать шаблон журнала» (есть и `template.csv`) |
| POST | `/projects/:projectId/remarks/:id/fix-row` | business, pm | «Допишите строку журнала»: `{ description, pageOrScreen?, expected? }`, `needs_human_parse` → разбор |
| POST | `/projects/:projectId/remarks/:id/triage` | pm, business | Старт AgentRun: ответ сразу `triaging` + `runId`, фазы — в комнате WS. `409 llm_budget` — проект исчерпал суточный лимит стоимости модели (`GRAPH_DAILY_USD_PER_PROJECT`); прогон дольше `GRAPH_RUN_TIMEOUT_MS` падает с `runFailure` «не уложился» (код `timeout`) |
| POST | `/projects/:projectId/remarks/:id/verdict` | pm | HITL (дубль WS, идемпотентно). `rejected_binding` отвечает `triaging`: тот же run продолжает цикл bind |
| POST | `/projects/:projectId/remarks/:id/cancel` | pm, business | `{ runId, idempotencyKey }` — дубль `run.cancel`: решения нет, run = cancelled, замечание → `imported` |
| POST | `/projects/:projectId/remarks/:id/ready-for-retest` | developer | |
| POST | `/projects/:projectId/remarks/:id/retest` | business | Новый скрин `{ screenshotKey }` → граф ретеста в фоне (ответ: `ready_for_retest`, `runMode: retest`, `runStatus: running`; фаза `diffing` в комнате) → pixel-diff + explain: кадр `diff` в `screenshots`, `retest.outcome` (`likely_addressed` / `likely_unchanged` / `cannot_tell`), `retest.explanation` по-русски, статус `awaiting_business_close`. Разный размер, формат не PNG/JPG, слишком разные кадры → `cannot_tell` с причиной, без диффа. `409 llm_budget` — суточный лимит стоимости модели проекта исчерпан |
| POST | `/projects/:projectId/remarks/:id/close` | business | `{ comment? }` (до 2000). Из `awaiting_business_close` — после ретеста; из `ready_for_retest` — заказчик проверил сам, без нового кадра (ADR 010). Пока кадры сравниваются — 409. Ответ: `closed`, `closedVia` (`retest` / `business_check`), `closeComment` |
| GET | `/projects/:projectId/dev-queue` | developer | defect + ready_for_retest |
| GET | `/projects/:projectId/search?q=&k=` | member | Поиск по пакету документов с цитатой: `{ query, hits[], boundScore }`. `hits` — top-k ближайших фрагментов (`k` 1–20, по умолчанию 5) без отсечения: раздел, фрагмент, `score` — косинусная близость 0–1. `boundScore` (с 18.09.2026, поле добавлено, старые не менялись) — близость, с которой фрагмент считается опорой: тот же `BOUND_SCORE`, по которому граф привязывает замечание к пункту ТЗ (`apps/api/src/llm/triage-llm.ts`, сейчас 0.45). Фильтровать или помечать по нему решает клиент — так делает MCP `search_spec` |
| POST | `/projects/:projectId/media` | member | Скрин: multipart `file` (PNG, JPG, WebP, GIF, до 10 МБ; SVG не принимается) → `{ storageKey, url }`. `screenshotKey` в телах замечания/ретеста принимается только своего проекта и существующий — иначе 422 |
| GET | `/projects/:projectId/media/:fileName` | member | Отдача кадра; путь всегда внутри проекта |
| POST | `/projects/:projectId/remarks/:id/screenshot` | business, pm | Кадр по «Не хватает скрина» → новый разбор |
| POST | `/projects/:projectId/remarks/:id/not-fixed` | business | «Не исправлено» → обратно в defect. Только после ретеста с новым кадром: из `ready_for_retest` — 409 |
| POST | `/projects/:projectId/remarks/:id/link-duplicate` | pm | `{ duplicateOfNumber }` |

Загрузка файлов: `multipart/form-data`, поле `file`. Скрины — отдельным upload, id кладётся в remark.

Импорт журнала: `POST /projects/:projectId/imports` принимает только официальный шаблон (шапка по-русски: `№ · Где · Что не так · Как должно быть · Важность · Скрин`; внутренние ключи `external_id, page_or_screen, description, expected, severity, screenshot` — `apps/api/src/imports/journal-template.ts`; прежняя английская шапка тоже принимается; порядок любой, регистр, «ё» и пробелы не важны, CSV с `,` или `;`, UTF-8 (с BOM или без) или windows-1251). `GET .../imports/template.xlsx|csv` отдают шаблон с русской шапкой (csv — BOM + `;`, чтобы Excel открыл по колонкам). Другая шапка — 422 с перечнем недостающих и лишних колонок, ни одной строки не создаётся. Каждая строка становится замечанием: с описанием — `imported` и разбор в фоне (статус виден в `GET .../imports/:jobId` и в журнале), без описания — `needs_human_parse` с причиной в `reason`; ячейки хранятся как есть в `ImportRow.rawJson`. Картинка в ячейке xlsx становится кадром замечания; ссылка в колонке `screenshot` CSV не загружается — кадр прикрепляют на карточке. Ответ 201 — `ImportJobView` (`apps/api/src/imports/import.dto.ts`).

Документы: `POST /projects/:projectId/documents` — поля `file` (PDF, DOCX, DOC — Word 97-2003, Markdown, текст; до 20 МБ; тип проверяется по содержимому, иначе 422 со списком форматов), `kind` (`spec | protocol | addendum | journal_source`), необязательный `effectiveAt` (ISO-дата). Ответ 201 со статусом `uploaded`; индексация идёт в фоне: `parsed` → `indexed` | `failed`, статус и число чанков видны в `GET .../documents`.

## Аккаунты (фаза 11, ADR 005)

Регистрация открыта: без проекта человек видит экран ожидания и опрашивает `GET /auth/me` — как только человек примет приглашение (ссылкой или в колокольчике — `GET /auth/invitations`), проект появится. Сторона `preferredRole` — подсказка (и право создавать проекты для `pm`); роль в проекте — всегда `Membership.role`, её ставит PM. Приглашение — ссылка `/join/<token>`: писем нет (ADR 013), PM копирует и шлёт сам; зарегистрированный на этот e-mail принимает и из колокольчика. Ошибки: 409 — e-mail занят или единственный pm; 410 — ссылка уже принята; 422 — неверный текущий пароль или валидация.

## Тело решения (`verdict`)

```json
{
  "verdict": "defect",
  "comment": "optional",
  "runId": "uuid",
  "idempotencyKey": "uuid"
}
```

`verdict`: `defect | change_request | unspecified | duplicate | cannot_tell | rejected_binding`. Для `duplicate` можно передать `duplicateOfNumber`. `runId` берётся из ответа замечания (`runId`); повтор с тем же `idempotencyKey` возвращает тот же результат без второго решения.

## Тело замечания

`POST /projects/:projectId/rounds/:roundId/remarks` — JSON `{ "description", "pageOrScreen"?, "expected"?, "screenshotKey"? }`. Сервер создаёт замечание и запускает граф разбора; ответ приходит сразу — статус `triaging`, `runId`, `runStatus: running`. Фазы прогона (`retrieving` → `vision` → `binding` → `drafting` → `awaiting_pm`) идут в комнату WS (`docs/WS.md`); когда прогон дошёл до interrupt, `GET .../remarks/:id` отдаёт `awaiting_pm` с `proposedClass`, `draft[]`, `citations[]`, `seen` (факты кадра) и тем же `runId`. Форма ответа — `apps/api/src/remarks/remark.dto.ts` (`RemarkView`), она же модель `Remark` на фронте. Если настроен Langfuse (фаза 8), карточка несёт `traceUrl` — ссылку на trace текущего прогона (`AgentRun`); фронт показывает её PM в подвале карточки. `advice[]` — советы разработчиков (`AdviceView`: `code`, `userId`, `userName`, `role`, `at`, `comment?`); рядом с именами людей карточка отдаёт и роль в проекте (`authorRole`, `fixedByRole`, `closedByRole`, `verdict.userRole`) — людей на одной стороне может быть несколько. Времена (`verdict.at`, `advice[].at`, `closedAt`, `createdAt`, `updatedAt`) — ISO 8601, дату и время форматирует клиент. `screenshots[]` — только текущие кадры: заменённые остаются в базе и в истории. У закрытого замечания — `closedVia` (`retest` — после нового кадра и диффа, `business_check` — заказчик проверил сам) и `closeComment`; оба читаются из строки истории `close`. Те же правила у `fix-row`, `screenshot`, `triage`: они отвечают `triaging`.

## Чего нет в API

`/sprints`, `/boards`, `/assignees`, `/points`, `/jira`, `/playwright`, `/chat`.

## MCP (`apps/mcp`)

Тот же контракт для Cursor / Claude Code / Claude Desktop, без второго CRUD: tool'ы фасада зовут маршруты выше с токеном из `POST /projects/:projectId/mcp-token`. `search_spec` = `GET .../search`: опорой помечает только фрагменты с `score ≥ boundScore`, остальные — «ниже порога, опорой считать нельзя»; если выше порога ничего нет, отвечает «Опоры нет» без фрагментов (API без `boundScore` — запасной порог 0.45). `get_round_remarks` = `GET .../rounds` + `GET .../rounds/:roundId/remarks`, `apply_human_verdict` = `GET .../remarks/:id` + `POST .../remarks/:id/verdict` (фасад подставляет `runId` и `idempotencyKey`), `submit_retest_evidence` = `POST .../media` + `POST .../remarks/:id/retest`. `projectId` в аргументах tool'ов нет — он в токене. `close` через MCP недоступен. Подробнее: [`apps/mcp/README.md`](../apps/mcp/README.md).

## Уведомления

Писем нет (ADR 013 заменил ADR 009). Очередь человека — журнал («ждут меня»); колокольчик указывает на неё (ADR 016): приглашения — `GET /auth/invitations`, события по замечаниям — `GET /auth/notifications`.

```ts
type NotificationView = {
  id: string;
  kind: 'action' | 'info';            // «ждёт вас» | «к сведению» — из правил notifications/audience.ts и роли адресата
  at: string;                         // ISO, момент события (строка истории)
  readAt: string | null;
  project: { id: string; name: string; slug: string };
  remark: { id: string; number: number; roundNumber: number; title: string | null; status: RemarkStatus; readable: boolean };
  event: { action: string; fromStatus: RemarkStatus | null; toStatus: RemarkStatus };
  by: { name: string; role: Role | null } | null;   // null — система (разбор, сравнение кадров); имя — снимок истории
};
```

- `remark.status` — текущий статус, не статус на момент события. `readable` — может ли адресат сейчас открыть карточку (разработчик — `defect`, `ready_for_retest`, `awaiting_pm`; остальные — всегда); при `false` `title` — `null`.
- Ни комментариев, ни пометок истории, ни предложения модели, черновика, цитат, советов и `runId` — ни для одной роли (ADR 007).
- Кому что: `proposal` → руководителю (и legacy `admin`) «ждёт вас»; решение `defect` → разработчику «ждёт вас», заказчику «к сведению»; `change_request`, `duplicate` → заказчику «к сведению»; `unspecified`, `cannot_tell` → заказчику «ждёт вас»; «Готово» и итог сравнения кадров → заказчику «ждёт вас»; «не исправлено» → разработчику «ждёт вас», заказчику «к сведению»; закрытие → заказчику «к сведению». Автор действия и отключённые не получают; действие человека по замечанию гасит его непрочитанные по этому замечанию.
- Видны строки только проектов, где человек сейчас участник, и только его текущей роли: после удаления из проекта или смены роли прежние строки пропадают (фильтр в SQL).
- Толчки по WS — комната `user:{id}` (`docs/WS.md`); правда — этот список, клиент сверяется с ним при подключении сокета.
