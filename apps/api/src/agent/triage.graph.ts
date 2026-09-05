import { END, START, StateGraph, interrupt, type BaseCheckpointSaver } from '@langchain/langgraph';
import type { ProposedClass } from '@remarkround/db';
import { BOUND_SCORE, headline, type EvidenceHit, type LlmCallMeta, type RemarkFacts } from '../llm/triage-llm';
import type { SearchHit } from '../rag/rag.service';
import type { TriageFacts } from '../remarks/remarks.service';
import type { ProjectContext } from '../tenancy/project-context';
import { checkFaithfulness } from './faithfulness';
import { detectInjection, injectionNote } from './guardrails';
import { loadFrame, type GraphDeps } from './graph-deps';
import { TriageState, type HumanDecision, type TriageStateType as S } from './graph-state';
import type { Phase } from './run-events';

/** Лимиты циклов (docs/GRAPH.md): дальше cannot_tell, не бесконечный LLM. */
export const MAX_REWRITES = 2;
export const MAX_BIND_LOOPS = 2;
const RETRIEVE_K = 6;

/** Вход графа: остальное состояние ноды соберут сами. */
export interface TriageInput {
  projectId: string;
  userId: string;
  role: ProjectContext['role'];
  remarkId: string;
  runId: string;
  /** Комментарий PM, если прогон продолжают без чекпоинта (seed-данные, старые run). */
  humanComment: string | null;
  excludeChunkIds: string[];
}

export interface HitlRequest {
  remarkId: string;
  runId: string;
  proposedClass: ProposedClass;
}

/**
 * Граф триажа (docs/GRAPH.md «Триаж»). Один граф, ветвления, два цикла (rewrite ≤ 2, faithfulness → bind ≤ 2),
 * interrupt на PM с чекпоинтом в Postgres; «Не та цитата» продолжает тот же run (thread_id = runId).
 * Запись только через RemarksService (ноды propose / persist), LLM только через LlmModule.
 */
export function buildTriageGraph(deps: GraphDeps, checkpointer: BaseCheckpointSaver) {
  const ctxOf = (s: S): ProjectContext => ({ userId: s.userId, projectId: s.projectId, role: s.role });
  const meta = (s: S, node: LlmCallMeta['node']): LlmCallMeta => ({ node, runId: s.runId, remarkId: s.remarkId, projectId: s.projectId });
  const phase = (s: S, p: Phase): void => deps.events.emit(s.remarkId, { type: 'run.phase', runId: s.runId, phase: p });

  const ingest = async (s: S) => {
    const facts = await deps.remarks.triageFacts(ctxOf(s), s.remarkId);
    // Продолжение без чекпоинта после «Не та цитата»: исключаем уже показанные чанки.
    const exclude = s.humanComment ? [...new Set([...s.excludeChunkIds, ...facts.citedChunkIds])] : s.excludeChunkIds;
    // Guardrail входа: находка не останавливает разбор, а помечает его (REMARKROUND.md §12).
    const injection = detectInjection(facts.description, facts.expected, facts.pageOrScreen, s.humanComment);
    return { facts, query: buildQuery(facts, s.humanComment), excludeChunkIds: exclude, injectionMatches: injection.matches };
  };

  const retrieve = async (s: S) => {
    phase(s, 'retrieving');
    const exclude = new Set(s.excludeChunkIds);
    const fresh = (await deps.rag.search(ctxOf(s), s.query, RETRIEVE_K)).filter((h) => !exclude.has(h.chunkId)).map(toEvidence);
    // После rewrite прошлые находки не теряем: лучший раздел выбирается из объединения.
    const merged = new Map<string, EvidenceHit>();
    for (const h of [...s.hits, ...fresh]) if (!merged.has(h.chunkId) || merged.get(h.chunkId)!.score < h.score) merged.set(h.chunkId, h);
    const hits = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, RETRIEVE_K + 2);
    return { hits, retrievedChunkIds: hits.map((h) => h.chunkId) };
  };

  const afterRetrieve = (s: S): 'maybe_vision' | 'bind_to_clause' => (s.facts?.screenshotKey && s.visionFacts === null && deps.llm.canSee ? 'maybe_vision' : 'bind_to_clause');

  /** Факты кадра, не вердикт (REMARKROUND.md §2.1 п.3: скриншот меняет ответ). */
  const vision = async (s: S) => {
    phase(s, 'vision');
    const image = await loadFrame(deps.storage, s.facts!.screenshotKey!);
    const facts = image ? await deps.llm.visionFacts(meta(s, 'vision'), { image, ...remarkFacts(s.facts!) }) : null;
    return { visionFacts: facts ?? '' };
  };

  const bind = (s: S) => {
    phase(s, 'binding');
    const top = s.hits[0];
    const forced = Boolean(s.humanComment);
    if (top && (top.score >= BOUND_SCORE || forced)) {
      return { binding: { kind: 'clause' as const, chunkId: top.chunkId, clauseRef: top.section, confidence: top.score } };
    }
    return { binding: { kind: 'none' as const } };
  };

  const afterBind = (s: S): 'rewrite_query' | 'classify_evidence' => (s.binding.kind === 'none' && s.rewriteCount < MAX_REWRITES && !s.humanComment ? 'rewrite_query' : 'classify_evidence');

  const rewrite = async (s: S) => {
    const query = await deps.llm.rewriteQuery(meta(s, 'rewrite'), {
      ...remarkFacts(s.facts!),
      previousQuery: s.query,
      visionFacts: s.visionFacts || null,
      humanComment: s.humanComment,
      triedSections: s.hits.map((h) => h.section ?? '').filter(Boolean),
    });
    return { query, rewriteCount: s.rewriteCount + 1 };
  };

  const classify = async (s: S) => {
    phase(s, 'drafting');
    const bound = s.binding.kind === 'clause' ? (s.hits.find((h) => h.chunkId === (s.binding as { chunkId: string }).chunkId) ?? null) : null;
    const res = await deps.llm.classify(meta(s, 'classify'), {
      ...remarkFacts(s.facts!),
      visionFacts: s.visionFacts || null,
      hits: s.hits,
      bound,
      siblings: s.facts!.siblings,
      humanComment: s.humanComment,
      faithfulnessIssue: s.faithfulnessIssue,
      injectionSuspected: s.injectionMatches.length > 0,
    });
    const allowed = new Set(s.retrievedChunkIds);
    return { proposedClass: res.proposedClass, chunkIds: res.chunkIds.filter((id) => allowed.has(id)), duplicateOfNumber: res.duplicateOfNumber ?? null, reason: res.reason };
  };

  const draft = async (s: S) => {
    const head = headline(s.proposedClass!, s.duplicateOfNumber ?? undefined);
    deps.events.emit(s.remarkId, { type: 'run.token', runId: s.runId, delta: `${head}\n\n` });
    const body = await deps.llm.draft(
      meta(s, 'draft'),
      {
        ...remarkFacts(s.facts!),
        visionFacts: s.visionFacts || null,
        hits: s.hits,
        bound: null,
        siblings: s.facts!.siblings,
        humanComment: s.humanComment,
        faithfulnessIssue: s.faithfulnessIssue,
        injectionSuspected: s.injectionMatches.length > 0,
        proposedClass: s.proposedClass!,
        chunkIds: s.chunkIds,
        duplicateOfNumber: s.duplicateOfNumber ?? undefined,
        reason: s.reason,
      },
      (delta) => deps.events.emit(s.remarkId, { type: 'run.token', runId: s.runId, delta }),
    );
    // Пометку про инструкции в тексте ставит код: PM видит, что модель их читала как содержание.
    const rationale = s.injectionMatches.length ? [head, body, injectionNote(s.injectionMatches)] : [head, body];
    if (rationale.length > 2) deps.events.emit(s.remarkId, { type: 'run.token', runId: s.runId, delta: `\n\n${rationale[2]}` });
    return { rationale };
  };

  /** Без LLM: черновик не ссылается на раздел, которого нет среди цитат (REMARKROUND.md §12 guardrail выхода). */
  const faithfulness = (s: S) => {
    const cited = new Set(s.chunkIds);
    const check = checkFaithfulness({
      rationale: s.rationale.join('\n\n'),
      allowedSections: s.hits.filter((h) => cited.has(h.chunkId)).map((h) => h.section),
      remarkText: s.facts?.description,
      proposedClass: s.proposedClass!,
      chunkIds: s.chunkIds,
      hasScreenshot: Boolean(s.facts?.screenshotKey),
    });
    if (check.ok) return { faithfulnessOk: true, faithfulnessIssue: null };
    const issue = check.issues.join('; ');
    if (s.bindLoops < MAX_BIND_LOOPS) return { faithfulnessOk: false, faithfulnessIssue: issue, bindLoops: s.bindLoops + 1 };
    return {
      faithfulnessOk: true,
      faithfulnessIssue: issue,
      proposedClass: 'cannot_tell' as const,
      chunkIds: [],
      duplicateOfNumber: null,
      rationale: [headline('cannot_tell'), `Черновик дважды не прошёл проверку по документам (${issue}). Разберите вручную или пришлите кадр этого экрана.`],
    };
  };

  const afterFaithfulness = (s: S): 'propose' | 'bind_to_clause' => (s.faithfulnessOk ? 'propose' : 'bind_to_clause');

  /** Единственная запись предложения — RemarksService.applyProposal. Отдельная нода: interrupt ниже перезапускает свою ноду при resume. */
  const propose = async (s: S) => {
    const view = await deps.remarks.applyProposal(ctxOf(s), s.remarkId, s.runId, {
      proposedClass: s.proposedClass!,
      rationale: s.rationale,
      chunkIds: s.chunkIds,
      duplicateOfNumber: s.duplicateOfNumber,
      visionFacts: s.visionFacts || null,
      usage: deps.llm.takeUsage(s.runId),
    });
    deps.events.emit(s.remarkId, { type: 'run.citations', runId: s.runId, citations: view.citations });
    deps.events.emit(s.remarkId, { type: 'run.proposal', runId: s.runId, proposedClass: s.proposedClass!, rationale: s.rationale.join('\n\n') });
    phase(s, 'awaiting_pm');
    return {};
  };

  /** HITL: граф спит в чекпоинте, пока PM не нажмёт кнопку — часы или дни. */
  const hitl = (s: S) => {
    const decision = interrupt<HitlRequest, HumanDecision>({ remarkId: s.remarkId, runId: s.runId, proposedClass: s.proposedClass! });
    if (decision.kind === 'reject_binding') {
      const injection = detectInjection(s.facts?.description, s.facts?.expected, decision.comment);
      return {
        decision,
        injectionMatches: injection.matches,
        humanComment: decision.comment,
        query: buildQuery(s.facts!, decision.comment),
        excludeChunkIds: [...new Set([...s.excludeChunkIds, ...s.chunkIds])],
        hits: [] as EvidenceHit[],
        rewriteCount: 0,
        bindLoops: 0,
        faithfulnessIssue: null,
        binding: { kind: 'none' as const },
      };
    }
    return { decision };
  };

  const afterHitl = (s: S): 'persist' | 'retrieve_docs' | 'pause' | typeof END => {
    switch (s.decision?.kind) {
      case 'accept':
        return 'persist';
      case 'reject_binding':
        return 'retrieve_docs';
      case 'request_screenshot':
        return 'pause';
      default:
        return END;
    }
  };

  /** Вердикт уже записан RemarksService.verdict до resume; нода закрывает прогон для комнаты. */
  const persist = (s: S) => {
    phase(s, 'persisted');
    return {};
  };

  const pause = (s: S) => {
    phase(s, 'persisted');
    return {};
  };

  return new StateGraph(TriageState)
    .addNode('ingest', ingest)
    .addNode('retrieve_docs', retrieve)
    .addNode('maybe_vision', vision)
    .addNode('bind_to_clause', bind)
    .addNode('rewrite_query', rewrite)
    .addNode('classify_evidence', classify)
    .addNode('draft_rationale', draft)
    .addNode('faithfulness_gate', faithfulness)
    .addNode('propose', propose)
    .addNode('hitl', hitl)
    .addNode('persist', persist)
    .addNode('pause', pause)
    .addEdge(START, 'ingest')
    .addEdge('ingest', 'retrieve_docs')
    .addConditionalEdges('retrieve_docs', afterRetrieve, ['maybe_vision', 'bind_to_clause'])
    .addEdge('maybe_vision', 'bind_to_clause')
    .addConditionalEdges('bind_to_clause', afterBind, ['rewrite_query', 'classify_evidence'])
    .addEdge('rewrite_query', 'retrieve_docs')
    .addEdge('classify_evidence', 'draft_rationale')
    .addEdge('draft_rationale', 'faithfulness_gate')
    .addConditionalEdges('faithfulness_gate', afterFaithfulness, ['propose', 'bind_to_clause'])
    .addEdge('propose', 'hitl')
    .addConditionalEdges('hitl', afterHitl, ['persist', 'retrieve_docs', 'pause', END])
    .addEdge('persist', END)
    .addEdge('pause', END)
    .compile({ checkpointer });
}

export type TriageGraph = ReturnType<typeof buildTriageGraph>;

export function buildQuery(facts: TriageFacts, humanComment: string | null): string {
  return [facts.description, facts.expected, facts.pageOrScreen, humanComment].filter(Boolean).join('. ');
}

function remarkFacts(f: TriageFacts): RemarkFacts {
  return { description: f.description, expected: f.expected, pageOrScreen: f.pageOrScreen, hasScreenshot: f.hasScreenshot };
}

function toEvidence(h: SearchHit): EvidenceHit {
  return { chunkId: h.chunkId, section: h.section, documentKind: h.documentKind, documentTitle: h.documentTitle, content: h.content, score: h.score };
}
