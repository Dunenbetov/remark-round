# WebSocket

Один неймспейс socket.io. Клиент входит в комнату конкретного замечания по id, общего чата нет.

- `remark:{remarkId}`: комната замечания.
- `user:{userId}` (ADR 016): личная комната, в ней только события колокольчика этого пользователя (раздел "Личная комната" ниже).

Авторизация: тот же JWT, что у REST, при подключении (`connect`). Membership проверяется на `join`.

Путь: `/api/v1/ws`, под тем же `/api`, что REST, поэтому nginx и dev-прокси проксируют одно место. Токен передается в `auth.token` при handshake и проверяется в middleware до установления соединения. С плохим токеном клиент получает `connect_error` "Нет доступа".

`join { projectId, remarkId }` отвечает ack `{ ok, runId?, phase?, presence[] }`. Если прогон идет, клиент сразу получает текущую фазу. `presence` перечисляет, кто уже в комнате. `leave { remarkId }` выводит сокет из комнаты.

Команды принимаются только в комнате, в которую сокет вошел: контекст проекта берется из `join`. В теле команды передается `remarkId` этой комнаты, без него или без `join` ack приходит с `status: 404`. Ack команды: `{ ok: true, remark }` (та же форма, что в REST) или `{ ok: false, status, message }`. Ошибки 403, 409 и 422 приходят в ack, соединение остается открытым.

## Почему WebSocket

Пока граф стоит на `interrupt`, клиент отправляет `verdict.*` и `run.cancel` в тот же прогон. Нужна связь в обе стороны, поэтому SSE не подходит.

## Сервер → клиент

```ts
type ServerEvent =
  | { type: 'run.phase'; runId: string; phase: Phase }
  | { type: 'run.token'; runId: string; delta: string }
  | { type: 'run.citations'; runId: string; citations: Citation[] }
  | { type: 'run.proposal'; runId: string; proposedClass: ProposedClass; rationale: string }
  | { type: 'run.persisted'; runId: string; remarkStatus: string }
  | { type: 'run.cancelled'; runId: string; remarkStatus: string }   // run.cancel: без решения и без сбоя
  | { type: 'run.failed'; runId: string; message: string }
  | { type: 'presence'; userId: string; role: string; name: string; action: 'join' | 'leave' }
  | { type: 'remark.advice'; remarkId: string; advice: AdviceView[] };   // совет разработчика записан или снят: весь список советов

type Phase =
  | 'retrieving'
  | 'vision'
  | 'binding'
  | 'drafting'
  | 'awaiting_pm'
  | 'diffing'
  | 'awaiting_business_close'
  | 'persisted'
  | 'failed';

type ProposedClass =
  | 'defect_candidate'
  | 'change_request_candidate'
  | 'unspecified'
  | 'duplicate'
  | 'cannot_tell';
```

## Клиент → сервер

```ts
type ClientEvent =
  | { type: 'verdict.approve'; remarkId: string; runId: string; verdict: string; comment?: string; idempotencyKey: string }
  | { type: 'verdict.reject_binding'; remarkId: string; runId: string; comment: string; idempotencyKey: string }
  | { type: 'run.cancel'; runId: string; idempotencyKey: string };   // в теле также remarkId комнаты
```

`verdict.*` проходят те же проверки статуса и роли, что `POST .../verdict` (переходы в `docs/STATUS.md`). `run.cancel` останавливает прогон, пока он идет или ждет человека (`running`, `awaiting_human`). По завершенному прогону команда возвращает карточку без изменений.

## Правила

- Повтор с теми же `idempotencyKey` и `runId` возвращает тот же результат, второй `HumanVerdict` не создается.
- `run.cancel` не создает решения, прогон получает статус `cancelled`.
- Команды закрытия в WS нет. `closed` ставит только `POST .../close` от роли `business`, модель и `developer` закрыть замечание не могут.
- `run.token` несет черновик обоснования (rationale) по мере генерации.
- Имя события совпадает с его `type`, у одного имени всегда одна форма: сервер отправляет `socket.emit(event.type, event)`, клиент слушает `onAny`.
- Те же команды есть в REST: `POST .../verdict` и `POST .../cancel`. Оба пути ведут в `AgentService`, запись делает `RemarksService`.
- `remark.advice` к прогону не относится. Его отправляет `RemarksController` после `PUT` или `DELETE .../advice`, клиент обновляет `advice[]` на месте без перечитывания карточки. Разработчик может войти в комнату замечания в `awaiting_pm`, чтобы дать совет. Решение из комнаты для него по-прежнему 403.

## Личная комната `user:{id}` (ADR 016)

Сервер сам добавляет в нее каждый сокет при подключении (`handleConnection`). Клиент не вызывает для нее `join` и ничего в нее не отправляет. В комнату приходят только события о строках колокольчика этого пользователя. Сокет с токеном MCP (`scopedProjectId`) в личную комнату не попадает.

```ts
type UserEvent =
  | { type: 'notification.new'; items: NotificationView[]; unread: number }   // новые строки адресату (docs/API.md, раздел "Уведомления")
  | { type: 'notification.read'; unread: number; ids?: string[]; remarkId?: string; all?: true }   // прочитано: в другой вкладке или действием по замечанию
  | { type: 'notification.sync' };   // состояние могло разойтись (убрали из проекта, сменили роль): перечитать GET /auth/notifications
```

- `notification.new` уходит после коммита: `NotificationsService.record` ставит задачу `notify_push` в той же транзакции, воркер берет ее после коммита. Повтор задачи после рестарта дает дубль, клиент объединяет строки по `id`.
- `notification.read` приходит всем вкладкам человека после `POST /auth/notifications/read` (с тем же `ids`, `remarkId` или `all`) и после его действия по замечанию (с `remarkId`): действие по замечанию считается прочтением.
- Отзыв по проекту (`TenancyService.revoke(user, project)`: человека убрали из проекта или сменили ему роль) выводит сокеты из комнат замечаний этого проекта. Личная комната остается, в нее уходит `notification.sync`. Отзыв без проекта (смена или сброс пароля, отключение, "Завершить сессии") разрывает соединение целиком.
- Источник данных это строки в БД, восстановление пакетов socket.io живет в памяти процесса. Клиент перечитывает список при подключении и переподключении сокета, при открытии колокольчика и при возврате во вкладку.

## Кому какие события приходят (ADR 007)

Всей комнате: `run.phase`, `run.persisted`, `run.failed`, `run.cancelled`, `presence`. Только сокетам с ролью, отличной от `business`: `run.token`, `run.citations`, `run.proposal`, `remark.advice`. Заказчик не получает сырой черновик и советы разработчиков, черновик он видит в карточке после решения PM. Роль сокета берется из presence, записанной на `join`. Ответы команд (`remark` в ack) собираются той же функцией, что в REST, и для заказчика урезаны так же.
