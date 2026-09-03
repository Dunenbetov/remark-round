import type { ProposedClass } from '@remarkround/db';

export interface FaithfulnessInput {
  rationale: string;
  /** Подписи разделов найденных чанков: «§2.1 Primary», «§6 Чего в ТЗ нет (дыры)». */
  retrievedSections: Array<string | null>;
  proposedClass: ProposedClass;
  chunkIds: string[];
  hasScreenshot: boolean;
}

export interface FaithfulnessResult {
  ok: boolean;
  issues: string[];
}

/**
 * Нода faithfulness без LLM (docs/GRAPH.md, REMARKROUND.md §11 метрика 2): черновик не имеет права
 * ссылаться на раздел, которого не было в retrieve, утверждать дефект без цитаты и «видеть» кадр,
 * которого нет. Это детерминированный фильтр: сломанный черновик уходит в цикл bind, а не человеку.
 */
export function checkFaithfulness(input: FaithfulnessInput): FaithfulnessResult {
  const issues: string[] = [];
  const allowed = new Set(input.retrievedSections.flatMap((s) => (s ? sectionNumbers(s) : [])));
  const referenced = new Set<string>();
  for (const m of input.rationale.matchAll(/§\s?(\d+(?:\.\d+)*)/g)) referenced.add(m[1]!);
  for (const ref of referenced) {
    if (!allowed.has(ref)) issues.push(`ссылка на §${ref}, которого нет среди найденных разделов`);
  }
  if (input.proposedClass === 'defect_candidate' && input.chunkIds.length === 0) issues.push('дефект без цитаты из документов');
  if (!input.hasScreenshot && /на (кадре|скрине)/i.test(input.rationale)) issues.push('черновик описывает кадр, а кадра нет');
  return { ok: issues.length === 0, issues };
}

function sectionNumbers(label: string): string[] {
  return [...label.matchAll(/§\s?(\d+(?:\.\d+)*)/g)].map((m) => m[1]!);
}
