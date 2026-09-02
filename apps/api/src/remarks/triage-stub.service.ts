import { Injectable } from '@nestjs/common';
import type { ProposedClass } from '@remarkround/db';
import { RagService, SearchHit } from '../rag/rag.service';
import type { ProjectContext } from '../tenancy/project-context';

export interface TriageInput {
  description: string;
  expected?: string | null;
  pageOrScreen?: string | null;
  hasScreenshot: boolean;
  /** Другие замечания раунда для поиска повтора. */
  siblings: Array<{ number: number; description: string }>;
  /** Комментарий PM после «Не та цитата из ТЗ»: ищем другое место. */
  rebindComment?: string;
  /** Чанк, который PM отверг. */
  excludeChunkIds?: string[];
}

export interface TriageProposal {
  proposedClass: ProposedClass;
  /** Абзацы черновика разбора. */
  rationale: string[];
  chunkIds: string[];
  duplicateOfNumber?: number;
  model: string;
}

const BOUND_SCORE = 0.45;
const GAP_SCORE = 0.28;
const VISUAL = /цвет|кноп|шрифт|отступ|логотип|вёрстк|верстк|выравн|размер|иконк|поехал|перекрыва|центр|футер|шапк/i;
const GAP_SECTION = /чего в тз нет|нет:/i;

/**
 * Заглушка черновика для фазы 3 (docs/PHASES.md: «ещё без LLM, можно заглушка»).
 * Retrieve настоящий (RagModule), решение — правила по близости. В фазе 6 её место
 * занимает граф LangGraph, интерфейс TriageProposal остаётся.
 */
@Injectable()
export class TriageStubService {
  readonly model = 'stub/retrieve-rules';

  constructor(private readonly rag: RagService) {}

  async propose(ctx: ProjectContext, input: TriageInput): Promise<TriageProposal> {
    const duplicate = findDuplicate(input);
    if (duplicate) {
      return {
        proposedClass: 'duplicate',
        rationale: [`Похоже на повтор №${duplicate.number}.`, `Та же претензия, что и в №${duplicate.number}: «${firstLine(duplicate.description)}». Отдельной работы не нужно.`],
        chunkIds: [],
        duplicateOfNumber: duplicate.number,
        model: this.model,
      };
    }

    const query = [input.description, input.expected, input.pageOrScreen, input.rebindComment].filter(Boolean).join('. ');
    const exclude = new Set(input.excludeChunkIds ?? []);
    const hits = (await this.rag.search(ctx, query, 6)).filter((h) => !exclude.has(h.chunkId));
    const top = hits[0];
    const protocol = hits.find((h) => h.documentKind === 'protocol' && h.score >= GAP_SCORE);
    /** После «Не та цитата из ТЗ» PM ждёт другое место: показываем лучший оставшийся раздел даже при слабой близости. */
    const forceCite = Boolean(input.rebindComment);

    if (top && top.score >= GAP_SCORE && GAP_SECTION.test(`${top.section ?? ''} ${top.content}`) && top.score < BOUND_SCORE + 0.1) {
      return {
        proposedClass: 'change_request_candidate',
        rationale: [
          'Похоже, это новое желание.',
          `ТЗ (${top.section ?? 'раздел без номера'}) прямо относит это к тому, чего в проекте нет. Это не поломка, а новое желание — решите, брать ли его в работу отдельно.`,
        ],
        chunkIds: [top.chunkId],
        model: this.model,
      };
    }

    if (!input.hasScreenshot && VISUAL.test(query)) {
      return {
        proposedClass: 'cannot_tell',
        rationale: ['Недостаточно данных.', 'Для претензии про цвет или вёрстку нужен скрин: без него не сравнить с ТЗ.'],
        chunkIds: top && (forceCite || top.score >= BOUND_SCORE) ? [top.chunkId] : [],
        model: this.model,
      };
    }

    if (top && (forceCite || top.score >= BOUND_SCORE)) {
      const chunkIds = [top.chunkId, ...(protocol && protocol.chunkId !== top.chunkId ? [protocol.chunkId] : [])];
      return {
        proposedClass: 'defect_candidate',
        rationale: [
          'Похоже, это поломка относительно ТЗ.',
          `ТЗ (${top.section ?? 'раздел без номера'}) требует: ${shortQuote(top)}.${input.hasScreenshot ? ' На кадре — иначе.' : ''}${protocol ? ` Протокол это подтверждает (${protocol.section ?? 'без раздела'}).` : ''} Похожих замечаний в раунде нет.`,
        ],
        chunkIds,
        model: this.model,
      };
    }

    return {
      proposedClass: 'unspecified',
      rationale: [
        'В бумагах нет опоры.',
        `Про «${firstLine(input.description)}» ни в ТЗ, ни в протоколе прямой нормы нет${top ? ` (ближайший раздел ${top.section ?? 'без номера'}, близость ${top.score.toFixed(2)})` : ''}. Решите вы: работа это или новое желание.`,
      ],
      chunkIds: top && (forceCite || top.score >= GAP_SCORE) ? [top.chunkId] : [],
      model: this.model,
    };
  }
}

function findDuplicate(input: TriageInput): { number: number; description: string } | null {
  const mine = tokens(input.description);
  if (mine.size < 2) return null;
  let best: { number: number; description: string; overlap: number } | null = null;
  for (const s of input.siblings) {
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

function shortQuote(hit: SearchHit): string {
  const clean = hit.content.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/\s+/g, ' ').trim();
  const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return `«${sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence}»`;
}

function firstLine(s: string): string {
  return s.split('\n').map((l) => l.trim()).find(Boolean) ?? s;
}
