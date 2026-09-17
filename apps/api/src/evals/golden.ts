/**
 * Golden set фазы 9: evals/golden.json (REMARKROUND.md §11). Здесь — типы и загрузка, без логики оценки.
 */
import type { ProposedClass, RetestOutcome } from '@remarkround/db';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Корень репозитория: раннер запускается и из src (jest), и из dist-evals (pnpm evals), поэтому ищем golden вверх по дереву. */
export const ROOT = findRoot(__dirname);
export const GOLDEN_PATH = resolve(ROOT, 'evals/golden.json');
export const SHOTS_DIR = resolve(ROOT, 'fixtures/screenshots');

export interface RemarkSpec {
  description: string;
  expected?: string;
  pageOrScreen?: string;
}

export interface TriageGold {
  /** Классы, которые считаются верными (первый — основной). */
  expect: ProposedClass[];
  /** cannot_tell / unspecified на дыре или шуме — успех, не провал. */
  abstainOk: boolean;
  /** Классы-провалы: например, defect по injection. */
  mustNot?: ProposedClass[];
  /** Раздел, который должен быть среди цитат, если предложен основной класс («§2.1»). */
  section?: string;
  /** Индекс в siblings, на который должен указывать повтор. */
  duplicateOfSibling?: number;
  /** Регулярки (без флагов, применяются с `i`), которых в черновике быть не должно: ложные цитаты, «PM согласен». */
  mustNotMatch?: string[];
  note?: string;
}

export interface TriageCase {
  id: string;
  type: string;
  mode: 'triage';
  remark: RemarkSpec;
  screenshot: string | null;
  siblings?: RemarkSpec[];
  gold: TriageGold;
}

export interface RetestCase {
  id: string;
  type: string;
  mode: 'retest';
  remark: RemarkSpec;
  /** Раздел ТЗ, процитированный в деле до ретеста. */
  cite: string;
  before: string;
  after: string;
  gold: { expect: RetestOutcome[]; note?: string };
}

export interface LeakageCase {
  id: string;
  type: string;
  mode: 'leakage';
  query: string;
  gold: { chunks: number; http: number };
}

export type GoldenCase = TriageCase | RetestCase | LeakageCase;

export interface Golden {
  version: number;
  notes: string;
  cases: GoldenCase[];
}

function findRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'evals/golden.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('evals/golden.json не найден выше ' + from);
}

export function loadGolden(path = GOLDEN_PATH): Golden {
  const golden = JSON.parse(readFileSync(path, 'utf8')) as Golden;
  const ids = new Set<string>();
  for (const c of golden.cases) {
    if (ids.has(c.id)) throw new Error(`golden: повтор id ${c.id}`);
    ids.add(c.id);
  }
  return golden;
}

export function readShot(name: string): Buffer {
  return readFileSync(resolve(SHOTS_DIR, name));
}
