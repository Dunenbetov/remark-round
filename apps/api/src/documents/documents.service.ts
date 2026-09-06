import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { DocumentKind, DocumentStatus } from '@remarkround/db';
import { PrismaService } from '../prisma/prisma.service';
import { assertContent, detectMime } from '../rag/extract';
import { RagService } from '../rag/rag.service';
import { StorageService } from '../storage/storage.service';
import type { ProjectContext } from '../tenancy/project-context';

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  title: string;
  mime: string;
  status: DocumentStatus;
  effectiveAt: Date | null;
  createdAt: Date;
  chunks?: number;
}

export interface UploadInput {
  kind: DocumentKind;
  fileName: string;
  mime?: string;
  data: Buffer;
  effectiveAt?: Date | null;
}

/**
 * Пакет документов проекта. Каждый запрос фильтруется по ctx.projectId: чужой id → 404.
 * Загрузка: файл на диск → строка `uploaded` → индексация в фоне (parsed → indexed | failed).
 */
@Injectable()
export class DocumentsService {
  private readonly log = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly rag: RagService,
  ) {}

  async list(ctx: ProjectContext): Promise<DocumentSummary[]> {
    const rows = await this.prisma.document.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { chunks: true } } },
    });
    return rows.map((d) => ({ ...toSummary(d), chunks: d._count.chunks }));
  }

  async get(ctx: ProjectContext, documentId: string): Promise<DocumentSummary> {
    const row = await this.prisma.document.findFirst({
      where: { id: documentId, projectId: ctx.projectId },
      include: { _count: { select: { chunks: true } } },
    });
    if (!row) throw new NotFoundException();
    return { ...toSummary(row), chunks: row._count.chunks };
  }

  /** Создаёт документ и возвращает его сразу; индексация идёт в фоне, статус виден через GET. */
  async upload(ctx: ProjectContext, input: UploadInput, options: { indexInBackground?: boolean } = {}): Promise<DocumentSummary> {
    if (!input.data.length) throw new UnprocessableEntityException('Пустой файл');
    const mime = detectMime(input.fileName, input.mime);
    assertContent(input.data, mime);
    const storageKey = await this.storage.save(ctx.projectId, input.fileName, input.data);
    const doc = await this.prisma.document.create({
      data: {
        projectId: ctx.projectId,
        kind: input.kind,
        title: input.fileName,
        mime,
        storageKey,
        status: 'uploaded',
        effectiveAt: input.effectiveAt ?? null,
      },
    });
    if (options.indexInBackground ?? true) {
      void this.rag.indexDocument(doc.id).catch((e: Error) => this.log.warn(`background index ${doc.id}: ${e.message}`));
    }
    return toSummary(doc);
  }

  /** Переиндексация (admin). В фоне, как и первичная. */
  async reindex(ctx: ProjectContext, documentId: string): Promise<DocumentSummary> {
    const row = await this.prisma.document.findFirst({ where: { id: documentId, projectId: ctx.projectId } });
    if (!row) throw new NotFoundException();
    void this.rag.indexDocument(row.id).catch((e: Error) => this.log.warn(`reindex ${row.id}: ${e.message}`));
    return toSummary({ ...row, status: 'uploaded' });
  }
}

function toSummary(d: {
  id: string;
  kind: DocumentKind;
  title: string;
  mime: string;
  status: DocumentStatus;
  effectiveAt: Date | null;
  createdAt: Date;
}): DocumentSummary {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    mime: d.mime,
    status: d.status,
    effectiveAt: d.effectiveAt,
    createdAt: d.createdAt,
  };
}
