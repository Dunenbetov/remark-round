import { Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentKind, DocumentStatus } from '@remarkround/db';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../tenancy/project-context';

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  title: string;
  mime: string;
  status: DocumentStatus;
  effectiveAt: Date | null;
  createdAt: Date;
}

/**
 * Фаза 1: только чтение метаданных. Загрузка и индексация — фаза 2.
 * Каждый запрос фильтруется по ctx.projectId: чужой id → 404, не 403.
 */
@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: ProjectContext): Promise<DocumentSummary[]> {
    const rows = await this.prisma.document.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toSummary);
  }

  async get(ctx: ProjectContext, documentId: string): Promise<DocumentSummary> {
    const row = await this.prisma.document.findFirst({ where: { id: documentId, projectId: ctx.projectId } });
    if (!row) throw new NotFoundException();
    return toSummary(row);
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
