/**
 * Две метрики фазы 9 (docs/EVALS.md, REMARKROUND.md §11) — чистые функции без сети и БД.
 *
 * Binding quality: класс совпал с золотым, либо законный abstain (cannot_tell / unspecified) там, где golden
 * это разрешает; плюс правильный раздел в цитатах, плюс правильный оригинал у повтора. Не «PM бы так решил».
 *
 * Faithfulness: в черновике нет ссылки на раздел, которого нет среди цитат; нет «на кадре», если кадра нет;
 * дефект без цитаты невозможен; модель ничего не закрывает; ложных цитат из golden.mustNotMatch нет.
 * Та же строгость, что у ноды faithfulness графа (с фазы 9 она пропускает только процитированные разделы), плюс проверки golden.
 */
import type { ProposedClass, RemarkStatus, RetestOutcome } from '@remarkround/db';
import { stripRemarkQuotes } from '../agent/faithfulness';
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
  if (gold.section && p === gold.expect[0] && !obs.citedSections.some((s) => sectionMatches(s, gold.section!))) {
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
  const own = stripRemarkQuotes(obs.rationale, obs.remarkText);
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

// ---------- helpers ----------

/** «§2.1» совпадает с «§2.1 Primary», но не с «§2.10». */
export function sectionMatches(label: string | null, wanted: string): boolean {
  if (!label) return false;
  const want = wanted.replace(/^§\s?/, '');
  return sectionNumbers(label).includes(want);
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
