import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { StorageModule } from '../storage/storage.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';

@Module({
  imports: [LlmModule, StorageModule, TenancyModule],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
