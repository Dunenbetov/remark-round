# REST API

База: `/api/v1`. Авторизация: `Authorization: Bearer <jwt>`.

`projectId` берется из URL и сверяется с membership пользователя. Значению `projectId` из тела запроса сервер не доверяет.

Ошибки:

- `401`: нет токена, или он отозван (смена пароля, отключение, "Завершить сессии").
- `403`: у пользователя нет нужной роли или права.
- `404`: чужой проект или чужой id. Сервер не подтверждает, что они существуют.
- `409`: недопустимый переход статуса, или карточка изменилась параллельно. Клиент перечитывает ее.
- `422`: не тот шаблон журнала, ошибка валидации, файл не того типа.

Тело любой ошибки: `{ statusCode, code, message, requestId }`.

- `code` для программ. По статусу: `bad_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404, `conflict` 409, `gone` 410, `too_large` 413, `unprocessable` 422, `too_many_requests` 429, `internal` 500, `unavailable` 503 (база занята или недоступна, повторить через минуту), `storage_full` 507 (кончается место на сервере или исчерпана квота проекта на файлы). Сервис может задать свой код при том же статусе, например `llm_budget` при 409.
- `message` для людей: строка или список сообщений валидации.
- `requestId` тот же, что в заголовке ответа `X-Request-Id` и в строке лога API. Прокси может передать свой `X-Request-Id` (8-64 символа из `[\w.-]`), иначе сервер создаст его сам.

На внутреннюю ошибку API отвечает `500 internal` без подробностей, стек пишется в лог с тем же `requestId`.

`cannot_tell` приходит в обычном ответе 200.

## Ресурсы

Роли в таблице: `any` это любой вошедший пользователь, `member` любой участник проекта, "-" маршрут без токена.

| Метод | Путь | Роли | Смысл |
|---|---|---|---|
| POST | `/auth/login` | - | JWT (`accessToken`), `user` (`preferredRole`, `canCreateProjects`, `isInstanceAdmin`) и `memberships`. Отключенному администратором пользователю 403. Лимит: `THROTTLE_AUTH_LIMIT` запросов в минуту с одного IP |
| POST | `/auth/register` | - | `{ name, email, password ≥ 8, preferredRole: business \| pm \| developer, inviteToken? }`, ответ 201 такой же, как у входа. Занятый e-mail: 409. Режим регистрации (ADR 006): `open` пускает всех, `invite_only` (по умолчанию в production) пускает только с живым `inviteToken`, с домена из `REGISTRATION_DOMAINS` или с e-mail из `ADMIN_EMAILS`, остальным 403. С мертвой ссылкой приглашения ответ 404, аккаунт не создается. Приглашение принимается по ссылке или в колокольчике (`/auth/invitations`, ADR 013) |
| GET | `/auth/me` | any | Свежие `{ user, memberships }` без повторного входа, их опрашивает страница ожидания. Membership: `{ projectId, projectName, projectSlug, role }`, `projectSlug` это первый сегмент адреса в SPA |
| PATCH | `/auth/profile` | any | `{ name?, preferredRole? }` |
| POST | `/auth/password` | any | `{ current, next ≥ 8 }` → `{ accessToken }`. Неверный текущий пароль: 422. Все прежние токены, включая MCP, перестают действовать |
| GET | `/auth/invitations` | any | Колокольчик (ADR 013): живые приглашения в проекты на e-mail вошедшего, старые сверху: `[{ id, projectId, projectName, projectSlug, role, inviterName, createdAt, expiresAt }]`. Приглашения руководителя без проекта сюда не попадают. С MCP-токеном 404 |
| POST | `/auth/invitations/:invitationId/accept` | any | Принять: 200 `{ user, memberships }`, как у `/invitations/:token/accept`. Приглашение на чужой e-mail, неизвестное или истекшее: 404, уже принятое: 410 |
| POST | `/auth/invitations/:invitationId/decline` | any | Отклонить: 204, строка приглашения удаляется. Те же 404 и 410 |
| GET | `/auth/notifications?limit=30&before=<id>` | any | Колокольчик о замечаниях (ADR 016): `{ items: NotificationView[], unread, hasMore }`, от новых к старым. `limit` от 1 до 50 (по умолчанию 30), `before` это id последней строки предыдущей страницы. Только свои строки и только в текущей роли в проекте. С MCP-токеном 404 |
| POST | `/auth/notifications/read` | any | Ровно одно из `{ ids: uuid[] ≤ 100 }`, `{ remarkId }`, `{ all: true }`, иначе 422. Ответ 200 `{ unread }`. Чужие id не меняются. Другие вкладки получают `notification.read` по WS. С MCP-токеном 404 |
| POST | `/auth/reset` | - | `{ token, password ≥ 8 }` → 204. Пароль заменен, все прежние токены, включая MCP, перестают действовать. Сессия не выдается, дальше обычный вход на `/login`. Неизвестная или истекшая ссылка: 404, использованная: 410. Ссылку выдает администратор инстанса (`/admin/users/:userId/reset-link`, ADR 013) |
| GET | `/auth/options` | - | `{ demoLogins, registration: open \| invite_only, release, demoAccounts?, demoPassword?, sentryDsn? }`. Карточки демо-персон (`demoAccounts`, `demoPassword`) приходят только при `demoLogins`, в production он выключен. `registration` это режим регистрации, `release` версия сборки, `sentryDsn` DSN Sentry для SPA (только при заданном `SENTRY_DSN_WEB`) |
| GET | `/projects` | any | Список membership: `{ id, name, slug, role, createdAt }` |
| POST | `/projects` | `canCreateProjects` | Создать проект. Нужно право от администратора инстанса, иначе 403. Создатель становится `pm` проекта. `slug` это транслит названия (`Клиентский кабинет` → `klientskiy-kabinet`), если он занят, добавляется суффикс `-2`. При переименовании проекта `slug` не меняется |
| GET | `/projects/:projectId` | member | Карточка проекта |
| GET | `/projects/:projectId/members` | pm, admin | `{ members[], invitations[] }`: участники и ожидающие приглашения `{ id, email, role, inviteeName, createdAt, expiresAt }`. Токена в ответе нет, в БД хранится только его хэш. `inviteeName` это имя аккаунта на этот e-mail или `null` (ADR 013) |
| POST | `/projects/:projectId/members` | pm, admin | `{ email, role: business \| pm \| developer }`. Проектную роль `admin` снаружи выдать нельзя: ее путали с администратором инстанса, в enum `Role` она осталась. Если человек уже участник, ответ `{ kind: 'member', member }` и роль меняется (последний pm: 409). Для любого другого e-mail, зарегистрированного или нет (ADR 013), ответ `{ kind: 'invitation', invitation }` с `inviteeName` и сырым `token` для `/join/<token>`, токен показывается один раз. Зарегистрированный видит приглашение в колокольчике. Напрямую в проект никто не добавляется. E-mail администратора инстанса: 409 "Администратор инстанса не участвует в проектах" (ADR 006). Принять проектное приглашение администратор инстанса тоже не может: 409 |
| PATCH | `/projects/:projectId/members/:userId` | pm, admin | `{ role: business \| pm \| developer }`. Единственного pm понизить нельзя: 409. Сокеты человека выводятся из комнат проекта, потому что роль запоминается на `join` |
| DELETE | `/projects/:projectId/members/:userId` | pm, admin | 204. Единственного pm удалить нельзя: 409. Сокеты удаленного выводятся из комнат проекта |
| DELETE | `/projects/:projectId/invitations/:invitationId` | pm, admin | Отозвать ссылку: 204 |
| POST | `/projects/:projectId/invitations/:invitationId/link` | pm, admin | "Новая ссылка": `{ token, expiresAt }`, токен показывается один раз. Прежняя ссылка перестает работать, срок продлевается на 7 дней |
| GET | `/invitations/:token` | - | Что за приглашение: `{ kind: project \| instance, projectName, role, inviterName, expiresAt }`. E-mail приглашенного не показывается. `instance` это приглашение руководителя от администратора, у него `projectName: null`. Принятое: 410, неизвестное или истекшее (7 дней): 404 |
| POST | `/invitations/:token/accept` | any | Принять по ссылке под своим аккаунтом (e-mail может отличаться): `{ user, memberships }`. Из двух одновременных принятий одной ссылки одно получает 200, второе 410 |
| POST | `/projects/:projectId/mcp-token` | member | Токен для MCP-фасада (`apps/mcp`): JWT с `projectId` из membership, срок `MCP_TOKEN_EXPIRES_SECONDS` (30 дней). С этим токеном доступен только `/projects/:projectId/*` этого проекта. Другой проект, `/projects`, `/auth/*`, `/invitations/*`, `/admin/*` отвечают 404 даже при membership. Смена пароля, отключение и "Завершить сессии" отзывают и его |
| GET | `/admin/users` | администратор инстанса | Все пользователи инстанса: `{ id, email, name, preferredRole, canCreateProjects, isInstanceAdmin, disabledAt, createdAt, memberships[] }`. Остальным 403, в том числе с проектной ролью `admin` |
| GET | `/admin/projects` | администратор инстанса | `{ id, name, createdAt, members }` по всем проектам |
| PATCH | `/admin/users/:userId` | администратор инстанса | `{ canCreateProjects?, disabled? }`. Отключенный получает 403 при входе, его токены и сокеты перестают действовать сразу. Отключить себя нельзя: 409 |
| POST | `/admin/users/:userId/revoke-sessions` | администратор инстанса | 204. Все токены человека, включая MCP, получают 401, он входит заново |
| POST | `/admin/users/:userId/reset-link` | администратор инстанса | 200 `{ token, expiresAt }` (ADR 013): одноразовая ссылка `/reset/<token>` на 24 часа, сырой токен показывается один раз. Прежние неиспользованные ссылки человека гаснут. Неизвестный пользователь: 404, отключенный: 409 |
| GET | `/admin/invitations` | администратор инстанса | Ожидающие приглашения руководителей приемки без проекта (ADR 006): `{ id, email, role: 'pm', inviteeName, createdAt, expiresAt }`, без токена |
| POST | `/admin/invitations` | администратор инстанса | `{ email }`. Для зарегистрированного ответ `{ kind: 'user', user }`, право создавать проекты выдается сразу. Для незнакомого `{ kind: 'invitation', invitation }` с сырым `token`, токен показывается один раз. Повтор на тот же e-mail выпускает новую ссылку. Принятие по ссылке ставит `canCreateProjects` и не создает membership |
| DELETE | `/admin/invitations/:invitationId` | администратор инстанса | Отозвать: 204 |
| POST | `/admin/invitations/:invitationId/link` | администратор инстанса | "Новая ссылка": `{ token, expiresAt }`. Прежняя ссылка перестает работать |
| GET | `/projects/:projectId/documents` | member | Пакет документов. Читает вся команда, включая разработчика |
| POST | `/projects/:projectId/documents` | admin, pm | Загрузка. Заказчику и разработчику 403 |
| GET | `/projects/:projectId/documents/:id` | member | Метаданные и статус индекса одного документа. Фронт берет список, этот маршрут читают тесты и внешние клиенты |
| GET | `/projects/:projectId/documents/:id/file` | member | Файл в том виде, в каком его загрузили: `Content-Disposition: attachment` с именем по RFC 5987 (кириллица не ломается), `Cache-Control: private, no-store`, CSP `sandbox`. Файл отдается только на скачивание |
| POST | `/projects/:projectId/documents/:id/reindex` | admin, pm | Переиндексировать документ, ответ 202 |
| GET/POST | `/projects/:projectId/rounds` | member; POST: pm, business, admin | Раунды: `{ id, number, status, remarks, pending, closed, changeRequests, duplicates, createdAt, closedAt, closedByName, closedByRole }`. `pending` это нерешенные замечания, то есть все, кроме `closed`, `change_request` и `duplicate`. Кто закрыл: имя и роль на момент закрытия (событие раунда, ADR 011). Каждое открытие, закрытие и повторное открытие пишет `RoundEvent`. Новый раунд: 409, пока в проекте есть нерешенные замечания, в сообщении номер раунда и их число |
| POST | `/projects/:projectId/rounds/:roundId/close` | pm, business | Закрыть раунд можно, только когда все его замечания решены (`closed`, `change_request`, `duplicate`), иначе 409 с перечнем нерешенного. Закрытый раунд доступен только для чтения: добавить замечание, импортировать журнал и связать повтор нельзя (409) |
| POST | `/projects/:projectId/rounds/:roundId/reopen` | pm, business | Открыть раунд снова |
| GET | `/projects/:projectId/rounds/export.xlsx` | pm, business, admin | Журнал приемки всего проекта (ADR 011). Листы: "Раунды" (открыт, закрыт, кто закрыл, всего, закрыто, новые желания, повторы, не решено), "Замечания" (кто создал, решил, исправил и закрыл, с датами; как закрыто; повтор претензии; ссылка на карточку), "История" (строка на каждое действие и событие раунда). Даты записаны датами Excel в поясе `REPORT_TIMEZONE`, смещение указано в шапке ("Когда (GMT+5)"). На каждом листе фильтр и закрепленная шапка. Заказчику журнал отдается без комментариев команды и предложений модели (ADR 007). Разработчику 403 |
| GET | `/projects/:projectId/rounds/:roundId/export.xlsx` | pm, business, admin | Тот же журнал по одному раунду, итог раунда для акта |
| POST | `/projects/:projectId/remarks/:id/reopen` | business | `{ roundId, screenshotKey? }`: повтор закрытой претензии в открытом раунде. Создается новое замечание `reopened` с `origin`, оригинал получает `reopenedBy`. Дальше обычный `triage` |
| GET | `/projects/:projectId/rounds/:roundId/remarks` | member, фильтр по роли | Список. Разработчику только `defect` и `ready_for_retest` |
| POST | `/projects/:projectId/rounds/:roundId/remarks` | business, pm | Ручное замечание, кадр по `screenshotKey` из `POST .../media` |
| GET | `/projects/:projectId/remarks/:remarkId` | member + ACL очереди | Карточка. `runFailure` это причина последнего сбоя прогона по-русски (модель перегружена, ключ не принят, файл не найден и т. п.). Разработчику доступны `defect`, `ready_for_retest` и `awaiting_pm` (чтобы посоветовать), `advice[]` содержит советы разработчиков. Заказчику (business) карточка отдается без `advice`, `verdict.comment`, `traceUrl`, `proposedClass`. `draft` и `seen` он видит только после решения PM (ADR 007). То же для списков |
| GET | `/projects/:projectId/remarks/at/:roundNumber/:number` | member + ACL очереди | Та же карточка по номеру раунда и номеру замечания, для адреса SPA `/<slug>/round-2/12`. Если такого номера нет или роль его не видит: 404 |
| GET | `/projects/:projectId/remarks/:remarkId/history` | member + ACL карточки | История (ADR 011): `[{ at (ISO), action, fromStatus?, toStatus, by?: { userId?, name, role }, runId?, detail?, comment?, shot?: { kind, url, current } }]`, строка на каждое действие (create, import, reopen, reopened_as, fix_row, attach_screenshot, triage, proposal, rejected_binding, verdict, link_duplicate, ready_for_retest, retest, retest_result, close, not_fixed, cancel, run_failed). `by.name` это имя на момент действия, пустой `by` означает действие системы. `shot` это кадр действия, `current: false` значит, что его потом заменили. Заказчику не отдаются `detail` предложений модели и `comment` команды (ADR 007) |
| GET | `/projects/:projectId/advisory-queue` | developer | Что сейчас ждет решения PM (`awaiting_pm`), по этим замечаниям можно дать совет. Это не очередь работы |
| PUT | `/projects/:projectId/remarks/:id/advice` | developer | `{ code, comment? }`: совет PM. `code` из тех же пяти кнопок, без `duplicate`, `comment` до 500 символов. Один совет на человека, повтор заменяет прежний. Только для `awaiting_pm`, иначе 409. Статус не меняется, в комнату уходит `remark.advice` |
| DELETE | `/projects/:projectId/remarks/:id/advice` | developer | Снять свой совет, в комнату тоже уходит `remark.advice` |
| POST | `/projects/:projectId/imports` | business, pm | Журнал по шаблону: multipart `file` (.xlsx или .csv) и `roundId`. Чужая шапка: 422. Больше `IMPORT_MAX_ROWS` строк (по умолчанию 500, в `docker-compose.prod.yml` 100): 422 с просьбой разбить файл. Файл больше `IMPORT_MAX_BYTES` (по умолчанию 20 МБ, в `docker-compose.prod.yml` 5 МБ): 413 |
| GET | `/projects/:projectId/imports/:jobId` | member | Строки импорта: `parsed` или `needs_human_parse`, номер и статус замечания по каждой |
| GET | `/projects/:projectId/imports/template.xlsx` | member | "Скачать шаблон журнала", есть и `template.csv` |
| POST | `/projects/:projectId/remarks/:id/fix-row` | business, pm | "Допишите строку журнала": `{ description, pageOrScreen?, expected? }`, `needs_human_parse` → разбор |
| POST | `/projects/:projectId/remarks/:id/triage` | pm, business | Старт `AgentRun`. Ответ приходит сразу: `triaging` и `runId`, фазы идут в комнату WS. `409 llm_budget`: проект исчерпал суточный лимит стоимости модели (`GRAPH_DAILY_USD_PER_PROJECT`). Прогон дольше `GRAPH_RUN_TIMEOUT_MS` завершается сбоем с `runFailure` "не уложился" (код `timeout`) |
| POST | `/projects/:projectId/remarks/:id/verdict` | pm; business на `unspecified` | Решение человека (HITL), дубль WS, идемпотентно. `rejected_binding` отвечает `triaging`: тот же run продолжает цикл bind. На `unspecified` pm или business выбирают `defect` или `change_request` |
| POST | `/projects/:projectId/remarks/:id/cancel` | pm, business | `{ runId, idempotencyKey }`, дубль `run.cancel`: решения нет, run = `cancelled`. Замечание после разбора возвращается в `imported`, после ретеста в `ready_for_retest` |
| POST | `/projects/:projectId/remarks/:id/ready-for-retest` | developer | "Готово": `defect` → `ready_for_retest` |
| POST | `/projects/:projectId/remarks/:id/retest` | business | Новый кадр `{ screenshotKey }` запускает граф ретеста в фоне. Ответ: `ready_for_retest`, `runMode: retest`, `runStatus: running`, в комнату идет фаза `diffing`. Затем pixel-diff и пояснение модели: кадр `diff` в `screenshots`, `retest.outcome` (`likely_addressed`, `likely_unchanged` или `cannot_tell`), `retest.explanation` по-русски, статус `awaiting_business_close`. Разный размер, формат не PNG/JPG или слишком разные кадры дают `cannot_tell` с причиной, без диффа. `409 llm_budget`: суточный лимит стоимости модели проекта исчерпан |
| POST | `/projects/:projectId/remarks/:id/close` | business | `{ comment? }` (до 2000 символов). Из `awaiting_business_close` после ретеста, из `ready_for_retest` без нового кадра, если заказчик проверил сам (ADR 010). Пока кадры сравниваются: 409. Ответ: `closed`, `closedVia` (`retest` или `business_check`), `closeComment` |
| GET | `/projects/:projectId/dev-queue` | developer | `defect` и `ready_for_retest` |
| GET | `/projects/:projectId/search?q=&k=` | member | Поиск по пакету документов с цитатой: `{ query, hits[], boundScore }`. `hits` это top-k ближайших фрагментов (`k` от 1 до 20, по умолчанию 5) без отсечения: раздел, фрагмент, `score` (косинусная близость от 0 до 1). `boundScore` (поле добавлено 18.09.2026, прежние поля не менялись) это близость, с которой фрагмент считается опорой. Это тот же `BOUND_SCORE`, по которому граф привязывает замечание к пункту ТЗ (`apps/api/src/llm/triage-llm.ts`, сейчас 0.45). Фильтровать или помечать фрагменты по нему решает клиент, так делает MCP `search_spec` |
| POST | `/projects/:projectId/media` | member | Скрин: multipart `file` (PNG, JPG, WebP, GIF до 10 МБ, SVG не принимается) → `{ storageKey, url }`. `screenshotKey` в теле замечания или ретеста принимается, только если кадр существует и принадлежит этому проекту, иначе 422 |
| GET | `/projects/:projectId/media/:fileName` | member | Отдача кадра, путь всегда внутри проекта |
| POST | `/projects/:projectId/remarks/:id/screenshot` | business, pm | `{ screenshotKey }`: кадр по "Не хватает скрина", затем новый разбор |
| POST | `/projects/:projectId/remarks/:id/not-fixed` | business | "Не исправлено": замечание возвращается в `defect`. Только после ретеста с новым кадром, из `ready_for_retest`: 409 |
| POST | `/projects/:projectId/remarks/:id/link-duplicate` | pm | `{ duplicateOfNumber }`: связать с оригиналом из того же раунда. Статус не меняется |

Загрузка файлов: `multipart/form-data`, поле `file`. Скрин загружается отдельно (`POST .../media`), в замечание передается его `storageKey` как `screenshotKey`.

Импорт журнала. `POST /projects/:projectId/imports` принимает только шаблон журнала. Шапка русская: `№`, `Где`, `Что не так`, `Как должно быть`, `Важность`, `Скрин`. Внутренние ключи: `external_id, page_or_screen, description, expected, severity, screenshot` (`apps/api/src/imports/journal-template.ts`). Прежняя английская шапка тоже принимается. Порядок колонок, регистр, лишние пробелы и точки над буквой е не важны. CSV с разделителем `,` или `;`, в UTF-8 (с BOM или без) или windows-1251. `GET .../imports/template.xlsx|csv` отдают шаблон с русской шапкой (csv с BOM и `;`, чтобы Excel открыл его по колонкам). Другая шапка: 422 с перечнем недостающих и лишних колонок, ни одна строка не создается.

Каждая строка журнала становится замечанием. Строка с описанием получает `imported`, разбор идет в фоне, статус виден в `GET .../imports/:jobId` и в журнале. Строка без описания получает `needs_human_parse` с причиной в `reason`. Ячейки хранятся как есть в `ImportRow.rawJson`. Картинка в ячейке xlsx становится кадром замечания. Ссылка в колонке `screenshot` CSV не загружается, кадр прикрепляют на карточке. Ответ 201: `ImportJobView` (`apps/api/src/imports/import.dto.ts`).

Документы. `POST /projects/:projectId/documents` принимает поля `file`, `kind` и необязательный `effectiveAt` (ISO-дата). `file`: PDF, DOCX, DOC (Word 97-2003), Markdown или текст, до 20 МБ. Тип проверяется по содержимому, при несовпадении 422 со списком форматов. `kind`: `spec | protocol | addendum | journal_source`. Ответ 201 со статусом `uploaded`, индексация идет в фоне: `parsed` → `indexed` | `failed`. Статус и число чанков видны в `GET .../documents`.

## Аккаунты (ADR 005)

Пользователь без проекта видит экран ожидания и опрашивает `GET /auth/me`. Проект появится, когда он примет приглашение по ссылке или в колокольчике (`GET /auth/invitations`). `preferredRole` (сторона при регистрации) только подсказка, прав она не дает. Роль в проекте всегда берется из `Membership.role`, ее ставит PM.

Приглашение это ссылка `/join/<token>`. Писем нет (ADR 013): PM копирует ссылку и отправляет ее сам. Зарегистрированный на этот e-mail может принять приглашение и в колокольчике. Ошибки: 409, если e-mail занят или это единственный pm; 410, если ссылка уже принята; 422 при неверном текущем пароле или ошибке валидации.

## Тело решения (`verdict`)

```json
{
  "verdict": "defect",
  "comment": "optional",
  "runId": "uuid",
  "idempotencyKey": "uuid"
}
```

`verdict`: `defect | change_request | unspecified | duplicate | cannot_tell | rejected_binding`. Для `duplicate` можно передать `duplicateOfNumber`. `runId` берется из карточки замечания (поле `runId`). Повтор с тем же `idempotencyKey` возвращает тот же результат без второго решения.

## Тело замечания

`POST /projects/:projectId/rounds/:roundId/remarks` принимает JSON `{ "description", "pageOrScreen"?, "expected"?, "screenshotKey"? }`. Сервер создает замечание и запускает граф разбора. Ответ приходит сразу: статус `triaging`, `runId`, `runStatus: running`. Фазы прогона (`retrieving` → `vision` → `binding` → `drafting` → `awaiting_pm`) идут в комнату WS (`docs/WS.md`). Когда прогон дошел до interrupt, `GET .../remarks/:id` отдает `awaiting_pm` с `proposedClass`, `draft[]`, `citations[]`, `seen` (факты с кадра) и тем же `runId`. `fix-row`, `screenshot` и `triage` работают так же и тоже отвечают `triaging`.

Форма ответа: `RemarkView` в `apps/api/src/remarks/remark.dto.ts`, на фронте ей соответствует модель `Remark`.

- Если настроен Langfuse, в карточке есть `traceUrl`, ссылка на трейс текущего прогона (`AgentRun`). Фронт показывает ее PM внизу карточки.
- `advice[]`: советы разработчиков (`AdviceView`: `code`, `userId`, `userName`, `role`, `at`, `comment?`).
- Рядом с именами людей карточка отдает их роль в проекте (`authorRole`, `fixedByRole`, `closedByRole`, `verdict.userRole`), потому что людей на одной стороне может быть несколько.
- Время (`verdict.at`, `advice[].at`, `closedAt`, `createdAt`, `updatedAt`) приходит в ISO 8601, дату и время форматирует клиент.
- `screenshots[]` содержит только текущие кадры. Замененные остаются в базе и в истории.
- У закрытого замечания есть `closedVia` (`retest` после нового кадра и диффа, `business_check`, если заказчик проверил сам) и `closeComment`. Оба поля берутся из строки истории `close`.

## Чего нет в API

`/sprints`, `/boards`, `/assignees`, `/points`, `/jira`, `/playwright`, `/chat`.

## MCP (`apps/mcp`)

MCP-фасад дает Cursor, Claude Code и Claude Desktop тот же контракт без второго CRUD: инструменты вызывают маршруты выше с токеном из `POST /projects/:projectId/mcp-token`.

- `search_spec` = `GET .../search`. Опорой помечаются только фрагменты с `score ≥ boundScore`, остальные помечены "ниже порога, опорой считать нельзя". Если выше порога ничего нет, ответ "Опоры нет" без фрагментов. Если API не вернул `boundScore`, берется запасной порог 0.45.
- `get_round_remarks` = `GET .../rounds` + `GET .../rounds/:roundId/remarks`.
- `apply_human_verdict` = `GET .../remarks/:id` + `POST .../remarks/:id/verdict`, фасад подставляет `runId` и `idempotencyKey`.
- `submit_retest_evidence` = `POST .../media` + `POST .../remarks/:id/retest`.

`projectId` в аргументах инструментов нет, он берется из токена. Закрыть замечание через MCP нельзя. Подробнее: [`apps/mcp/README.md`](../apps/mcp/README.md).

## Уведомления

Писем нет (ADR 013 заменил ADR 009). Очередь человека это журнал с фильтром "Ждут меня", колокольчик ведет в нее (ADR 016). Приглашения приходят в `GET /auth/invitations`, события по замечаниям в `GET /auth/notifications`.

```ts
type NotificationView = {
  id: string;
  kind: 'action' | 'info';            // "ждет вас" | "к сведению": по правилам notifications/audience.ts и роли адресата
  at: string;                         // ISO, момент события (строка истории)
  readAt: string | null;
  project: { id: string; name: string; slug: string };
  remark: { id: string; number: number; roundNumber: number; title: string | null; status: RemarkStatus; readable: boolean };
  event: { action: string; fromStatus: RemarkStatus | null; toStatus: RemarkStatus };
  by: { name: string; role: Role | null } | null;   // null: действие системы (разбор, сравнение кадров); имя берется снимком из истории
};
```

`remark.status` это текущий статус замечания на момент чтения. `readable` показывает, может ли адресат сейчас открыть карточку: разработчик видит `defect`, `ready_for_retest` и `awaiting_pm`, остальные роли видят все. При `readable: false` поле `title` равно `null`.

Комментариев, пометок истории, предложения модели, черновика, цитат, советов и `runId` в уведомлениях нет ни для одной роли (ADR 007).

Кто что получает:

| Действие | "Ждет вас" | "К сведению" |
|---|---|---|
| `proposal` (модель предложила) | руководителю приемки и проектной роли `admin` | - |
| решение `defect` | разработчику | заказчику |
| решение `change_request` или `duplicate` | - | заказчику |
| решение `unspecified` или `cannot_tell` | заказчику | - |
| "Готово" разработчика (`ready_for_retest`) | заказчику | - |
| итог сравнения кадров (`retest_result`) | заказчику | - |
| "Не исправлено" (`not_fixed`) | разработчику | заказчику |
| закрытие (`close`) | - | заказчику |

Автор действия и отключенные пользователи уведомлений не получают. Действие человека по замечанию помечает прочитанными его уведомления по этому замечанию.

Человек видит строки только тех проектов, где он сейчас участник, и только для своей текущей роли. После удаления из проекта или смены роли прежние строки пропадают, фильтр стоит в SQL.

По WS в комнату `user:{id}` приходят только сигналы о новых строках (`docs/WS.md`). Источник данных это список `GET /auth/notifications`, клиент сверяется с ним при подключении сокета.
