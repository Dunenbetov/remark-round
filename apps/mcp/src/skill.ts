import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Тот же `skills/uat-triage/SKILL.md`, что подмешан в ноды графа (apps/api/src/llm/skill.ts).
 * MCP отдаёт его как prompt `uat-triage`, чтобы Cursor / Claude Desktop работали по той же процедуре.
 */
const CANDIDATES = [
  resolve(__dirname, '../../../skills/uat-triage/SKILL.md'),
  resolve(process.cwd(), 'skills/uat-triage/SKILL.md'),
  resolve(process.cwd(), '../../skills/uat-triage/SKILL.md'),
];

export function skillText(): string {
  const path = CANDIDATES.find((p) => existsSync(p));
  if (!path) return '';
  return readFileSync(path, 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim();
}
