import type { ProposedClass } from '@remarkround/db';

export interface FaithfulnessInput {
  rationale: string;
  /**
   * Подписи разделов, на которые черновику можно ссылаться: «§2.1 Primary», «§6 Чего в ТЗ нет (дыры)».
   * С фазы 9 это разделы процитированных чанков, а не всего retrieve: PM видит только цитаты и только их может проверить.
   */
  allowedSections: Array<string | null>;
  /** Текст замечания: его дословную цитату в черновике («По §9.9…») не считаем утверждением модели. */
  remarkText?: string;
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
 * ссылаться на раздел, которого нет среди цитат (evals фазы 9 поймали «§2.1» в черновике cannot_tell без цитат),
 * утверждать дефект без цитаты и «видеть» кадр, которого нет. Это детерминированный фильтр:
 * сломанный черновик уходит в цикл bind, а не человеку.
 */
export function checkFaithfulness(input: FaithfulnessInput): FaithfulnessResult {
  const issues: string[] = [];
  const own = input.remarkText ? stripRemarkQuotes(input.rationale, input.remarkText) : input.rationale;
  const allowed = new Set(input.allowedSections.flatMap((s) => (s ? sectionNumbers(s) : [])));
  const referenced = new Set<string>();
  for (const m of own.matchAll(/§\s?(\d+(?:\.\d+)*)/g)) referenced.add(m[1]!);
  for (const ref of referenced) {
    // Без «§» в тексте причины: она попадает в черновик cannot_tell и не должна читаться как ещё одна ссылка.
    if (!allowed.has(ref)) issues.push(`ссылка на раздел ${ref}, которого нет среди цитат`);
  }
  if (input.proposedClass === 'defect_candidate' && input.chunkIds.length === 0) issues.push('дефект без цитаты из документов');
  if (!input.hasScreenshot && /на (кадре|скрине)/i.test(own)) issues.push('черновик описывает кадр, а кадра нет');
  return { ok: issues.length === 0, issues };
}

/** Дословные цитаты замечания в черновике (целиком или по строкам) — не утверждения модели: вырезаем перед проверкой. */
export function stripRemarkQuotes(rationale: string, remarkText: string): string {
  const lines = remarkText.split('\n').map((l) => l.trim()).filter(Boolean);
  let out = rationale;
  for (const piece of [remarkText.trim(), ...lines].filter((p) => p.length >= 8)) {
    out = out.split(piece).join(' ');
    out = out.split(piece.replace(/\.$/, '')).join(' ');
  }
  return out;
}

function sectionNumbers(label: string): string[] {
  return [...label.matchAll(/§\s?(\d+(?:\.\d+)*)/g)].map((m) => m[1]!);
}
