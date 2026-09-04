import { Injectable, Logger } from '@nestjs/common';
import { startActiveObservation } from '@langfuse/tracing';
import { Prisma, type DocumentKind } from '@remarkround/db';
import { randomUUID } from 'node:crypto';
import { EmbeddingsService } from '../llm/embeddings.service';
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

/**
 * RagModule: chunk → embed → pgvector, search с `WHERE "projectId" = $current`.
 * Тенанси только в SQL: projectId приходит из ProjectContext, не из тела запроса.
 */
@Injectable()
export class RagService {
  private readonly log = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly embeddings: EmbeddingsService,
  ) {}

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
          const vectors = await this.embeddings.embed(chunks.map((c) => c.embedText));

          await this.prisma.$transaction(async (tx) => {
            await tx.documentChunk.deleteMany({ where: { documentId: doc.id } });
            for (let i = 0; i < chunks.length; i++) {
              const c = chunks[i]!;
              await tx.$executeRaw`
                INSERT INTO "DocumentChunk" ("id", "projectId", "documentId", "section", "page", "content", "embedding")
                VALUES (${randomUUID()}, ${doc.projectId}, ${doc.id}, ${c.section}, ${c.page}, ${c.content}, ${toVector(vectors[i]!)}::vector)
              `;
            }
            await tx.document.update({ where: { id: doc.id }, data: { status: 'indexed' } });
          });
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
  async search(ctx: ProjectContext, query: string, topK = DEFAULT_TOP_K): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const k = Math.min(Math.max(1, topK), MAX_TOP_K);
    return startActiveObservation(
      'retrieve',
      async (span) => {
        span.update({ input: { query: q, topK: k }, metadata: { projectId: ctx.projectId } });
        const [vector] = await this.embeddings.embed([q]);
        const rows = await this.prisma.$queryRaw<
          Array<{ chunkId: string; documentId: string; documentTitle: string; documentKind: DocumentKind; section: string | null; page: number | null; content: string; score: number }>
        >`
          SELECT c."id" AS "chunkId", c."documentId", d."title" AS "documentTitle", d."kind" AS "documentKind",
                 c."section", c."page", c."content",
                 1 - (c."embedding" <=> ${toVector(vector!)}::vector) AS "score"
          FROM "DocumentChunk" c
          JOIN "Document" d ON d."id" = c."documentId"
          WHERE c."projectId" = ${ctx.projectId} AND c."embedding" IS NOT NULL
          ORDER BY c."embedding" <=> ${toVector(vector!)}::vector
          LIMIT ${k}
        `;
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

function toVector(v: number[]): string {
  return `[${v.join(',')}]`;
}

export type { Prisma };
