import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
import { config } from './config';
import { DocumentsModule } from './documents/documents.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthModule } from './health/health.module';
import { HttpExceptionsFilter } from './http/http-exception.filter';
import { ImportsModule } from './imports/imports.module';
import { LlmModule } from './llm/llm.module';
import { MediaModule } from './media/media.module';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { RagModule } from './rag/rag.module';
import { RemarksModule } from './remarks/remarks.module';
import { RoundsModule } from './rounds/rounds.module';
import { StorageModule } from './storage/storage.module';
import { TenancyModule } from './tenancy/tenancy.module';

const REQUEST_ID = /^[\w.-]{8,64}$/;

@Module({
  imports: [
    // Структурные логи (аудит: logs-unstructured): JSON-строки с requestId, userId и projectId на каждый запрос;
    // X-Request-Id из Caddy/nginx принимается, иначе генерируется и возвращается в ответе — по нему ищут строку в логах.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? (config().NODE_ENV === 'test' ? 'silent' : 'info'),
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/v1/health') },
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        serializers: {
          req: (req: { id: unknown; method: string; url: string; remoteAddress?: string }) => ({ id: req.id, method: req.method, url: req.url, ip: req.remoteAddress }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        customProps: (req) => {
          const r = req as { user?: { id: string }; ctx?: { projectId: string } };
          return { userId: r.user?.id, projectId: r.ctx?.projectId };
        },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        // Локальная разработка в терминале — читаемые строки; в контейнере и CI — JSON
        transport: config().NODE_ENV === 'development' && process.stdout.isTTY ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } } : undefined,
      },
    }),
    // Лимит запросов с одного IP (фаза 11): общий — здесь, строгий на вход/регистрацию — @Throttle на маршрутах.
    // В тестах выключен: харнесс опрашивает карточку каждые 100 мс.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: config().THROTTLE_LIMIT }],
      skipIf: () => config().NODE_ENV === 'test',
    }),
    ObservabilityModule,
    PrismaModule,
    AuthModule,
    TenancyModule,
    HealthModule,
    ProjectsModule,
    StorageModule,
    LlmModule,
    RagModule,
    DocumentsModule,
    MediaModule,
    RoundsModule,
    RemarksModule,
    AgentModule,
    GatewayModule,
    ImportsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Единый контракт ошибок с requestId (аудит: no-error-contract-filter)
    { provide: APP_FILTER, useClass: HttpExceptionsFilter },
  ],
})
export class AppModule {}
