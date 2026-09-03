import { Module, forwardRef } from '@nestjs/common';
import { DiffModule } from '../diff/diff.module';
import { LlmModule } from '../llm/llm.module';
import { RagModule } from '../rag/rag.module';
import { RemarksModule } from '../remarks/remarks.module';
import { StorageModule } from '../storage/storage.module';
import { AgentService } from './agent.service';
import { RunEvents } from './run-events';

/**
 * AgentModule (docs/ENGINEERING.md): только граф LangGraph; ноды зовут сервисы выше.
 * RemarksModule ↔ AgentModule связаны forwardRef: контроллер замечаний стартует прогон, граф пишет через RemarksService.
 */
@Module({
  imports: [forwardRef(() => RemarksModule), RagModule, DiffModule, StorageModule, LlmModule],
  providers: [AgentService, RunEvents],
  exports: [AgentService, RunEvents],
})
export class AgentModule {}
