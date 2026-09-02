import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';

/** LLM и эмбеддинги живут только здесь (docs/ENGINEERING.md, паттерн 3). */
@Module({
  providers: [EmbeddingsService],
  exports: [EmbeddingsService],
})
export class LlmModule {}
