import { resolve } from 'node:path';

/** Если DATABASE_URL не задан явно, берём корневой .env (Node ≥ 20.12). */
if (!process.env['DATABASE_URL']) {
  try {
    process.loadEnvFile(resolve(__dirname, '../../../.env'));
  } catch {
    /* .env отсутствует — тесты упадут с понятной ошибкой Prisma */
  }
}
process.env['JWT_SECRET'] ??= 'test-secret';
