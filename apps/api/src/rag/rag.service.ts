import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { startActiveObservation } from '@langfuse/tracing';
import { Prisma, type DocumentKind } from '@remarkround/db';
import { randomUUID } from 'node:crypto';
import { JobsService, RetryJobError, type JobContext } from '../jobs/jobs.service';
import { EmbeddingsService } from '../llm/embeddings.service';
import { classifyRunError, isRetryable } from '../llm/llm-errors';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { ProjectContext } from '../tenancy/project-context';
import { chunkByHeadings } from './chunker';
import { detectMime, extractText } from './extract';

export interface SearchHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentKind: DocumentKind;
  section: string | null;
  page: number | null;
  content: string;
  /** Косинусная близость 0..1. */
  score: number;
}

export interface IndexResult {
  documentId: string;
  chunks: number;
}

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;
/** Строк в одном INSERT чанков: 200 × 1536 float ≈ 3 МБ текста запроса — далеко от лимитов Postgres и Prisma. */
const INSERT_BATCH = 200;
/** Транзакция индексации: удалить старые чанки и записать новые — тысячи строк большого ТЗ при занятом пуле. */
const INDEX_TX_TIMEOUT_MS = 120_000;

/**
 * RagModule: chunk → embed → pgvector, search с `WHERE "projectId" = $current`.
 * Тенанси только в SQL: projectId приходит из ProjectContext, не из тела запроса.
 */
@Injectable()
export class RagService implements OnModuleInit {
  private readonly log = new Logger(RagService.name);
  /** HNSW-индекс создан вручную вне Prisma (миграция 20260903000000): его отсутствие видно только по латентности — проверяем на старте. */
  private vectorIndex: 'ok' | 'missing' | 'unknown' = 'unknown';

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly embeddings: EmbeddingsService,
    private readonly jobs: JobsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Две индексации разом: батч эмбеддингов большого ТЗ держит память, а третья подождёт в очереди (R-B2)
    this.jobs.register('index_document', (payload, ctx) => this.indexJob(payload as { documentId: string }, ctx), { maxConcurrent: 2 });
    try {
      const rows = await this.prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE tablename = 'DocumentChunk' AND indexdef ILIKE '%USING hnsw%'`;
      this.vectorIndex = rows.length ? 'ok' : 'missing';
      if (!rows.length) this.log.error('HNSW-индекс DocumentChunk.embedding не найден: retrieve будет полным сканом. См. packages/db/README.md');
    } catch (e) {
      this.log.warn(`не удалось проверить HNSW-индекс: ${(e as Error).message}`);
    }
  }

  /** Для /health: есть ли векторный индекс. */
  get vectorIndexStatus(): 'ok' | 'missing' | 'unknown' {
    return this.vectorIndex;
  }

  /** Индексация в очереди задач: временная ошибка эмбеддингов (429, 5xx) — повтор с паузой, документ возвращается в uploaded. */
  private async indexJob(payload: { documentId: string }, ctx: JobContext): Promise<void> {
    try {
      await this.indexDocument(payload.documentId);
    } catch (e) {
      const failure = classifyRunError(e);
      if (isRetryable(failure) && ctx.attempt < ctx.maxAttempts) {
        await this.prisma.document.update({ where: { id: payload.documentId }, data: { status: 'uploaded' } }).catch(() => null);
        throw new RetryJobError(`${failure.code}: ${(e as Error).message}`);
      }
      throw e;
    }
  }

  /** Полная переиндексация документа: статус parsed → indexed, при ошибке failed. Свой trace Langfuse `index_document`. */
  async indexDocument(documentId: string): Promise<IndexResult> {
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    return startActiveObservation(
      'index_document',
      async (span) => {
        span.update({ input: { documentId: doc.id, title: doc.title, kind: doc.kind }, metadata: { projectId: doc.projectId, documentId: doc.id } });
        try {
          const data = await this.storage.read(doc.storageKey);
          const text = await extractText(data, detectMime(doc.title, doc.mime));
          await this.prisma.document.update({ where: { id: doc.id }, data: { status: 'parsed' } });

          const chunks = chunkByHeadings(text);
          // Скан без текстового слоя или пустой файл: «indexed» с нулём чанков выглядел бы как готовый пакет (аудит: empty-index-scanned-pdf)
          if (!chunks.length) throw new Error('текст не извлечён — похоже на скан без текстового слоя или пустой файл');
          const vectors = await this.embeddings.embed(chunks.map((c) => c.embedText));

          // Чанки пишутся пачками по INSERT_BATCH строк в одном INSERT (аудит беты R-B3): ТЗ на 200 страниц — тысячи чанков,
          // и по одному INSERT они не укладывались в 5-секундный дефолт интерактивной транзакции; эмбеддинги уже оплачены
          await this.prisma.$transaction(
            async (tx) => {
              await tx.documentChunk.deleteMany({ where: { documentId: doc.id } });
              for (let from = 0; from < chunks.length; from += INSERT_BATCH) {
                const rows = chunks.slice(from, from + INSERT_BATCH).map((c, i) => Prisma.sql`(${randomUUID()}, ${doc.projectId}, ${doc.id}, ${c.section}, ${c.page}, ${c.content}, ${toVector(vectors[from + i]!)}::vector)`);
                await tx.$executeRaw`
                  INSERT INTO "DocumentChunk" ("id", "projectId", "documentId", "section", "page", "content", "embedding")
                  VALUES ${Prisma.join(rows)}
                `;
              }
              await tx.document.update({ where: { id: doc.id }, data: { status: 'indexed' } });
            },
            { timeout: INDEX_TX_TIMEOUT_MS },
          );
          span.update({ output: { chunks: chunks.length, sections: chunks.map((c) => c.section).filter(Boolean) } });
          return { documentId: doc.id, chunks: chunks.length };
        } catch (e) {
          this.log.error(`index ${doc.id} (${doc.title}) failed: ${(e as Error).message}`);
          await this.prisma.document.update({ where: { id: doc.id }, data: { status: 'failed' } });
          throw e;
        }
      },
      { asType: 'chain' },
    );
  }

  /**
   * Поиск по пакету документов проекта. Чужой projectId сюда не попадёт: guard уже отдал 404.
   * Retriever-span Langfuse: запрос, projectId и найденные разделы с близостью — по нему видно, что чужого проекта в выдаче нет.
   */
  /**
   * pgvector ≥ 0.8: iterative_scan дочитывает индекс, пока не наберёт k строк проекта — иначе маленький проект
   * на общем HNSW получает пустую выдачу после фильтра. Старый pgvector параметра не знает: запоминаем и идём без него.
   */
  private iterativeScan = true;

  private async nearest(projectId: string, vector: string, k: number): Promise<NearestRow[]> {
    if (this.iterativeScan) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
          return nearestSql(tx, projectId, vector, k);
        });
      } catch (e) {
        if (!/iterative_scan/.test((e as Error).message)) throw e;
        this.iterativeScan = false;
      }
    }
    return nearestSql(this.prisma, projectId, vector, k);
  }

  async search(ctx: ProjectContext, query: string, topK = DEFAULT_TOP_K): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const k = Math.min(Math.max(1, topK), MAX_TOP_K);
    return startActiveObservation(
      'retrieve',
      async (span) => {
        span.update({ input: { query: q, topK: k }, metadata: { projectId: ctx.projectId } });
        const [vector] = await this.embeddings.embed([q]);
        const rows = await this.nearest(ctx.projectId, toVector(vector!), k);
        const hits = rows.map((r) => ({ ...r, score: Number(r.score) }));
        span.update({ output: hits.map((h) => ({ chunkId: h.chunkId, document: h.documentTitle, kind: h.documentKind, section: h.section, score: Number(h.score.toFixed(3)) })) });
        return hits;
      },
      { asType: 'retriever' },
    );
  }

  async chunkCount(projectId: string, documentId: string): Promise<number> {
    return this.prisma.documentChunk.count({ where: { projectId, documentId } });
  }
}

type NearestRow = { chunkId: string; documentId: string; documentTitle: string; documentKind: DocumentKind; section: string | null; page: number | null; content: string; score: number };

/** Один и тот же SQL на клиенте и в транзакции: фильтр проекта — в WHERE, не в промпте. */
function nearestSql(db: Pick<PrismaService, '$queryRaw'>, projectId: string, vector: string, k: number): Promise<NearestRow[]> {
  return db.$queryRaw<NearestRow[]>`
    SELECT c."id" AS "chunkId", c."documentId", d."title" AS "documentTitle", d."kind" AS "documentKind",
           c."section", c."page", c."content",
           1 - (c."embedding" <=> ${vector}::vector) AS "score"
    FROM "DocumentChunk" c
    JOIN "Document" d ON d."id" = c."documentId"
    WHERE c."projectId" = ${projectId} AND c."embedding" IS NOT NULL
    ORDER BY c."embedding" <=> ${vector}::vector
    LIMIT ${k}
  `;
}

function toVector(v: number[]): string {
  return `[${v.join(',')}]`;
}

export type { Prisma };
