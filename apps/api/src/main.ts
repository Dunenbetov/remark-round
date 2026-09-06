import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';

/** Валидация тел: 422 по docs/API.md, лишние поля отбрасываем. */
export function validationPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, transform: true, errorHttpStatusCode: 422 });
}

async function bootstrap(): Promise<void> {
  // Fail-fast до старта Nest: в production без настоящего JWT_SECRET процесс не поднимается.
  const cfg = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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

if (require.main === module) {
  void bootstrap();
}
