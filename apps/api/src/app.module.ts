import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';
import { LlmModule } from './llm/llm.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { RagModule } from './rag/rag.module';
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
  ],
})
export class AppModule {}
