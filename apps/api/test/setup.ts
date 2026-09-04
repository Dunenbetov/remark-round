import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Если DATABASE_URL не задан явно, берём корневой .env. Читаем сами, а не через process.loadEnvFile:
 * jest даёт тестам копию process.env, и переменные, выставленные нативно, в неё не попадают.
 */
if (!process.env['DATABASE_URL']) {
  try {
    for (const line of readFileSync(resolve(__dirname, '../../../.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trimStart().startsWith('#')) process.env[m[1]!] ??= m[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    /* .env отсутствует — тесты упадут с понятной ошибкой Prisma */
  }
}
process.env['JWT_SECRET'] ??= 'test-secret';
// Спеки офлайн: LLM и эмбеддинги подменены, span'ы Langfuse не шлём (observability.spec ставит свой экспортёр в памяти).
process.env['LANGFUSE_TRACING_ENABLED'] ??= 'false';
