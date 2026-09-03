import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { LlmModule } from './llm/llm.module';
import { MediaModule } from './media/media.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { RagModule } from './rag/rag.module';
import { RemarksModule } from './remarks/remarks.module';
import { RoundsModule } from './rounds/rounds.module';
import { StorageModule } from './storage/storage.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({
  imports: [
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
    ImportsModule,
  ],
})
export class AppModule {}
