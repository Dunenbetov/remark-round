import { END, START, StateGraph, interrupt, type BaseCheckpointSaver } from '@langchain/langgraph';
import { describeRegion, percent } from '../diff/diff.service';
import type { LlmCallMeta } from '../llm/triage-llm';
import type { ProjectContext } from '../tenancy/project-context';
import { loadFrame, type GraphDeps } from './graph-deps';
import { RetestState, type RetestDecision, type RetestStateType as S, type RetestStrategy } from './graph-state';
import type { Phase } from './run-events';

/**
 * Стратегия по умолчанию — pixel-diff + explain (ADR 002). По замерам M1 (docs/EVALS.md, раздел 7) качество с H0
 * «два кадра в модель» на паритете: выигрыш даёт детерминированная предпроверка кадров, H1 остаётся за неё и за
 * картинку диффа для человека. `RETEST_STRATEGY=llm_only` включает ветку H0 для сравнения, не для продукта.
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
/**
 * Пояснение к «сравнить нельзя» — с выходом для заказчика, а не тупиком: кадры разного размера — самый частый случай
 * у людей, которые режут скрин руками (замечание владельца 20.09). Пиксели при этом честно не сопоставимы (ADR 002),
 * поэтому подсказываем размер первого кадра или закрытие без кадра (ADR 010). Заголовок «Не могу сравнить кадры»
 * ставит интерфейс, здесь его не повторяем.
 */
export function cannotCompareText(r: { reason: string; before?: { width: number; height: number }; after?: { width: number; height: number } }): string {
  if (r.before && r.after && (r.before.width !== r.after.width || r.before.height !== r.after.height)) {
    return `Кадры разного размера: ${r.before.width}×${r.before.height} и ${r.after.width}×${r.after.height} — пиксели не сопоставить. Приложите кадр того же размера, что первый (${r.before.width}×${r.before.height}), или, если проверили на стенде, закройте без кадра.`;
  }
  // Без слова «исправлено»: его не произносит система, только человек (evals: RETEST_CLOSING). Версия 20.09 «…закройте
  // без кадра, если исправлено» провалила retest-incomparable-zoom в M1 4 раза из 4 — HONEST-NOTES.md
  return `${r.reason.charAt(0).toUpperCase()}${r.reason.slice(1)}. Проверьте на стенде — если всё в порядке, закройте без кадра.`;
}

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
      return { result: { outcome: 'cannot_tell' as const, explanation: 'Старого кадра нет — сравнить не с чем. Проверьте на стенде — если всё в порядке, закрывайте.' } };
    }
    const [before, after] = await Promise.all([deps.storage.read(facts.originalKey), deps.storage.read(facts.retestKey)]);
    const r = deps.diff.compare(before, after);
    if (r.kind === 'cannot_compare') {
      return { retestSize: r.after ?? null, result: { outcome: 'cannot_tell' as const, explanation: cannotCompareText(r) } };
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
      return { result: { outcome: 'cannot_tell' as const, explanation: 'Старого кадра нет — сравнить не с чем. Проверьте на стенде — если всё в порядке, закрывайте.' } };
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
