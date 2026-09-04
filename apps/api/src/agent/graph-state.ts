import { Annotation } from '@langchain/langgraph';
import type { ProposedClass, RetestOutcome, Role } from '@remarkround/db';
import type { EvidenceHit } from '../llm/triage-llm';
import type { RetestFacts, TriageFacts } from '../remarks/remarks.service';

/** docs/GRAPH.md: binding — пункт с уверенностью либо честное «нет» / «конфликт». */
export type Binding = { kind: 'clause'; chunkId: string; clauseRef: string | null; confidence: number } | { kind: 'none' } | { kind: 'conflict' };

/** Ответ человека на interrupt PM (docs/WS.md verdict.* и run.cancel). */
export type HumanDecision = { kind: 'accept' } | { kind: 'reject_binding'; comment: string } | { kind: 'request_screenshot' } | { kind: 'cancel' };

/** Ответ бизнеса на interrupt ретеста. */
export type RetestDecision = { kind: 'close' } | { kind: 'not_fixed' } | { kind: 'cancel' };

const last = <T>(_: T, b: T): T => b;

/**
 * Состояние графа триажа (docs/GRAPH.md «Состояние (минимум)» + служебные поля).
 * Всё JSON-сериализуемо: каждый шаг ложится в GraphCheckpoint, interrupt живёт дольше HTTP.
 */
export const TriageState = Annotation.Root({
  projectId: Annotation<string>,
  userId: Annotation<string>,
  role: Annotation<Role>,
  remarkId: Annotation<string>,
  runId: Annotation<string>,
  facts: Annotation<TriageFacts | null>({ reducer: last, default: () => null }),
  query: Annotation<string>({ reducer: last, default: () => '' }),
  /** Переписываний запроса, max 2 */
  rewriteCount: Annotation<number>({ reducer: last, default: () => 0 }),
  /** Циклов faithfulness → bind, max 2 */
  bindLoops: Annotation<number>({ reducer: last, default: () => 0 }),
  hits: Annotation<EvidenceHit[]>({ reducer: last, default: () => [] }),
  retrievedChunkIds: Annotation<string[]>({ reducer: last, default: () => [] }),
  /** Чанки, отвергнутые PM («Не та цитата из ТЗ») */
  excludeChunkIds: Annotation<string[]>({ reducer: last, default: () => [] }),
  /** null — ещё не смотрели; '' — смотрели, фактов нет */
  visionFacts: Annotation<string | null>({ reducer: last, default: () => null }),
  binding: Annotation<Binding>({ reducer: last, default: () => ({ kind: 'none' }) }),
  proposedClass: Annotation<ProposedClass | null>({ reducer: last, default: () => null }),
  chunkIds: Annotation<string[]>({ reducer: last, default: () => [] }),
  duplicateOfNumber: Annotation<number | null>({ reducer: last, default: () => null }),
  reason: Annotation<string>({ reducer: last, default: () => '' }),
  rationale: Annotation<string[]>({ reducer: last, default: () => [] }),
  faithfulnessOk: Annotation<boolean>({ reducer: last, default: () => false }),
  faithfulnessIssue: Annotation<string | null>({ reducer: last, default: () => null }),
  humanComment: Annotation<string | null>({ reducer: last, default: () => null }),
  decision: Annotation<HumanDecision | null>({ reducer: last, default: () => null }),
});

export type TriageStateType = typeof TriageState.State;

export interface DiffInfo {
  diffShot: { storageKey: string; width: number; height: number };
  regionText: string;
}

/** ADR 002 п.4: H1 — дифф считает алгоритм, модель поясняет; H0 — модель судит по двум кадрам. Победитель A/B — дефолт (docs/EVALS.md). */
export type RetestStrategy = 'diff_explain' | 'llm_only';

export const RetestState = Annotation.Root({
  projectId: Annotation<string>,
  userId: Annotation<string>,
  role: Annotation<Role>,
  remarkId: Annotation<string>,
  runId: Annotation<string>,
  strategy: Annotation<RetestStrategy>({ reducer: last, default: () => 'diff_explain' }),
  facts: Annotation<RetestFacts | null>({ reducer: last, default: () => null }),
  retestSize: Annotation<{ width: number; height: number } | null>({ reducer: last, default: () => null }),
  diff: Annotation<DiffInfo | null>({ reducer: last, default: () => null }),
  result: Annotation<{ outcome: RetestOutcome; explanation: string } | null>({ reducer: last, default: () => null }),
  decision: Annotation<RetestDecision | null>({ reducer: last, default: () => null }),
});

export type RetestStateType = typeof RetestState.State;
