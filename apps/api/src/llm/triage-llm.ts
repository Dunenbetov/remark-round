import type { DocumentKind, ProposedClass, RetestOutcome } from '@remarkround/db';

/**
 * Контракт LLM-нод графа (docs/GRAPH.md). Две реализации: OpenAI (ключ задан) и правила
 * (без сети — тесты и стенд без ключа). Граф не знает, какая из них под ним.
 * Каждый вызов несёт meta: имя ноды, runId, projectId — это же ляжет в span Langfuse (фаза 8).
 */

export interface LlmCallMeta {
  node: 'vision' | 'rewrite' | 'classify' | 'draft' | 'explain' | 'judge';
  runId: string;
  remarkId: string;
  projectId: string;
}

export interface EvidenceHit {
  chunkId: string;
  section: string | null;
  documentKind: DocumentKind;
  documentTitle: string;
  content: string;
  /** Косинусная близость 0..1 */
  score: number;
}

export interface RemarkFacts {
  description: string;
  expected: string | null;
  pageOrScreen: string | null;
  hasScreenshot: boolean;
}

export interface Frame {
  data: Buffer;
  mime: 'image/png' | 'image/jpeg';
}

export interface VisionInput extends RemarkFacts {
  image: Frame;
}

export interface RewriteInput extends RemarkFacts {
  previousQuery: string;
  visionFacts: string | null;
  humanComment: string | null;
  /** Подписи разделов, которые уже нашли и которые не подошли. */
  triedSections: string[];
}

export interface ClassifyInput extends RemarkFacts {
  visionFacts: string | null;
  hits: EvidenceHit[];
  /** Привязка ноды bind: лучший чанк, если близость достаточная. */
  bound: EvidenceHit | null;
  siblings: Array<{ number: number; description: string }>;
  humanComment: string | null;
  /** Почему прошлый черновик не прошёл faithfulness — чтобы не повторить. */
  faithfulnessIssue: string | null;
  /** Guardrail входа: в тексте есть инструкции для модели — модели говорят читать их как содержание. */
  injectionSuspected?: boolean;
}

export interface ClassifyResult {
  proposedClass: ProposedClass;
  /** Только chunkId из hits. */
  chunkIds: string[];
  duplicateOfNumber?: number;
  /** Короткая причина для draft (не показывается человеку напрямую). */
  reason: string;
}

export interface DraftInput extends ClassifyInput, ClassifyResult {}

export interface RetestExplainInput {
  description: string;
  expected: string | null;
  before: Frame;
  after: Frame;
  diff: Frame;
  /** «область 210×46 px слева сверху, изменено 1.2% кадра» */
  regionText: string;
  citations: Array<{ section: string | null; text: string }>;
}

export interface RetestExplainResult {
  outcome: RetestOutcome;
  explanation: string;
}

/** H0 в A/B (docs/EVALS.md): два кадра без диффа — «исправлено ли?». В продукте выключен, если не победил. */
export interface RetestJudgeInput {
  description: string;
  expected: string | null;
  before: Frame;
  after: Frame;
  citations: Array<{ section: string | null; text: string }>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Стоимость по прайсу модели (apps/api/src/llm/pricing.ts); 0 без сети. */
  costUsd: number;
}

export interface TriageLlm {
  /** Подпись в AgentRun.model */
  readonly model: string;
  /** Умеет смотреть кадр: без этого нода vision пропускается, а не рисует фазу впустую. */
  readonly canSee: boolean;
  visionFacts(meta: LlmCallMeta, input: VisionInput): Promise<string | null>;
  rewriteQuery(meta: LlmCallMeta, input: RewriteInput): Promise<string>;
  classify(meta: LlmCallMeta, input: ClassifyInput): Promise<ClassifyResult>;
  /** Абзац обоснования (без первой строки-заголовка: её ставит граф по классу). */
  draft(meta: LlmCallMeta, input: DraftInput, onToken?: (delta: string) => void): Promise<string>;
  retestExplain(meta: LlmCallMeta, input: RetestExplainInput): Promise<RetestExplainResult>;
  /** Ретест без диффа (стратегия `llm_only`, H0 A/B): та же тройка исходов, модель видит только два кадра. */
  retestJudge(meta: LlmCallMeta, input: RetestJudgeInput): Promise<RetestExplainResult>;
  /** Токены и стоимость, накопленные по runId с последнего вызова; после — обнуляются. */
  takeUsage(runId: string): LlmUsage;
}

/** Первая строка черновика — дословно из docs/ui/COPY.md, по классу. */
export function headline(proposedClass: ProposedClass, duplicateOfNumber?: number): string {
  switch (proposedClass) {
    case 'defect_candidate':
      return 'Похоже, это поломка относительно ТЗ.';
    case 'change_request_candidate':
      return 'Похоже, это новое желание.';
    case 'unspecified':
      return 'В бумагах нет опоры.';
    case 'duplicate':
      return duplicateOfNumber ? `Похоже на повтор №${duplicateOfNumber}.` : 'Похоже на повтор.';
    case 'cannot_tell':
      return 'Недостаточно данных.';
  }
}

/** Близость, с которой чанк считается опорой; ниже — «в бумагах нет опоры». */
export const BOUND_SCORE = 0.45;
/** Близость, с которой чанк хотя бы показывают как ближайший раздел. */
export const GAP_SCORE = 0.28;
const VISUAL = /цвет|кноп|шрифт|отступ|логотип|вёрстк|верстк|выравн|размер|иконк|поехал|перекрыва|центр|футер|шапк/i;
const GAP_SECTION = /чего в тз нет|нет:/i;

/**
 * Правила без LLM: та же логика, что заглушка фазы 3, теперь как одна из реализаций контракта.
 * Работает офлайн (тесты, стенд без ключа) и остаётся честной: не выдумывает разделы и не закрывает.
 */
export class RulesTriageLlm implements TriageLlm {
  readonly model: string = 'rules/retrieve-only';
  readonly canSee = false;

  async visionFacts(): Promise<string | null> {
    return null;
  }

  async rewriteQuery(_meta: LlmCallMeta, input: RewriteInput): Promise<string> {
    // Второй заход — другими словами: «как должно быть» и экран вперёд, потом суть без служебных слов.
    const parts = [input.expected, input.pageOrScreen, input.humanComment, keywords(input.description), input.visionFacts].filter(Boolean);
    const next = parts.join('. ');
    return next && next !== input.previousQuery ? next : `${keywords(input.description)} требования`;
  }

  async classify(_meta: LlmCallMeta, input: ClassifyInput): Promise<ClassifyResult> {
    const duplicate = findDuplicate(input.description, input.siblings);
    if (duplicate) return { proposedClass: 'duplicate', chunkIds: [], duplicateOfNumber: duplicate.number, reason: `повтор №${duplicate.number}` };

    const top = input.hits[0];
    const forceCite = Boolean(input.humanComment);
    const query = [input.description, input.expected, input.pageOrScreen].filter(Boolean).join('. ');
    const protocol = input.hits.find((h) => h.documentKind === 'protocol' && h.score >= GAP_SCORE);

    if (top && top.score >= GAP_SCORE && GAP_SECTION.test(`${top.section ?? ''} ${top.content}`) && top.score < BOUND_SCORE + 0.1) {
      return { proposedClass: 'change_request_candidate', chunkIds: [top.chunkId], reason: 'раздел «чего в ТЗ нет»' };
    }
    if (!input.hasScreenshot && VISUAL.test(query)) {
      return { proposedClass: 'cannot_tell', chunkIds: top && (forceCite || top.score >= BOUND_SCORE) ? [top.chunkId] : [], reason: 'визуальная претензия без кадра' };
    }
    if (input.bound || (top && forceCite)) {
      const cite = input.bound ?? top!;
      const chunkIds = [cite.chunkId, ...(protocol && protocol.chunkId !== cite.chunkId ? [protocol.chunkId] : [])];
      return { proposedClass: 'defect_candidate', chunkIds, reason: 'есть опора в документах' };
    }
    return { proposedClass: 'unspecified', chunkIds: top && (forceCite || top.score >= GAP_SCORE) ? [top.chunkId] : [], reason: 'опоры нет' };
  }

  async draft(_meta: LlmCallMeta, input: DraftInput, onToken?: (delta: string) => void): Promise<string> {
    const cited = input.chunkIds.map((id) => input.hits.find((h) => h.chunkId === id)).filter((h): h is EvidenceHit => Boolean(h));
    const top = cited[0] ?? null;
    const protocol = cited.find((h) => h.documentKind === 'protocol' || h.documentKind === 'addendum');
    let text: string;
    switch (input.proposedClass) {
      case 'duplicate': {
        const original = input.siblings.find((s) => s.number === input.duplicateOfNumber);
        text = `Та же претензия, что и в №${input.duplicateOfNumber}${original ? `: «${firstLine(original.description)}»` : ''}. Отдельной работы не нужно.`;
        break;
      }
      case 'change_request_candidate':
        text = `ТЗ (${top?.section ?? 'раздел без номера'}) прямо относит это к тому, чего в проекте нет. Это не поломка, а новое желание — решите, брать ли его в работу отдельно.`;
        break;
      case 'cannot_tell':
        text = 'Для претензии про цвет или вёрстку нужен скрин: без него не сравнить с ТЗ.';
        break;
      case 'defect_candidate':
        text = `ТЗ (${top?.section ?? 'раздел без номера'}) требует: ${top ? shortQuote(top.content) : '—'}.${input.visionFacts ? ` На кадре — ${input.visionFacts}` : input.hasScreenshot ? ' На кадре — иначе.' : ''}${protocol ? ` Протокол это подтверждает (${protocol.section ?? 'без раздела'}).` : ''} Похожих замечаний в раунде нет.`;
        break;
      default:
        text = `Про «${firstLine(input.description)}» ни в ТЗ, ни в протоколе прямой нормы нет${top ? ` (ближайший раздел ${top.section ?? 'без номера'}, близость ${top.score.toFixed(2)})` : ''}. Решите вы: работа это или новое желание.`;
    }
    onToken?.(text);
    return text;
  }

  async retestExplain(_meta: LlmCallMeta, input: RetestExplainInput): Promise<RetestExplainResult> {
    // Без модели дифф не толкуем: красное показано, про претензию ли оно — решает человек.
    return { outcome: 'cannot_tell', explanation: `Красное на диффе: ${input.regionText}. Остальное без изменений. Относится ли это к претензии — решите вы.` };
  }

  async retestJudge(): Promise<RetestExplainResult> {
    return { outcome: 'cannot_tell', explanation: 'Без модели по двум кадрам не сужу: сравните сами на стенде — если всё в порядке, закрывайте.' };
  }

  takeUsage(): LlmUsage {
    return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
}

export function findDuplicate(description: string, siblings: Array<{ number: number; description: string }>): { number: number; description: string } | null {
  const mine = tokens(description);
  if (mine.size < 2) return null;
  let best: { number: number; description: string; overlap: number } | null = null;
  for (const s of siblings) {
    const theirs = tokens(s.description);
    if (theirs.size < 2) continue;
    let common = 0;
    for (const t of mine) if (theirs.has(t)) common++;
    const overlap = common / Math.min(mine.size, theirs.size);
    if (overlap >= 0.7 && (!best || overlap > best.overlap)) best = { number: s.number, description: s.description, overlap };
  }
  return best;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/ё/g, 'е')
      .split(/[^a-zа-я0-9]+/)
      .filter((t) => t.length > 2)
      .map((t) => (t.length > 5 ? t.slice(0, 5) : t)),
  );
}

function keywords(s: string): string {
  return s
    .split(/[^a-zA-Zа-яА-ЯёЁ0-9]+/)
    .filter((t) => t.length > 3)
    .join(' ');
}

export function shortQuote(content: string): string {
  const clean = content.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/\s+/g, ' ').trim();
  const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return `«${sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence}»`;
}

export function firstLine(s: string): string {
  return s.split('\n').map((l) => l.trim()).find(Boolean) ?? s;
}
