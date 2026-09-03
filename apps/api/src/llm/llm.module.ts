import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { LlmService } from './llm.service';

/** LLM и эмбеддинги живут только здесь (docs/ENGINEERING.md, паттерн 3). */
@Module({
  providers: [EmbeddingsService, LlmService],
  exports: [EmbeddingsService, LlmService],
})
export class LlmModule {}
