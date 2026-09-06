import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { LlmModule } from '../llm/llm.module';
import { StorageModule } from '../storage/storage.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';

@Module({
  imports: [LlmModule, StorageModule, TenancyModule, JobsModule],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
