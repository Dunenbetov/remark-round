import { END, START, StateGraph, interrupt, type BaseCheckpointSaver } from '@langchain/langgraph';
import { describeRegion, percent } from '../diff/diff.service';
import type { LlmCallMeta } from '../llm/triage-llm';
import type { ProjectContext } from '../tenancy/project-context';
import { loadFrame, type GraphDeps } from './graph-deps';
import { RetestState, type RetestDecision, type RetestStateType as S, type RetestStrategy } from './graph-state';
import type { Phase } from './run-events';

/**
 * Победитель A/B фазы 9 (docs/EVALS.md «A/B»): pixel-diff + explain. `RETEST_STRATEGY=llm_only` включает
 * проигравшую ветку для сравнения, не для продукта.
 */
export const DEFAULT_RETEST_STRATEGY: RetestStrategy = 'diff_explain';

export function retestStrategyFromEnv(value = process.env['RETEST_STRATEGY']): RetestStrategy {
  return value === 'llm_only' ? 'llm_only' : DEFAULT_RETEST_STRATEGY;
}

export interface RetestInput {
  projectId: string;
  userId: string;
  role: ProjectContext['role'];
  remarkId: string;
  runId: string;
  strategy: RetestStrategy;
}

/**
 * Граф ретеста (docs/GRAPH.md «Ретест», ADR 002): пиксели считает DiffModule, модель только поясняет,
 * относится ли красное к претензии (likely_addressed | likely_unchanged | cannot_tell). Закрывает бизнес.
 */
export function buildRetestGraph(deps: GraphDeps, checkpointer: BaseCheckpointSaver) {
  const ctxOf = (s: S): ProjectContext => ({ userId: s.userId, projectId: s.projectId, role: s.role });
  const meta = (s: S, node: LlmCallMeta['node']): LlmCallMeta => ({ node, runId: s.runId, remarkId: s.remarkId, projectId: s.projectId });
  const phase = (s: S, p: Phase): void => deps.events.emit(s.remarkId, { type: 'run.phase', runId: s.runId, phase: p });

  const load = async (s: S) => {
    phase(s, 'diffing');
    return { facts: await deps.remarks.retestFacts(ctxOf(s), s.remarkId) };
  };

  const diff = async (s: S) => {
    const facts = s.facts!;
    if (!facts.originalKey) {
      return { result: { outcome: 'cannot_tell' as const, explanation: 'Старого кадра нет — сравнить не с чем. Проверьте вручную и закройте, если исправлено.' } };
    }
    const [before, after] = await Promise.all([deps.storage.read(facts.originalKey), deps.storage.read(facts.retestKey)]);
    const r = deps.diff.compare(before, after);
    if (r.kind === 'cannot_compare') {
      return { retestSize: r.after ?? null, result: { outcome: 'cannot_tell' as const, explanation: `Не могу сравнить кадры: ${r.reason}.` } };
    }
    const retestSize = { width: r.width, height: r.height };
    if (r.changedPixels === 0 || !r.region) {
      return { retestSize, result: { outcome: 'likely_unchanged' as const, explanation: 'Новый кадр совпадает со старым пиксель в пиксель — ничего не изменилось.' } };
    }
    const storageKey = await deps.storage.save(s.projectId, 'diff.png', r.png);
    const regionText = `область ${r.region.width}×${r.region.height} px ${describeRegion(r.region, r)}, изменено ${percent(r.ratio)} кадра`;
    return { retestSize, diff: { diffShot: { storageKey, width: r.width, height: r.height }, regionText } };
  };

  const afterDiff = (s: S): 'apply_retest' | 'explain' => (s.result ? 'apply_retest' : 'explain');

  const afterLoad = (s: S): 'pixel_diff' | 'judge_frames' => (s.strategy === 'llm_only' ? 'judge_frames' : 'pixel_diff');

  /** H0 (llm_only): «исправлено ли по двум кадрам» — без диффа, без проверки размеров. Проигравшая ветка A/B, оставлена для сравнения. */
  const judge = async (s: S) => {
    const facts = s.facts!;
    if (!facts.originalKey) {
      return { result: { outcome: 'cannot_tell' as const, explanation: 'Старого кадра нет — сравнить не с чем. Проверьте вручную и закройте, если исправлено.' } };
    }
    const [before, after] = await Promise.all([loadFrame(deps.storage, facts.originalKey), loadFrame(deps.storage, facts.retestKey)]);
    if (!before || !after) {
      return { result: { outcome: 'cannot_tell' as const, explanation: 'Кадр не PNG/JPG — модели не показать. Проверьте вручную.' } };
    }
    const result = await deps.llm.retestJudge(meta(s, 'judge'), { description: facts.description, expected: facts.expected, before, after, citations: facts.citations });
    return { result };
  };

  /** Vision на триплете old/new/diff + претензия + цитаты. Не «исправлено ли по двум кадрам». */
  const explain = async (s: S) => {
    const facts = s.facts!;
    const [before, after, diffFrame] = await Promise.all([loadFrame(deps.storage, facts.originalKey!), loadFrame(deps.storage, facts.retestKey), loadFrame(deps.storage, s.diff!.diffShot.storageKey)]);
    if (!before || !after || !diffFrame) {
      return { result: { outcome: 'cannot_tell' as const, explanation: `Красное на диффе: ${s.diff!.regionText}. Относится ли это к претензии — решите вы.` } };
    }
    const result = await deps.llm.retestExplain(meta(s, 'explain'), {
      description: facts.description,
      expected: facts.expected,
      before,
      after,
      diff: diffFrame,
      regionText: s.diff!.regionText,
      citations: facts.citations,
    });
    return { result };
  };

  const apply = async (s: S) => {
    await deps.remarks.applyRetest(ctxOf(s), s.remarkId, s.runId, {
      outcome: s.result!.outcome,
      explanation: s.result!.explanation,
      retestSize: s.retestSize,
      diffShot: s.diff?.diffShot ?? null,
      usage: deps.llm.takeUsage(s.runId),
    });
    phase(s, 'awaiting_business_close');
    return {};
  };

  const hitl = (s: S) => {
    const decision = interrupt<{ remarkId: string; runId: string }, RetestDecision>({ remarkId: s.remarkId, runId: s.runId });
    return { decision };
  };

  const persist = (s: S) => {
    phase(s, 'persisted');
    return {};
  };

  return new StateGraph(RetestState)
    .addNode('load', load)
    .addNode('pixel_diff', diff)
    .addNode('judge_frames', judge)
    .addNode('explain', explain)
    .addNode('apply_retest', apply)
    .addNode('hitl_business', hitl)
    .addNode('persist', persist)
    .addEdge(START, 'load')
    .addConditionalEdges('load', afterLoad, ['pixel_diff', 'judge_frames'])
    .addConditionalEdges('pixel_diff', afterDiff, ['apply_retest', 'explain'])
    .addEdge('explain', 'apply_retest')
    .addEdge('judge_frames', 'apply_retest')
    .addEdge('apply_retest', 'hitl_business')
    .addEdge('hitl_business', 'persist')
    .addEdge('persist', END)
    .compile({ checkpointer });
}

export type RetestGraph = ReturnType<typeof buildRetestGraph>;
