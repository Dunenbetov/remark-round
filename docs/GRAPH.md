# Граф LangGraph.js

Один граф (плюс тот же граф с `mode: retest`). Не CrewAI, не мультиагентный цирк.

Пакет: `@langchain/langgraph` in-process в `AgentModule`. Ноды вызывают Nest-сервисы. Checkpoint: Postgres (`GraphCheckpoint`). Interrupt живёт дольше HTTP.

## Состояние (минимум)

```ts
type GraphState = {
  projectId: string;
  remarkId: string;
  runId: string;
  mode: 'triage' | 'retest';
  query: string;
  rewriteCount: number;      // max 2
  retrievedChunkIds: string[];
  visionFacts?: string;
  binding?: { clauseRef: string; confidence: number } | { kind: 'none' | 'conflict' };
  proposedClass: string;
  rationale: string;
  faithfulnessOk: boolean;
  humanComment?: string;
};
```

## Триаж

```mermaid
flowchart TD
  ingest[ingest] --> retrieve[retrieve_docs]
  retrieve --> vision{есть скрин?}
  vision -->|да| facts[maybe_vision: факты, не вердикт]
  vision -->|нет| bind
  facts --> bind[bind_to_clause]
  bind -->|low conf и rewriteCount < 2| rewrite[rewrite query]
  rewrite --> retrieve
  bind --> classify[classify_evidence]
  classify --> draft[draft_rationale]
  draft --> faith{faithfulness}
  faith -->|fail и циклы < 2| bind
  faith -->|ok| hitl[interrupt PM]
  hitl -->|accept| persist[RemarksService]
  hitl -->|reject_binding| bind
  hitl -->|request_screenshot| pause[cannot_tell persist]
```

Лимит циклов: **2**. Дальше `cannot_tell`, не бесконечный LLM.

## Ретест

```mermaid
flowchart TD
  load[load old/new screens] --> diff[DiffModule]
  diff -->|cannot_compare| ct[cannot_tell → business]
  diff -->|ok| explain[vision: дифф vs претензия vs цитаты]
  explain --> biz[interrupt business]
  biz -->|close| closed[RemarksService closed]
  biz -->|not fixed| defect[назад в defect]
```

Модель на ретесте возвращает только `likely_addressed | likely_unchanged | cannot_tell`. Не `closed`.

## Skill

Текст `skills/uat-triage/SKILL.md` подмешивается в `classify`, `draft`, `explain` (ретест).
