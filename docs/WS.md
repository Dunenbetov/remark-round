# WebSocket

Комната **не** глобальный чат. Один сокет-неймспейс, join по id.

- Предпочтительно: `remark:{remarkId}`
- Допустимо дополнительно: `round:{roundId}` только для счётчиков/presence, без чужих черновиков

Auth: тот же JWT, что REST, при `connect`. Membership проверяется на `join`.

Реализация (фаза 6): socket.io, путь `/api/v1/ws` (тот же `/api`, что REST — nginx и dev-прокси проксируют одно место). Токен — `auth.token` в handshake, проверяется middleware до установления соединения: плохой токен → `connect_error` «Нет доступа». `join { projectId, remarkId }` → ack `{ ok, runId?, phase?, presence[] }`: если прогон идёт, клиент сразу получает текущую фазу; `presence` — кто уже в комнате. Команды принимаются только в комнате, в которую сокет вошёл (контекст проекта берётся из join, не из тела). Ack команды: `{ ok: true, remark }` (та же форма, что REST) или `{ ok: false, status, message }` — 403/409/422 приходят в ack, сокет не рвётся.

## Зачем не SSE

Пока граф на `interrupt`, клиент шлёт `verdict.*` и `run.cancel` **в тот же run**. Это двусторонне.

## Сервер → клиент

```ts
type ServerEvent =
  | { type: 'run.phase'; runId: string; phase: Phase }
  | { type: 'run.token'; runId: string; delta: string }
  | { type: 'run.citations'; runId: string; citations: Citation[] }
  | { type: 'run.proposal'; runId: string; proposedClass: ProposedClass; rationale: string }
  | { type: 'run.persisted'; runId: string; remarkStatus: string }
  | { type: 'run.cancelled'; runId: string; remarkStatus: string }   // фаза 6: run.cancel — не вердикт и не сбой
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

Только в фазах `awaiting_pm` | `awaiting_business_close`:

```ts
type ClientEvent =
  | { type: 'verdict.approve'; remarkId: string; runId: string; verdict: string; comment?: string; idempotencyKey: string }
  | { type: 'verdict.reject_binding'; remarkId: string; runId: string; comment: string; idempotencyKey: string }
  | { type: 'run.cancel'; runId: string; idempotencyKey: string };
```

## Правила

- Повтор `idempotencyKey` + `runId` → тот же результат, не второй `HumanVerdict`.
- `run.cancel` не создаёт вердикт, run = `cancelled`.
- Close (`closed`) с WS **не** принимать от модели и не принимать от `developer`.
- Токены — черновик rationale, не «ответ сотруднику».
- Одно и то же имя события — одна и та же форма: `socket.emit(event.type, event)`, клиент слушает `onAny`.
- REST — дубль тех же команд: `POST .../verdict`, `POST .../cancel`. Оба пути ведут в `AgentService` → `RemarksService`.
- `remark.advice` — не прогон: его шлёт `RemarksController` после `PUT/DELETE .../advice`, клиент патчит `advice[]` на месте (без перечитывания). Разработчик входит в комнату `awaiting_pm` — чтобы советовать; вердикт из комнаты у него по-прежнему 403.

Пины на скрине / курсоры — stretch, в MVP не делать.
