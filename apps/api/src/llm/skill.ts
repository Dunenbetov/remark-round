import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Skill курса (skills/uat-triage/SKILL.md) подмешивается в ноды classify / draft / explain (docs/GRAPH.md).
 * Ищем от корня репо и от папки приложения (в Docker skills копируются в /app/skills).
 */
const CANDIDATES = [
  resolve(__dirname, '../../../../skills/uat-triage/SKILL.md'),
  resolve(__dirname, '../../../skills/uat-triage/SKILL.md'),
  resolve(process.cwd(), 'skills/uat-triage/SKILL.md'),
  resolve(process.cwd(), '../../skills/uat-triage/SKILL.md'),
];

let cached: string | null = null;

/** Путь к SKILL.md, который подмешивается в промпт; null — файла нет (тогда Skill в промпт не попадает). */
export function skillPath(): string | null {
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export function skillText(): string {
  if (cached !== null) return cached;
  const path = skillPath();
  if (!path) {
    cached = '';
    return cached;
  }
  // Без YAML-шапки: в промпт идёт процедура, а не метаданные Skill.
  cached = readFileSync(path, 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim();
  return cached;
}
