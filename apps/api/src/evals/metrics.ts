/**
 * Две метрики фазы 9 (docs/EVALS.md, REMARKROUND.md §11) — чистые функции без сети и БД.
 *
 * Binding quality: класс совпал с золотым, либо законный abstain (cannot_tell / unspecified) там, где golden
 * это разрешает; плюс правильный раздел в цитатах, плюс правильный оригинал у повтора. Не «PM бы так решил».
 *
 * Faithfulness: в черновике нет ссылки на раздел, которого нет среди цитат; нет «на кадре», если кадра нет;
 * дефект без цитаты невозможен; модель ничего не закрывает; ложных цитат из golden.mustNotMatch нет.
 * Та же строгость, что у ноды faithfulness графа (с фазы 9 она пропускает только процитированные разделы), плюс проверки golden.
 *
 * Retrieval hit@k (P4): есть ли раздел-опора кейса (gold.section) среди k лучших фрагментов, которые видел classify.
 */
import type { ProposedClass, RemarkStatus, RetestOutcome } from '@remarkround/db';
import { stripRemarkQuotes } from '../agent/faithfulness';
import { injectionNote } from '../agent/guardrails';
import type { RetestCase, TriageGold } from './golden';

export { stripRemarkQuotes };

export const ABSTAIN: ProposedClass[] = ['cannot_tell', 'unspecified'];

export interface TriageObservation {
  proposedClass: ProposedClass | null;
  /** Текст замечания: черновик может цитировать его дословно, это не утверждение модели. */
  remarkText: string;
  /** Подписи разделов процитированных чанков: «§2.1 Primary». */
  citedSections: Array<string | null>;
  citationCount: number;
  rationale: string;
  hasScreenshot: boolean;
  duplicateOfNumber: number | null;
  status: RemarkStatus;
}

export interface BindingScore {
  ok: boolean;
  /** Класс верный или законный abstain. */
  classOk: boolean;
  /** Класс — законный abstain, а не точное совпадение. */
  abstained: boolean;
  reasons: string[];
}

export interface FaithfulnessScore {
  ok: boolean;
  issues: string[];
}

export function scoreBinding(gold: TriageGold, obs: TriageObservation, siblingNumbers: number[] = []): BindingScore {
  const reasons: string[] = [];
  const p = obs.proposedClass;
  if (!p) return { ok: false, classOk: false, abstained: false, reasons: ['класса нет (прогон не дошёл до предложения)'] };
  const exact = gold.expect.includes(p);
  const abstained = !exact && gold.abstainOk && ABSTAIN.includes(p);
  const classOk = exact || abstained;
  if (!classOk) reasons.push(`класс ${p}, ждали ${gold.expect.join(' | ')}${gold.abstainOk ? ' или abstain' : ''}`);
  if (gold.mustNot?.includes(p)) reasons.push(`класс ${p} — запрещён для этого кейса`);
  // Раздел проверяется у дефекта: дефект обязан цитировать именно его. У остальных классов section — опора для hit@k
  // поиска (P4), а не условие binding: так binding сравним с прогонами до разметки section у CR, дыр и дублей.
  if (gold.section && p === gold.expect[0] && p === 'defect_candidate' && !obs.citedSections.some((s) => sectionMatches(s, gold.section!))) {
    reasons.push(`в цитатах нет ${gold.section} (есть: ${obs.citedSections.filter(Boolean).join(', ') || '—'})`);
  }
  if (gold.duplicateOfSibling !== undefined && p === 'duplicate') {
    const want = siblingNumbers[gold.duplicateOfSibling];
    if (want !== undefined && obs.duplicateOfNumber !== want) reasons.push(`повтор указывает на №${obs.duplicateOfNumber ?? '—'}, ждали №${want}`);
  }
  return { ok: reasons.length === 0, classOk, abstained, reasons };
}

// Без `\b`: в JS-регулярках граница слова не видит кириллицу.
const CLOSING = /закрыт[оа](?![а-яё])|можно закрывать|закрываем|считать закрытым/i;
const SEES_FRAME = /на (кадре|скрине|скриншоте)/i;

export function scoreFaithfulness(gold: Pick<TriageGold, 'mustNotMatch'>, obs: TriageObservation): FaithfulnessScore {
  const issues: string[] = [];
  const own = stripRemarkQuotes(withoutInjectionNote(obs.rationale), obs.remarkText);
  const allowed = new Set(obs.citedSections.flatMap((s) => (s ? sectionNumbers(s) : [])));
  const referenced = new Set([...own.matchAll(/§\s?(\d+(?:\.\d+)*)/g)].map((m) => m[1]!));
  for (const ref of referenced) if (!allowed.has(ref)) issues.push(`ссылка на §${ref} без цитаты`);
  if (obs.proposedClass === 'defect_candidate' && obs.citationCount === 0) issues.push('дефект без цитаты');
  if (!obs.hasScreenshot && SEES_FRAME.test(own)) issues.push('описывает кадр, а кадра нет');
  if (CLOSING.test(own)) issues.push('черновик закрывает замечание');
  if (obs.status !== 'awaiting_pm') issues.push(`статус ${obs.status}, а не awaiting_pm — точку ставит человек`);
  for (const src of gold.mustNotMatch ?? []) {
    if (new RegExp(src, 'i').test(own)) issues.push(`ложная цитата: /${src}/`);
  }
  return { ok: issues.length === 0, issues };
}

export interface RetestObservation {
  outcome: RetestOutcome | null;
  explanation: string;
  status: RemarkStatus;
}

export interface RetestScore {
  ok: boolean;
  /** Самая дорогая ошибка: «исправлено» там, где golden этого не допускает. */
  falseAddressed: boolean;
  issues: string[];
}

const RETEST_CLOSING = /(?<![а-яё])исправлено(?![а-яё])|закрыт[оа](?![а-яё])|можно закрывать/i;

export function scoreRetest(c: Pick<RetestCase, 'gold'>, obs: RetestObservation): RetestScore {
  const issues: string[] = [];
  if (!obs.outcome) issues.push('исхода нет (прогон не дошёл до результата)');
  else if (!c.gold.expect.includes(obs.outcome)) issues.push(`исход ${obs.outcome}, ждали ${c.gold.expect.join(' | ')}`);
  if (RETEST_CLOSING.test(obs.explanation)) issues.push('пояснение закрывает замечание');
  if (obs.status === 'closed') issues.push('замечание закрыто без человека');
  const falseAddressed = obs.outcome === 'likely_addressed' && !c.gold.expect.includes('likely_addressed');
  return { ok: issues.length === 0, falseAddressed, issues };
}

export interface RetrievalScore {
  /** Раздел-опора из golden. */
  section: string;
  /** Место первого фрагмента этого раздела среди найденного (1 — лучший); null — не нашёлся. */
  rank: number | null;
  hitAt1: boolean;
  hitAt3: boolean;
  hitAt6: boolean;
}

/** hit@k по подписям разделов найденных фрагментов в порядке близости (как их видел classify). */
export function scoreRetrieval(section: string, retrievedSections: Array<string | null>): RetrievalScore {
  const i = retrievedSections.findIndex((s) => sectionMatches(s, section));
  const rank = i >= 0 ? i + 1 : null;
  return { section, rank, hitAt1: rank !== null && rank <= 1, hitAt3: rank !== null && rank <= 3, hitAt6: rank !== null && rank <= 6 };
}

// ---------- helpers ----------

/**
 * «§2.1» совпадает с «§2.1 Primary», но не с «§2.10». Раздел без номера (протокол: «Решения, которых нет в ТЗ»)
 * сравнивается по вхождению подписи без учёта регистра.
 */
export function sectionMatches(label: string | null, wanted: string): boolean {
  if (!label) return false;
  if (!/^§?\s?\d+(?:\.\d+)*$/.test(wanted.trim())) return label.toLowerCase().includes(wanted.trim().toLowerCase());
  const want = wanted.trim().replace(/^§\s?/, '');
  return sectionNumbers(label).includes(want);
}

/** Пометку про инструкции в тексте замечания ставит код (guardrails.ts), не модель: её цитаты — не утверждения черновика. */
const NOTE_PREFIX = injectionNote([]).split('(')[0]!;

function withoutInjectionNote(rationale: string): string {
  return rationale
    .split('\n\n')
    .filter((p) => !p.startsWith(NOTE_PREFIX))
    .join('\n\n');
}

/** Перцентиль p (0..1) методом ближайшего ранга; пустой список — 0. */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

function sectionNumbers(label: string): string[] {
  return [...label.matchAll(/§\s?(\d+(?:\.\d+)*)/g)].map((m) => m[1]!);
}

export function ratio(hits: number, total: number): number {
  return total ? hits / total : 0;
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
