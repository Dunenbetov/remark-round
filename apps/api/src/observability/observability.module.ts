import { Global, Module } from '@nestjs/common';
import { ObservabilityService } from './observability.service';

/** Langfuse на каждый LLM-вызов (фаза 8). Глобальный: LlmModule, RagModule, AgentModule и RemarksService берут его без импорта. */
@Global()
@Module({
  providers: [ObservabilityService],
  exports: [ObservabilityService],
})
export class ObservabilityModule {}
