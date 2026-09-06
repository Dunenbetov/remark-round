import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
import { config } from './config';
import { DocumentsModule } from './documents/documents.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthModule } from './health/health.module';
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

@Module({
  imports: [
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
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
