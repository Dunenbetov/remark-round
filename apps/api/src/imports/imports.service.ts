import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ImportRowStatus, RemarkStatus } from '@remarkround/db';
import { AgentService } from '../agent/agent.service';
import { PrismaService } from '../prisma/prisma.service';
import { ROUND_CLOSED, RemarksService } from '../remarks/remarks.service';
import { StorageService } from '../storage/storage.service';
import type { ProjectContext } from '../tenancy/project-context';
import { ImportJobView, ImportRowView } from './import.dto';
import { JournalCells, JournalTemplateError, MAX_CELL_CHARS, parseJournal } from './journal-parser';

export interface ImportInput {
  roundId: string;
  fileName: string;
  data: Buffer;
}

/**
 * Импорт журнала по официальному шаблону (docs/archive/PHASES.md, фаза 4).
 * Файл целиком ложится в storage, каждая строка — в ImportRow как есть; замечания создаёт RemarksService
 * (единственный путь записи). Строки без description → needs_human_parse: разбор по ним не стартует.
 */
@Injectable()
export class ImportService {
  private readonly log = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly remarks: RemarksService,
    private readonly agent: AgentService,
  ) {}

  async create(ctx: ProjectContext, input: ImportInput): Promise<ImportJobView> {
    const round = await this.prisma.round.findFirst({ where: { id: input.roundId, projectId: ctx.projectId } });
    if (!round) throw new NotFoundException();
    if (round.status === 'closed') throw new ConflictException(ROUND_CLOSED);
    if (!input.data.length) throw new UnprocessableEntityException('Пустой файл');

    let rows;
    try {
      rows = await parseJournal(input.data, input.fileName);
    } catch (e) {
      if (e instanceof JournalTemplateError) throw new UnprocessableEntityException(e.message);
      throw e;
    }
    if (!rows.length) throw new UnprocessableEntityException('В журнале нет ни одной строки под шапкой');

    const storageKey = await this.storage.save(ctx.projectId, input.fileName, input.data);
    const job = await this.prisma.importJob.create({
      data: { projectId: ctx.projectId, roundId: round.id, fileName: input.fileName, storageKey },
    });

    const toTriage: string[] = [];
    for (const row of rows) {
      const screenshotKey = row.image
        ? await this.storage.save(ctx.projectId, `row-${row.rowNumber}.${row.image.extension}`, row.image.buffer)
        : undefined;
      const remark = await this.remarks.createImported(ctx, round.id, {
        externalId: row.cells.external_id || null,
        pageOrScreen: row.cells.page_or_screen || null,
        // Полная ячейка остаётся в ImportRow.rawJson; в замечание — не длиннее лимита формы «Допишите строку»
        description: clipCell(row.cells.description),
        expected: clipCell(row.cells.expected) || null,
        severity: row.cells.severity || null,
        screenshot: screenshotKey ? { storageKey: screenshotKey, width: row.image!.width, height: row.image!.height } : null,
        status: row.status === 'parsed' ? 'imported' : 'needs_human_parse',
      });
      await this.prisma.importRow.create({
        data: { jobId: job.id, rowNumber: row.rowNumber, status: row.status, rawJson: row.cells, reason: row.reason ?? null, remarkId: remark.id },
      });
      if (row.status === 'parsed') toTriage.push(remark.id);
    }

    void this.triageInBackground(ctx, toTriage);
    return this.get(ctx, job.id);
  }

  async get(ctx: ProjectContext, jobId: string): Promise<ImportJobView> {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, projectId: ctx.projectId },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (!job) throw new NotFoundException();
    const remarkIds = job.rows.map((r) => r.remarkId).filter((x): x is string => Boolean(x));
    const remarks = remarkIds.length
      ? await this.prisma.remark.findMany({
          where: { id: { in: remarkIds }, projectId: ctx.projectId },
          select: { id: true, number: true, status: true, screenshots: { select: { id: true }, where: { kind: 'original', supersededAt: null } } },
        })
      : [];
    const byId = new Map(remarks.map((r) => [r.id, r]));
    const rows: ImportRowView[] = job.rows.map((row) => {
      const cells = row.rawJson as JournalCells;
      const remark = row.remarkId ? byId.get(row.remarkId) : undefined;
      return {
        rowNumber: row.rowNumber,
        status: row.status as ImportRowStatus,
        externalId: cells.external_id || null,
        text: firstLine(cells.description),
        pageOrScreen: cells.page_or_screen || null,
        reason: row.reason,
        screenshotRef: cells.screenshot && !remark?.screenshots.length ? cells.screenshot : null,
        hasScreenshot: Boolean(remark?.screenshots.length),
        remarkId: remark?.id ?? null,
        remarkNumber: remark?.number ?? null,
        remarkStatus: (remark?.status as RemarkStatus | undefined) ?? null,
        cells,
      };
    });
    return {
      id: job.id,
      projectId: job.projectId,
      roundId: job.roundId,
      fileName: job.fileName,
      createdAt: job.createdAt.toISOString(),
      rows,
      parsed: rows.filter((r) => r.status === 'parsed').length,
      needsHumanParse: rows.filter((r) => r.status === 'needs_human_parse').length,
    };
  }

  /**
   * Разбор строк — задачами очереди (JobsService): импорт из 300 строк не держит запрос, порядок и параллельность
   * задаёт воркер (GRAPH_MAX_CONCURRENT / на проект), рестарт API не теряет строки. Упавшая после повторов строка
   * остаётся `imported` с причиной на карточке — её можно запустить снова.
   */
  private async triageInBackground(ctx: ProjectContext, remarkIds: string[]): Promise<void> {
    for (const id of remarkIds) {
      try {
        await this.agent.startTriage(ctx, id);
      } catch (e) {
        this.log.warn(`import triage ${id}: ${(e as Error).message}`);
      }
    }
  }
}

function firstLine(s: string): string {
  return s.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}

function clipCell(text: string): string {
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS - 1)}…` : text;
}
