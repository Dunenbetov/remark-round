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

export function skillText(): string {
  if (cached !== null) return cached;
  const path = CANDIDATES.find((p) => existsSync(p));
  if (!path) {
    cached = '';
    return cached;
  }
  // Без YAML-шапки: в промпт идёт процедура, а не метаданные Skill.
  cached = readFileSync(path, 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim();
  return cached;
}
