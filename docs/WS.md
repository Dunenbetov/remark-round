# WebSocket

Комната **не** глобальный чат. Один сокет-неймспейс, join по id.

- Предпочтительно: `remark:{remarkId}`
- Допустимо дополнительно: `round:{roundId}` только для счётчиков/presence, без чужих черновиков

Auth: тот же JWT, что REST, при `connect`. Membership проверяется на `join`.

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
  | { type: 'run.failed'; runId: string; message: string }
  | { type: 'presence'; userId: string; role: string; action: 'join' | 'leave' };

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

Пины на скрине / курсоры — stretch, в MVP не делать.
