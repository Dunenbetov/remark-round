import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';

/** Одна модель на весь индекс (REMARKROUND.md §10). Размерность зашита в миграции vector(1536). */
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;
const BATCH = 64;

/**
 * Единственное место, где API ходит за эмбеддингами. В фазе 8 каждый вызов
 * оборачивается span'ом Langfuse (модель, projectId, размер батча).
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
      const res = await this.openai().embeddings.create({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
      });
      const sorted = [...res.data].sort((a, b) => a.index - b.index);
      out.push(...sorted.map((d) => d.embedding));
    }
    return out;
  }

  private openai(): OpenAI {
    if (!this.client) {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) throw new ServiceUnavailableException('OPENAI_API_KEY не задан — индексация недоступна');
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }
}
