# Граф LangGraph.js

Обновлено 19.09.2026, сверено с кодом ветки `dev`. Почему LangGraph, а не CrewAI / Parlant / свой цикл и почему свой чекпоинтер — [ADR 014](adr/014-orchestration-langgraph.md). Выбор моделей — [ADR 015](adr/015-llm-choice.md).

**Графа два**, оба — `StateGraph` из `@langchain/langgraph` внутри процесса API (Nest):

- `buildTriageGraph` — разбор замечания: поиск опоры в документах, класс, черновик, пауза на решение PM (`apps/api/src/agent/triage.graph.ts`);
- `buildRetestGraph` — ретест: pixel-diff, пояснение модели, пауза на решение заказчика (`apps/api/src/agent/retest.graph.ts`).

Это не мультиагентная система, а один управляемый поток с ветками, циклами с лимитом и паузой на человека. Ноды не ходят в Prisma: пишут только через `RemarksService`, модель зовут только через `LlmService` (`apps/api/src/agent/graph-deps.ts`). Состояние сохраняется после каждого шага в таблицу `GraphCheckpoint`, `thread_id = AgentRun.id` (`prisma-checkpointer.ts`). Запускает графы `AgentService` через очередь задач `Job` — раздел «Как граф запускается».

## Состояние

`apps/api/src/agent/graph-state.ts`, `Annotation.Root`. У каждого поля редьюсер «последнее значение», всё сериализуется в JSON — поэтому каждый шаг ложится в чекпоинт.

```ts
// TriageState — граф триажа
{
  projectId, userId, role, remarkId, runId,  // кто и что разбирает
  facts: TriageFacts | null,      // замечание, скрин, соседи по раунду (RemarksService.triageFacts)
  query: string,                  // запрос к поиску
  rewriteCount: number,           // сколько раз переписали запрос, не больше 2
  bindLoops: number,              // сколько раз faithfulness вернул в bind, не больше 2
  hits: EvidenceHit[],            // найденные фрагменты документов, до 8
  retrievedChunkIds: string[],
  excludeChunkIds: string[],      // отвергнутые PM кнопкой «Не та цитата из ТЗ»
  visionFacts: string | null,     // null — кадр ещё не смотрели, '' — смотрели, фактов нет
  binding: { kind: 'clause', chunkId, clauseRef, confidence } | { kind: 'none' } | { kind: 'conflict' },
  proposedClass: ProposedClass | null,
  chunkIds: string[],             // опоры, которые выбрал classify
  duplicateOfNumber: number | null,
  reason: string,                 // причина от classify для draft
  rationale: string[],            // заголовок по классу, абзац модели, пометка guardrail
  faithfulnessOk: boolean,
  faithfulnessIssue: string | null,
  humanComment: string | null,    // комментарий PM к «Не та цитата из ТЗ»
  injectionMatches: string[],     // фразы-команды, которые нашёл guardrail входа
  decision: HumanDecision | null  // accept | reject_binding | request_screenshot | cancel
}

// RetestState — граф ретеста
{
  projectId, userId, role, remarkId, runId,
  strategy: 'diff_explain' | 'llm_only',
  facts: RetestFacts | null,      // претензия, кадры «было» и «стало», цитаты снимком
  retestSize: { width, height } | null,
  diff: { diffShot, regionText } | null,
  result: { outcome, explanation } | null,  // likely_addressed | likely_unchanged | cannot_tell
  decision: RetestDecision | null           // close | not_fixed | cancel
}
```

`binding.kind = 'conflict'` и `kind = 'cancel'` в решениях код не создаёт — см. «Неиспользуемые варианты типов».

## Триаж

Тот же граф вместе с очередью, транзакциями и решением PM по дорожкам — [`docs/diagrams/remark-flow.png`](diagrams/remark-flow.png).

Схема повторяет `addNode` / `addEdge` / `addConditionalEdges` из `triage.graph.ts:230-256`.

```mermaid
flowchart TD
  start0(("START")) --> ingest["ingest"]
  ingest --> retrieve["retrieve_docs"]
  retrieve -->|"есть скрин, кадр ещё не смотрели, модель видит"| vision["maybe_vision"]
  retrieve -->|"иначе"| bind["bind_to_clause"]
  vision --> bind
  bind -->|"близость ниже 0.45, переписывали меньше 2 раз, нет комментария PM"| rewrite["rewrite_query"]
  rewrite -->|"цикл 1: не больше 2 раз"| retrieve
  bind -->|"иначе"| classify["classify_evidence"]
  classify --> draft["draft_rationale"]
  draft --> faith["faithfulness_gate"]
  faith -->|"не прошла, возвратов меньше 2: цикл 2"| bind
  faith -->|"прошла или провал в третий раз: код ставит cannot_tell"| propose["propose"]
  propose --> hitl["hitl: interrupt, ждём PM"]
  hitl -->|"accept"| persist["persist"]
  hitl -->|"reject_binding: цикл 3, от человека, без лимита"| retrieve
  hitl -->|"request_screenshot"| pause["pause"]
  hitl -->|"другое, в коде не бывает"| stop0(("END"))
  persist --> stop0
  pause --> stop0
```

| Нода | Что делает | Модель и сервисы |
|---|---|---|
| `ingest` | факты замечания, запрос к поиску, guardrail входа (фразы-команды помечаются, разбор не блокируется) | `RemarksService.triageFacts`, `guardrails.ts` |
| `retrieve_docs` | top-6 фрагментов с `WHERE projectId` в SQL, без отвергнутых PM; объединяет с прошлыми находками, держит до 8 | `RagService.search` → эмбеддинг запроса |
| `maybe_vision` | факты кадра, не решение; один раз за прогон | `visionFacts`, быстрая модель |
| `bind_to_clause` | лучший фрагмент с близостью от 0.45 → `clause`, иначе `none` (роль ноды — ниже) | без модели |
| `rewrite_query` | переписать запрос словами ТЗ | `rewriteQuery`, быстрая модель |
| `classify_evidence` | класс и номера фрагментов-опор; код отбрасывает id, которых не было в выдаче | `classify`, быстрая модель, JSON-схема |
| `draft_rationale` | первую строку ставит код по классу, модель пишет один абзац; токены идут в WS | `draft`, сильная модель, стрим |
| `faithfulness_gate` | проверка кодом: ссылка на раздел не из цитат, дефект без цитаты, «на кадре» без кадра | без модели, `faithfulness.ts` |
| `propose` | единственная запись от графа — предложение: статус `awaiting_pm`, цитаты снимком | `RemarksService.applyProposal` |
| `hitl` | `interrupt()`: граф спит в `GraphCheckpoint` часы и дни | без модели |
| `persist`, `pause` | только фаза `persisted` для комнаты: решение уже записано | без модели |

`propose` — отдельная нода, потому что при resume LangGraph перезапускает ноду с `interrupt()` с начала; документация LangGraph советует выносить побочные действия в отдельные ноды.

Лимиты циклов:

- **Цикл 1**, `rewrite_query → retrieve_docs`: `MAX_REWRITES = 2` (`triage.graph.ts:14`). Если PM уже написал, где искать, не запускается (`afterBind`, `:86`).
- **Цикл 2**, `faithfulness_gate → bind_to_clause`: `MAX_BIND_LOOPS = 2` (`:15`). Третий провал — код сам ставит `cannot_tell` с текстом «Разберите вручную или пришлите кадр этого экрана» (`:157-164`). Сломанный черновик до PM не доходит.
- **Цикл 3**, «Не та цитата из ТЗ»: запускает человек, по числу не ограничен (раздел «Решение человека и resume»).
- Худший случай одного прохода по коду: 1 vision + 2 rewrite + 3 classify + 3 draft = 9 вызовов модели и до 3 поисков. `recursionLimit: 80` шагов на один вызов графа (`agent.service.ts:333`).

Что значат решения в `hitl`:

| Решение в графе | Кнопки PM (`apps/web/src/app/core/copy.ts`) | Что до resume уже записал `RemarksService.verdict` |
|---|---|---|
| `accept` | «В работу разработчикам», «Новое желание, не в этом ТЗ», «В документах нет ответа — решите вы»; `duplicate` — только через API и MCP | статус = решение, `HumanVerdict`, `AgentRun` → `persisted` |
| `request_screenshot` | «Не хватает скрина» | статус `cannot_tell`, `AgentRun` → `persisted`; новый скрин запустит новый прогон |
| `reject_binding` | «Не та цитата из ТЗ», комментарий обязателен | статус снова `triaging`, `AgentRun` → `running`, тот же `runId` |

## Ретест

Схема повторяет `retest.graph.ts:120-136`.

```mermaid
flowchart TD
  start0(("START")) --> load["load"]
  load -->|"strategy diff_explain, по умолчанию"| pixel["pixel_diff"]
  load -->|"strategy llm_only, только для A/B"| judge["judge_frames"]
  pixel -->|"ответ уже есть: нет старого кадра, кадры несопоставимы или совпали"| apply["apply_retest"]
  pixel -->|"есть дифф"| explain["explain"]
  explain --> apply
  judge --> apply
  apply --> hitl["hitl_business: interrupt, ждём заказчика"]
  hitl --> persist["persist"]
  persist --> stop0(("END"))
```

- После `hitl_business` развилки нет: и «Закрыть: исправлено», и «Не исправлено» ведут в `persist` (`retest.graph.ts:134`). Решение заказчика до resume уже записали `RemarksService.close` / `notFixed` (`remarks.service.ts:621-649`), граф только закрывает прогон.
- `pixel_diff` работает без модели. Старого кадра нет → `cannot_tell`; кадры несопоставимы (`cannot_compare`, правила — `docs/ARCHITECTURE.md`, «Путь: ретест») → `cannot_tell`; совпали пиксель в пиксель → `likely_unchanged`. В этих случаях `explain` не зовётся (`afterDiff`, `:61`).
- `explain` получает три кадра (было, стало, дифф), претензию и цитаты и отвечает только `likely_addressed | likely_unchanged | cannot_tell` по JSON-схеме. `closed` ставит только заказчик кнопкой.
- `judge_frames` — ветка H0 из A/B (модель сама решает по двум кадрам, без диффа): по качеству паритет с H1, выигрыш даёт предпроверка кадров (`docs/EVALS.md`, раздел 7); в продукте — H1. Включается только `RETEST_STRATEGY=llm_only`, для сравнения (`:13-17`, ADR 002).
- `apply_retest` пишет `RemarksService.applyRetest` → `awaiting_business_close`.
- Закрытие без нового кадра (ADR 010) идёт мимо графа: прогона ретеста нет.

## Как граф запускается

1. **Старт.** REST `POST /projects/:projectId/rounds/:roundId/remarks` (и «Запустить снова», новый скрин, дописанная строка журнала) → `AgentService.startTriage` (`agent.service.ts:150-156`):
   - суточный бюджет проекта: сумма `AgentRun.costUsd` за последние 24 часа против `GRAPH_DAILY_USD_PER_PROJECT` ($20 по умолчанию), иначе `409 llm_budget` (`:231-242`);
   - `RemarksService.beginTriage` — одна транзакция: `AgentRun` в статусе `running`, замечание → `triaging`, строка истории (`remarks.service.ts:305-315`);
   - **отдельным шагом**, не в той транзакции: `JobsService.enqueue('graph', { action: 'start' }, { maxAttempts: 4 })` (`agent.service.ts:251-258`). REST сразу отвечает `triaging` и `runId`.
2. **Воркер.** Живёт в каждом процессе API. Раз в 500 мс берёт задачу одним `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` (`jobs.service.ts:273-294`). Лимиты: прогонов графа разом `GRAPH_MAX_CONCURRENT = 4`, на проект `GRAPH_MAX_PER_PROJECT = 2`. Насыщенные виды задач и проекты отсекаются прямо в `WHERE`, поэтому ждущая задача не сжигает попытку.
3. **Исполнение.** `AgentService.executeJob` (`agent.service.ts:280-298`) → `run()` → `graph.invoke(input, { configurable: { thread_id: runId }, signal, recursionLimit: 80, callbacks })` (`:330-335`). Весь вызов — корневой span трейса Langfuse `triage` или `triage.resume`. traceId — первые 32 hex от `sha256(runId)`, поэтому старт и продолжение ложатся в один трейс.
4. **Продолжение.** Решение приходит по REST `POST …/remarks/:id/verdict` или по WS `verdict.approve` / `verdict.reject_binding` (MCP зовёт тот же REST) → `AgentService.verdict`. Сначала `RemarksService.verdict` пишет решение, потом отдельная задача `{ action: 'resume' }`. Воркер вызывает `resume()` (`:375-387`): если в чекпоинте есть незавершённый шаг или interrupt (`getState().next`, `tasks[].interrupts`), граф продолжается `new Command({ resume: decision })` в том же thread. Если чекпоинта нет (seed, старые прогоны), «Не та цитата из ТЗ» начинает прогон заново тем же `runId` с комментарием PM.
5. **Дедлайн.** `GRAPH_RUN_TIMEOUT_MS` = 5 минут на один вызов графа, отсчёт после получения слота (`:326-328`). Истёк — прогон `failed` с кодом `timeout`, без повторов.
6. **Повторы.** Временная ошибка модели (`llm_timeout`, `llm_rate_limit`, `llm_unavailable` — `llm-errors.ts:11`): прогон остаётся `running`, задача повторяется через 30 с, 2 мин и 8 мин, всего 4 попытки (`GRAPH_MAX_ATTEMPTS`, `agent.service.ts:40`; паузы — `jobs.service.ts:75`). Повтор старта начинается с чистого thread (`deleteThread`, `agent.service.ts:291`). Кончился баланс OpenAI (`insufficient_quota`) — код `llm_quota`, без повторов. Ошибка ключа или запроса — сразу `failed`. Окончательный сбой: `RemarksService.failRun` — прогон `failed` с кодом и причиной; триаж возвращает замечание в `imported`, ретест оставляет в `ready_for_retest` (`remarks.service.ts:387`). На карточке — причина сбоя и «Запустить снова» (общий текст «Не получилось разобрать…» — запасной); уже оплаченные вызовы прибавляются к `costUsd`; код `unknown` уходит в Sentry.
7. **Отмена** («Остановить», WS `run.cancel`, REST `…/cancel`; роли PM и заказчик): `AbortController` прерывает бегущий граф — только в процессе, где он бежит; ждущие задачи снимаются; `RemarksService.cancelRun` — прогон `cancelled`, замечание в `imported` (ретест — в `ready_for_retest`); чекпоинты thread удаляются (`agent.service.ts:185-196`).
8. **Сметание** (P2, 18.09). На старте и раз в 60 с (в тестах таймеры не заводятся): задачи `running`, у которых heartbeat старше 60 с, возвращаются в очередь (`JobsService.requeueStale`); прогоны `running` старше 10 минут без живой задачи и без свежих строк истории становятся `failed` с кодом `process_restart` (`RemarksService.failStaleRuns`, `remarks.service.ts:405-418`). По SIGTERM воркер даёт активным задачам до 25 с и возвращает недоделанное в очередь.
9. **Ретеншн.** Чекпоинты прогонов `persisted`, `failed`, `cancelled` старше 7 дней удаляются на старте и раз в сутки (`pruneCheckpoints`, `agent.service.ts:134-139`). `GraphCheckpoint` связан с `AgentRun` каскадом.
10. **Мимо очереди.** `wait: true` (evals, тесты) исполняет граф прямо в вызове. Поэтому латентность в `docs/EVALS.md` не включает ожидание в очереди.

Ретест запускается так же: `AgentService.retest` (бюджет, `RemarksService.beginRetest`, задача `start`); продолжение — после «Закрыть: исправлено» или «Не исправлено».

## Решение человека и resume

**Почему решение пишется до resume, а не нодой графа.** `RemarksService.verdict` одной транзакцией записывает `HumanVerdict`, новый статус (условным UPDATE из прочитанного статуса), `AgentRun` и строку истории (`remarks.service.ts:464-496`). Так у решения один путь записи для REST, WS и MCP; повтор с тем же `(runId, idempotencyKey)` не создаёт второе решение, а два одновременных нажатия дают одну запись и один 409. Сбой графа или модели после этого не потеряет нажатую кнопку. Граф человека не обходит: до `interrupt` ноды пишут только предложение (`applyProposal` → `awaiting_pm`), ни одна нода не вызывает `verdict` или `close`. Честно: это держится на коде нод и тестах (`verdict.model-cannot-close.spec.ts`), а не на типах — `GraphDeps` отдаёт нодам весь `RemarksService` (`graph-deps.ts`), сужения до отдельных методов нет.

**Что даёт resume на accept.** Почти формальность, и это честно: граф проходит `hitl → persist`, закрывает thread и корневой span `triage.resume` в трейсе, рассылает `run.persisted` в комнату (`agent.service.ts:295`). Домен к этому моменту уже в итоговом состоянии.

**Где состояние графа действительно нужно — «Не та цитата из ТЗ».** Тот же `AgentRun` и тот же thread продолжаются из чекпоинта. Сохраняются факты замечания и факты кадра — vision повторно не зовётся (`afterRetrieve`, `triage.graph.ts:66`). Процитированные чанки уходят в исключения, выдача и счётчики циклов сбрасываются, запрос дополняется комментарием PM (`:188-201`), поиск идёт заново. Один прогон, один трейс; проверено `graph.same-run.spec.ts` (тот же `runId`, другая цитата, один `AgentRun`).

**Цикл «Не та цитата из ТЗ» по числу не ограничен, бюджет на продолжении не проверяется** (`agent.service.ts:229`). Каждое нажатие исключает только текущие цитаты (обычно один-два чанка) и сбрасывает лимиты, то есть стоит один поиск и до 3 classify + 3 draft; rewrite не запускается — PM уже написал, где искать. Расход второго и следующих проходов прибавляется к `costUsd` (P3, `run-cost.spec.ts`), но суточный лимит увидит его только на следующем старте разбора в проекте и только если сам прогон начат в последние 24 часа: лимит суммирует прогоны по дате создания (`agent.service.ts:235`). Почему приняли: нажать может только роль PM, комментарий обязателен, каждое нажатие — `HumanVerdict` и строка истории. Если понадобится лимит — счётчик отказов в состоянии графа.

## Роль `bind_to_clause` в боевом режиме

Нода берёт лучший найденный фрагмент: близость от `BOUND_SCORE = 0.45` (`apps/api/src/llm/triage-llm.ts:140`) даёт `binding = clause`, ниже — `none`; если PM написал комментарий к «Не та цитата из ТЗ», привязка ставится принудительно (`triage.graph.ts:76-84`). В боевом режиме (OpenAI) это решает одно: идти ли в `rewrite_query` (`afterBind`, `:86`).

Цитаты выбирает не bind, а classify. Модель видит все найденные фрагменты (до 8, у каждого подпись «близость 0.xx») и возвращает номера опор `hitIndexes` (`openai-triage-llm.ts:121, 138`). Код отбрасывает id, которых не было в выдаче (`triage.graph.ts:112-113`), и превращает дефект без цитаты в `unspecified` (`openai-triage-llm.ts:141`). Поле `bound`, которое граф передаёт в classify (`triage.graph.ts:101-106`), читает только режим правил без модели (`RulesTriageLlm`, `triage-llm.ts:180-183`): `classifyPrompt` его не использует, в draft граф передаёт `bound: null` (`triage.graph.ts:125`). Значит, в боевом режиме порог 0.45 не мешает модели процитировать слабый фрагмент. От выдуманного раздела защищают ворота faithfulness и то, что PM видит цитату целиком.

Ребро `faithfulness_gate → bind_to_clause` осталось от ранней схемы, где bind должен был выбирать другой пункт. Сейчас bind на втором круге возвращает ту же привязку (выдача не менялась), а rewrite к этому моменту либо не нужен, либо уже исчерпан. Фактически это повтор classify и draft с текстом ошибки проверки в промпте: «Прошлый черновик отклонён проверкой: … Не повторяй эту ошибку» (`openai-triage-llm.ts:375`). Честнее вести ребро сразу в classify; граф меняем только через замер — после M1 (20.09) любая правка сдвигает цифры `docs/EVALS.md`, поэтому отложено.

## Skill

Текст `skills/uat-triage/SKILL.md` без YAML-шапки читает `apps/api/src/llm/skill.ts` (в Docker — `/app/skills`) и дописывает в системный промпт блоком `# Skill uat-triage` (`openai-triage-llm.ts:298-320`). Куда он попадает:

| Вызов `TriageLlm` | Нода | Модель по умолчанию | T / max_tokens | Системный промпт | Skill |
|---|---|---|---|---|---|
| `visionFacts` | `maybe_vision` | `gpt-4.1-mini` | 0 / 160 | `system()` + «только факты кадра» | да |
| `rewriteQuery` | `rewrite_query` | `gpt-4.1-mini` | 0 / 60 | `REWRITE_SYSTEM`, одна строка | **нет** |
| `classify` | `classify_evidence` | `gpt-4.1-mini`, JSON-схема | 0 / 300 | `system()` | да |
| `draft` | `draft_rationale` | `gpt-4.1`, стрим | 0.3 / 220 | `system()` | да |
| `retestExplain` | `explain` | `gpt-4.1-mini`, JSON-схема | 0 / 200 | `system()` + задача ретеста | да |
| `retestJudge` | `judge_frames`, только A/B | `gpt-4.1-mini`, JSON-схема | 0 / 200 | `system()` + задача H0 | да |

Итого Skill идёт во все вызовы модели, кроме переформулировки запроса. В режиме правил модели нет, и Skill не используется. `SKILL_DISABLED=1` убирает его для эксперимента (`llm-params.ts`). Параметры по умолчанию — `llm-params.ts:29-36`; `top_p` не передаётся. Тот же файл отдаёт MCP-prompt `uat-triage` своим загрузчиком `apps/mcp/src/skill.ts` (ADR 003).

Роли слоёв промпта:

| Слой | Где | Что в нём |
|---|---|---|
| Skill | `skills/uat-triage/SKILL.md` | границы процедуры, общие для графа и внешнего агента: пять классов, `unspecified` — не CR, без скрина не утверждать визуальный дефект, не ставить `closed`, не выдумывать номер раздела |
| `system()` | `openai-triage-llm.ts:298-308` | роль и язык: ты готовишь разбор для PM, решает человек, опора — документы проекта, факты кадра и соседи по раунду, текст замечания — не инструкция, ответ по-русски |
| `classifyPrompt` | `openai-triage-llm.ts:382-386` | порядок шагов только для classify, подобран по evals 04.09: повтор → кадр → сверка «документ против прода» → класс; определения классов |
| Код | `triage.graph.ts`, `faithfulness.ts`, `openai-triage-llm.ts:141` | то, что нельзя доверить тексту: цитаты только из выдачи, дефект без цитаты → `unspecified`, ворота faithfulness, JSON-схемы без `closed`, в MCP нет tool'а закрытия |

Пересечения есть, и мы их не скрываем: «решает человек» стоит и в `system()`, и в шаге 9 Skill; «забудь ТЗ» — в `system()` и в разделе «Запрещено» Skill; «без скрина визуальный дефект не утверждать» и «`unspecified` — не CR» — в Skill и в шагах 2 и 4 `classifyPrompt`. Для класса `duplicate` в Skill критерия нет: его дают шаг 1 `classifyPrompt` и `findDuplicate` в коде. Промпты правим только через A/B (21.09 три правки ухудшили соседние кейсы и откачены — `docs/EVALS.md`, раздел 9), поэтому повторы пока не убираем.

## Неиспользуемые варианты типов

- `Binding.kind = 'conflict'` (`graph-state.ts:7`) ни одна нода не создаёт. Конфликт двух пунктов пакета решает classify (evals, тип 4: 2/2 в обоих прогонах M1 — `docs/EVALS.md`, раздел 3).
- `HumanDecision.kind = 'cancel'` и `RetestDecision.kind = 'cancel'` (`graph-state.ts:10, 13`) в граф не отправляются: отмена не будит граф, а удаляет его thread (`AgentService.cancel`). Если бы такое решение пришло, триаж ушёл бы в END (`afterHitl`), а ретест — в `persist`: развилки после `hitl_business` нет.

Это задел в типах, а не ветки. Убрать — правка кода; до защиты не трогаем.

## Что проверено тестами, а что нет

- `graph.same-run.spec.ts`: чекпоинты в `GraphCheckpoint`; «Не та цитата из ТЗ» продолжает тот же прогон с другой цитатой; выдуманный раздел даёт два цикла faithfulness и `cannot_tell`; отмена.
- `run-deadline.spec.ts` — дедлайн, ретеншн чекпоинтов, суточный бюджет. `run-cost.spec.ts` — стоимость второго прохода и сбойного прогона прибавляется. `jobs.spec.ts` — повторы (4 попытки), `llm_quota`, возврат осиротевших задач по таймеру, сметание зависших прогонов. `guardrail.injection.spec.ts` — injection не даёт дефекта.
- **Не покрыто тестом:** цикл `rewrite_query` (заглушка модели в тестах его не считает; в отчёте evals с 18.09 есть `rewriteCount` по кейсам, живые цифры — `evals/results/2026-09-20-live-base-*.md`) и пробуждение графа вторым экземпляром API после рестарта: держится на устройстве (чекпоинт в Postgres), отдельной спеки нет.
