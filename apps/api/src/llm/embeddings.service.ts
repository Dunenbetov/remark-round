import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { startActiveObservation } from '@langfuse/tracing';
import OpenAI from 'openai';
import { createOpenAi } from './openai-client';

/** Одна модель на весь индекс (REMARKROUND.md §10). Размерность зашита в миграции vector(1536). */
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;
const BATCH = 64;

/**
 * Единственное место, где API ходит за эмбеддингами. Каждый вызов — embedding-span Langfuse
 * (модель, размер батча, токены); внутри прогона графа он ложится под span прогона, при индексации — под `index_document`.
 * Без Langfuse `startActiveObservation` работает на noop-tracer'е OpenTelemetry: ни сети, ни накладных расходов.
 */
@Injectable()
export class EmbeddingsService {
  readonly model = EMBEDDING_MODEL;
  readonly dimensions = EMBEDDING_DIM;
  private client: OpenAI | null = null;

  get available(): boolean {
    return Boolean(process.env['OPENAI_API_KEY']);
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const vectors = await startActiveObservation(
        'embed',
        async (span) => {
          span.update({
            model: this.model,
            modelParameters: { dimensions: this.dimensions },
            input: batch.length === 1 ? batch[0] : { texts: batch.length, chars: batch.reduce((n, t) => n + t.length, 0) },
          });
          const res = await this.openai().embeddings.create({ model: this.model, input: batch, dimensions: this.dimensions });
          span.update({ output: { vectors: res.data.length, dimensions: this.dimensions }, usageDetails: { input: res.usage?.prompt_tokens ?? 0, total: res.usage?.total_tokens ?? 0 } });
          return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
        },
        { asType: 'embedding' },
      );
      out.push(...vectors);
    }
    return out;
  }

  private openai(): OpenAI {
    if (!this.client) {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) throw new ServiceUnavailableException('OPENAI_API_KEY не задан — индексация недоступна');
      this.client = createOpenAi(apiKey);
    }
    return this.client;
  }
}
