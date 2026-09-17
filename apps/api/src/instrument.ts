/**
 * Sentry для API (ревью беты R-L5): единственный способ узнать о падении, которого не видно в логах compose.
 * Инициализируется только при SENTRY_DSN — без него модуль ничего не делает, captureException — no-op.
 * Импортируется первым в main.ts (до Nest), как велит SDK. Трейсинг выключен: latency и стоимость считает Langfuse.
 * Читает process.env напрямую: config() тянет zod и валидацию, а этот файл должен быть первым и самым лёгким.
 */
import * as Sentry from '@sentry/node';

const dsn = process.env['SENTRY_DSN'];

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env['APP_VERSION'] ?? 'dev',
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

/** Для /health и логов: включён ли репортинг. */
export const sentryEnabled = Boolean(dsn);
