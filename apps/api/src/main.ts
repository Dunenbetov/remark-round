// Sentry — до всего остального: SDK оборачивает модули при загрузке (без SENTRY_DSN — пустой импорт)
import './instrument';
import * as Sentry from '@sentry/node';
import { Logger as NestLogger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { config } from './config';

/** Валидация тел: 422 по docs/API.md, лишние поля отбрасываем. */
export function validationPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, transform: true, errorHttpStatusCode: 422 });
}

async function bootstrap(): Promise<void> {
  // Fail-fast до старта Nest: в production без настоящего JWT_SECRET процесс не поднимается.
  const cfg = config();
  // bufferLogs: строки до useLogger не теряются, а уходят в pino вместе с остальными
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // За nginx/Caddy настоящий IP клиента — в X-Forwarded-For; без trust proxy лимиты считали бы всех одним адресом.
  app.set('trust proxy', cfg.TRUST_PROXY_HOPS);
  // API отдаёт JSON; CSP для SPA живёт в apps/web/nginx.conf.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(validationPipe());
  app.enableCors({ origin: cfg.WEB_ORIGIN });
  // SIGTERM в compose: дослать батч span'ов в Langfuse (ObservabilityService.onApplicationShutdown).
  app.enableShutdownHooks();
  await app.listen(cfg.PORT);
}

/**
 * Необработанное исключение или отклонённый промис в фоне (прогон графа, индексация) — не «тихо в никуда»
 * (аудит: no-error-tracking): стек в лог и выход, чтобы compose поднял процесс заново, а не оставил его в
 * неизвестном состоянии. Node и так падает на unhandledRejection, но без стека в структурном логе.
 */
function installCrashHandlers(): void {
  const log = new NestLogger('process');
  const die = (kind: string) => (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log.error({ msg: `${kind}: ${err.message}`, err: { name: err.name, message: err.message, stack: err.stack } });
    // В Sentry (если настроен) — с тегом источника; дать батчу уйти, но не держать процесс дольше 2 с
    Sentry.captureException(err, { tags: { source: kind } });
    setTimeout(() => process.exit(1), 2000).unref();
    void Sentry.flush(1500)
      .catch(() => undefined)
      .finally(() => process.exit(1));
  };
  process.on('uncaughtException', die('uncaughtException'));
  process.on('unhandledRejection', die('unhandledRejection'));
}

if (require.main === module) {
  installCrashHandlers();
  void bootstrap();
}
