import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { RagModule } from '../rag/rag.module';
import { HealthController } from './health.controller';

/** /health показывает режим модели и наличие векторного индекса — отсюда зависимости на Llm и Rag. */
@Module({
  imports: [LlmModule, RagModule],
  controllers: [HealthController],
})
export class HealthModule {}
