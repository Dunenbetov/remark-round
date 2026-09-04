import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** Валидация тел: 422 по docs/API.md, лишние поля отбрасываем. */
export function validationPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, transform: true, errorHttpStatusCode: 422 });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(validationPipe());
  app.enableCors({
    origin: process.env['WEB_ORIGIN'] ?? 'http://localhost:4200',
  });
  // SIGTERM в compose: дослать батч span'ов в Langfuse (ObservabilityService.onApplicationShutdown).
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);
}

if (require.main === module) {
  void bootstrap();
}
