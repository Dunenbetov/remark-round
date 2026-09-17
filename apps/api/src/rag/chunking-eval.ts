/**
 * Сравнение стратегий чанкинга на fixtures/spec и fixtures/protocol с реальными эмбеддингами.
 * Результаты — в docs/ARCHITECTURE.md, раздел «Чанкинг».
 * Запуск: OPENAI_API_KEY=... pnpm --filter @remarkround/api exec tsx src/rag/chunking-eval.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmbeddingsService } from '../llm/embeddings.service';
import { chunkByHeadings, chunkFixed, type Chunk } from './chunker';

const ROOT = resolve(__dirname, '../../../..');
const DOCS = [
  { title: 'TZ.md', text: readFileSync(resolve(ROOT, 'fixtures/spec/TZ.md'), 'utf8') },
  { title: 'PROTOCOL.md', text: readFileSync(resolve(ROOT, 'fixtures/protocol/PROTOCOL.md'), 'utf8') },
];

/** Вопросы из fixtures/evals/seed.json и DEMO: ожидаемый фрагмент текста в правильном чанке. */
const QUESTIONS: Array<{ q: string; expect: RegExp }> = [
  { q: 'какого цвета primary-кнопка?', expect: /#0B5FFF/ },
  { q: 'кнопка Сохранить серая с заливкой, а должна быть синяя', expect: /#0B5FFF/ },
  { q: 'где показывать текст ошибки оплаты — тостом или под полем?', expect: /под полем/ },
  { q: 'есть ли вход через Google', expect: /не предусмотрен/ },
  { q: 'нужна выгрузка реестра в Excel', expect: /Excel/ },
  { q: 'хотим тёмную тему', expect: /тёмной темы/ },
  { q: 'нет красивой иллюстрации пустого списка счетов', expect: /вне скоупа/ },
  { q: 'главную кнопку сделать серой, как привычнее бухгалтерии', expect: /привычнее бухгалтерии/ },
];

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

async function evaluate(name: string, chunks: Array<Chunk & { doc: string }>, embeddings: EmbeddingsService): Promise<void> {
  const vectors = await embeddings.embed(chunks.map((c) => c.embedText));
  const qv = await embeddings.embed(QUESTIONS.map((q) => q.q));
  let hit1 = 0;
  let hit3 = 0;
  const rows: string[] = [];
  QUESTIONS.forEach((question, qi) => {
    const ranked = chunks
      .map((c, i) => ({ c, score: cosine(qv[qi]!, vectors[i]!) }))
      .sort((a, b) => b.score - a.score);
    const rank = ranked.findIndex((r) => question.expect.test(r.c.content)) + 1;
    if (rank === 1) hit1++;
    if (rank >= 1 && rank <= 3) hit3++;
    rows.push(`  ${rank || '—'}  ${question.q}  → ${ranked[0]!.c.section ?? ranked[0]!.c.doc} (${ranked[0]!.score.toFixed(3)})`);
  });
  console.log(`\n${name}: чанков ${chunks.length}, top-1 ${hit1}/${QUESTIONS.length}, top-3 ${hit3}/${QUESTIONS.length}`);
  console.log(rows.join('\n'));
}

async function main(): Promise<void> {
  const embeddings = new EmbeddingsService();
  if (!embeddings.available) throw new Error('OPENAI_API_KEY не задан');

  const byHeadings = DOCS.flatMap((d) => chunkByHeadings(d.text).map((c) => ({ ...c, doc: d.title })));
  const byHeadingsNoPath = byHeadings.map((c) => ({ ...c, embedText: c.content }));
  const fixed120 = DOCS.flatMap((d) => chunkFixed(d.text, 120, 20).map((c) => ({ ...c, doc: d.title })));
  const fixed60 = DOCS.flatMap((d) => chunkFixed(d.text, 60, 10).map((c) => ({ ...c, doc: d.title })));

  await evaluate('A. по заголовкам, путь заголовков в эмбеддинге (прод)', byHeadings, embeddings);
  await evaluate('B. по заголовкам, без пути заголовков', byHeadingsNoPath, embeddings);
  await evaluate('C. фиксированные окна 120 слов / overlap 20', fixed120, embeddings);
  await evaluate('D. фиксированные окна 60 слов / overlap 10', fixed60, embeddings);
}

void main();
