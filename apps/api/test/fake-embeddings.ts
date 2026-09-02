import { EMBEDDING_DIM } from '../src/llm/embeddings.service';

/**
 * Детерминированный «мешок слов» в 1536 измерениях: тесты RAG и тенанси гоняются
 * без сети. Семантики нет, но лексическое совпадение запроса с разделом ранжируется верно.
 */
export class FakeEmbeddingsService {
  readonly model = 'fake-bag-of-words';
  readonly dimensions = EMBEDDING_DIM;
  readonly available = true;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => embedOne(t));
  }
}

function embedOne(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9#]+/)
    .filter((t) => t.length > 1);
  for (const token of tokens) {
    const stem = token.length > 5 ? token.slice(0, 5) : token;
    const h = fnv(stem);
    v[h % EMBEDDING_DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
