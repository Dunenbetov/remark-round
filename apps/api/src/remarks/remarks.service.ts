import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, RemarkStatus, RetestOutcome, VerdictCode } from '@remarkround/db';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../tenancy/project-context';
import { ChunkInfo, CreateRemarkDto, RemarkRow, RemarkView, VerdictDto, toRemarkView } from './remark.dto';
import { TriageStubService } from './triage-stub.service';

const REMARK_INCLUDE = {
  round: { select: { number: true } },
  screenshots: true,
  citations: { select: { id: true, chunkId: true } },
  verdicts: { select: { code: true, userId: true, comment: true, createdAt: true } },
  runs: { select: { id: true, createdAt: true } },
} satisfies Prisma.RemarkInclude;

/** Разработчик видит только принятые поломки и то, что сам отдал на ретест. */
const DEVELOPER_STATUSES: RemarkStatus[] = ['defect', 'ready_for_retest'];

/**
 * Единственный путь записи Remark / Verdict / Run (docs/ENGINEERING.md, паттерн 2).
 * Переходы статусов — строго docs/STATUS.md; нелегальный переход → 409.
 * Модель никогда не ставит `closed`: нет метода, который бы это делал без роли business.
 */
@Injectable()
export class RemarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly triage: TriageStubService,
  ) {}

  // ---------- чтение ----------

  async list(ctx: ProjectContext, roundId: string): Promise<RemarkView[]> {
    const round = await this.prisma.round.findFirst({ where: { id: roundId, projectId: ctx.projectId } });
    if (!round) throw new NotFoundException();
    const rows = await this.prisma.remark.findMany({
      where: { projectId: ctx.projectId, roundId, ...(ctx.role === 'developer' ? { status: { in: DEVELOPER_STATUSES } } : {}) },
      include: REMARK_INCLUDE,
      orderBy: { number: 'desc' },
    });
    return this.views(rows);
  }

  async devQueue(ctx: ProjectContext): Promise<RemarkView[]> {
    const rows = await this.prisma.remark.findMany({
      where: { projectId: ctx.projectId, status: { in: DEVELOPER_STATUSES } },
      include: REMARK_INCLUDE,
      orderBy: [{ status: 'asc' }, { number: 'asc' }],
    });
    return this.views(rows);
  }

  async get(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    const row = await this.load(ctx, remarkId);
    if (ctx.role === 'developer' && !DEVELOPER_STATUSES.includes(row.status)) throw new NotFoundException();
    return (await this.views([row]))[0]!;
  }

  // ---------- создание и разбор ----------

  async create(ctx: ProjectContext, roundId: string, dto: CreateRemarkDto): Promise<RemarkView> {
    const round = await this.prisma.round.findFirst({ where: { id: roundId, projectId: ctx.projectId } });
    if (!round) throw new NotFoundException();
    const last = await this.prisma.remark.findFirst({ where: { roundId }, orderBy: { number: 'desc' } });
    const remark = await this.prisma.remark.create({
      data: {
        projectId: ctx.projectId,
        roundId,
        number: (last?.number ?? 0) + 1,
        description: dto.description.trim(),
        pageOrScreen: dto.pageOrScreen?.trim() || null,
        expected: dto.expected?.trim() || null,
        status: 'imported',
        authorId: ctx.userId,
        screenshots: dto.screenshotKey ? { create: { kind: 'original', storageKey: dto.screenshotKey } } : undefined,
      },
    });
    return this.runTriage(ctx, remark.id);
  }

  /** imported | cannot_tell → triaging → awaiting_pm. Один AgentRun на прогон. */
  async runTriage(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['imported', 'cannot_tell', 'reopened', 'triaging'], 'triage');
    await this.prisma.remark.update({ where: { id: row.id }, data: { status: 'triaging' } });
    const run = await this.prisma.agentRun.create({ data: { remarkId: row.id, projectId: ctx.projectId, mode: 'triage', status: 'running', model: this.triage.model } });

    try {
      const siblings = await this.prisma.remark.findMany({
        where: { roundId: row.roundId, id: { not: row.id }, status: { notIn: ['duplicate'] } },
        select: { number: true, description: true },
      });
      const proposal = await this.triage.propose(ctx, {
        description: row.description,
        expected: row.expected,
        pageOrScreen: row.pageOrScreen,
        hasScreenshot: row.screenshots.some((s) => s.kind === 'original'),
        siblings,
      });
      await this.applyProposal(row.id, run.id, proposal);
    } catch (e) {
      await this.prisma.agentRun.update({ where: { id: run.id }, data: { status: 'failed' } });
      await this.prisma.remark.update({ where: { id: row.id }, data: { status: 'imported' } });
      throw e;
    }
    return this.get(ctx, row.id);
  }

  /** Предложение модели → awaiting_pm. Только сюда пишет граф (и MCP в фазе 7). */
  private async applyProposal(
    remarkId: string,
    runId: string,
    proposal: { proposedClass: RemarkRow['proposedClass'] & {}; rationale: string[]; chunkIds: string[]; duplicateOfNumber?: number },
  ): Promise<void> {
    const remark = await this.prisma.remark.findUniqueOrThrow({ where: { id: remarkId } });
    const duplicateOf = proposal.duplicateOfNumber
      ? await this.prisma.remark.findFirst({ where: { roundId: remark.roundId, number: proposal.duplicateOfNumber } })
      : null;
    await this.prisma.$transaction([
      this.prisma.evidenceCitation.deleteMany({ where: { remarkId } }),
      this.prisma.evidenceCitation.createMany({ data: proposal.chunkIds.map((chunkId) => ({ remarkId, chunkId })) }),
      this.prisma.remark.update({
        where: { id: remarkId },
        data: {
          status: 'awaiting_pm',
          proposedClass: proposal.proposedClass,
          rationale: proposal.rationale.join('\n\n'),
          duplicateOfId: duplicateOf?.id ?? null,
        },
      }),
      this.prisma.agentRun.update({ where: { id: runId }, data: { status: 'awaiting_human' } }),
    ]);
  }

  // ---------- решения человека ----------

  async verdict(ctx: ProjectContext, remarkId: string, dto: VerdictDto): Promise<RemarkView> {
    const row = await this.load(ctx, remarkId);
    const run = row.runs.find((r) => r.id === dto.runId);
    if (!run) throw new ConflictException('runId не относится к этому замечанию');

    const existing = await this.prisma.humanVerdict.findUnique({ where: { runId_idempotencyKey: { runId: dto.runId, idempotencyKey: dto.idempotencyKey } } });
    if (existing) return this.get(ctx, remarkId); // повтор — тот же результат, второго вердикта нет

    if (dto.verdict === 'rejected_binding') {
      if (ctx.role !== 'pm') throw new ForbiddenException();
      this.assertTransition(row.status, ['awaiting_pm'], 'rejected_binding');
      if (!dto.comment?.trim()) throw new ConflictException('Для «не та цитата» нужен комментарий');
      await this.prisma.humanVerdict.create({ data: { remarkId, runId: dto.runId, userId: ctx.userId, code: 'rejected_binding', comment: dto.comment, idempotencyKey: dto.idempotencyKey } });
      const proposal = await this.triage.propose(ctx, {
        description: row.description,
        expected: row.expected,
        pageOrScreen: row.pageOrScreen,
        hasScreenshot: row.screenshots.some((s) => s.kind === 'original'),
        siblings: [],
        rebindComment: dto.comment,
        excludeChunkIds: row.citations.map((c) => c.chunkId),
      });
      await this.applyProposal(remarkId, dto.runId, proposal);
      return this.get(ctx, remarkId);
    }

    const next = this.nextStatusForVerdict(ctx, row.status, dto.verdict);
    const duplicateOf = dto.verdict === 'duplicate' && dto.duplicateOfNumber
      ? await this.prisma.remark.findFirst({ where: { roundId: row.roundId, number: dto.duplicateOfNumber } })
      : null;
    await this.prisma.$transaction([
      this.prisma.humanVerdict.create({ data: { remarkId, runId: dto.runId, userId: ctx.userId, code: dto.verdict, comment: dto.comment?.trim() || null, idempotencyKey: dto.idempotencyKey } }),
      this.prisma.remark.update({ where: { id: remarkId }, data: { status: next, duplicateOfId: duplicateOf?.id ?? row.duplicateOfId } }),
      this.prisma.agentRun.update({ where: { id: dto.runId }, data: { status: 'persisted' } }),
    ]);
    return this.get(ctx, remarkId);
  }

  private nextStatusForVerdict(ctx: ProjectContext, from: RemarkStatus, code: Exclude<VerdictCode, 'rejected_binding'>): RemarkStatus {
    if (from === 'awaiting_pm') {
      if (ctx.role !== 'pm') throw new ForbiddenException();
      return code;
    }
    if (from === 'unspecified' && (code === 'defect' || code === 'change_request')) {
      if (ctx.role !== 'pm' && ctx.role !== 'business') throw new ForbiddenException();
      return code;
    }
    throw new ConflictException(`Переход ${from} → ${code} запрещён (docs/STATUS.md)`);
  }

  async linkDuplicate(ctx: ProjectContext, remarkId: string, duplicateOfNumber: number): Promise<RemarkView> {
    if (ctx.role !== 'pm') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    const original = await this.prisma.remark.findFirst({ where: { roundId: row.roundId, number: duplicateOfNumber } });
    if (!original || original.id === row.id) throw new NotFoundException('Оригинал не найден в этом раунде');
    await this.prisma.remark.update({ where: { id: remarkId }, data: { duplicateOfId: original.id } });
    return this.get(ctx, remarkId);
  }

  async readyForRetest(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    if (ctx.role !== 'developer') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['defect'], 'ready_for_retest');
    await this.prisma.remark.update({ where: { id: remarkId }, data: { status: 'ready_for_retest', fixedByUserId: ctx.userId } });
    return this.get(ctx, remarkId);
  }

  /** Новый кадр по «Не хватает скрина»: cannot_tell → triaging → awaiting_pm. */
  async attachScreenshot(ctx: ProjectContext, remarkId: string, screenshotKey: string): Promise<RemarkView> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['cannot_tell', 'imported'], 'attach_screenshot');
    await this.prisma.$transaction([
      this.prisma.remarkScreenshot.deleteMany({ where: { remarkId, kind: 'original' } }),
      this.prisma.remarkScreenshot.create({ data: { remarkId, kind: 'original', storageKey: screenshotKey } }),
    ]);
    return this.runTriage(ctx, remarkId);
  }

  /** Ретест: новый кадр. Дифф и пояснение модели — фаза 5; пока честный cannot_tell. */
  async retest(ctx: ProjectContext, remarkId: string, screenshotKey: string): Promise<RemarkView> {
    if (ctx.role !== 'business') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['ready_for_retest'], 'retest');
    const outcome: RetestOutcome = 'cannot_tell';
    await this.prisma.$transaction([
      this.prisma.remarkScreenshot.deleteMany({ where: { remarkId, kind: { in: ['retest', 'diff'] } } }),
      this.prisma.remarkScreenshot.create({ data: { remarkId, kind: 'retest', storageKey: screenshotKey } }),
      this.prisma.remark.update({
        where: { id: remarkId },
        data: { status: 'awaiting_business_close', retestOutcome: outcome, retestExplanation: 'Сравнение кадров подключим в фазе 5. Пока сравните было и стало вручную.' },
      }),
    ]);
    return this.get(ctx, remarkId);
  }

  async close(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    if (ctx.role !== 'business') throw new ForbiddenException('Закрыть замечание может только тот, кто принимает работу');
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['awaiting_business_close'], 'close');
    await this.prisma.remark.update({ where: { id: remarkId }, data: { status: 'closed', closedByUserId: ctx.userId, closedAt: new Date() } });
    return this.get(ctx, remarkId);
  }

  async notFixed(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    if (ctx.role !== 'business') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['awaiting_business_close'], 'not_fixed');
    await this.prisma.$transaction([
      this.prisma.remarkScreenshot.deleteMany({ where: { remarkId, kind: { in: ['retest', 'diff'] } } }),
      this.prisma.remark.update({ where: { id: remarkId }, data: { status: 'defect', retestOutcome: null, retestExplanation: null } }),
    ]);
    return this.get(ctx, remarkId);
  }

  // ---------- helpers ----------

  private assertTransition(from: RemarkStatus, allowed: RemarkStatus[], action: string): void {
    if (!allowed.includes(from)) throw new ConflictException(`Переход «${action}» из статуса ${from} запрещён (docs/STATUS.md)`);
  }

  private async load(ctx: ProjectContext, remarkId: string): Promise<RemarkRow> {
    const row = await this.prisma.remark.findFirst({ where: { id: remarkId, projectId: ctx.projectId }, include: REMARK_INCLUDE });
    if (!row) throw new NotFoundException();
    return row;
  }

  private async views(rows: RemarkRow[]): Promise<RemarkView[]> {
    const dupIds = rows.map((r) => r.duplicateOfId).filter((x): x is string => Boolean(x));
    const originals = dupIds.length ? await this.prisma.remark.findMany({ where: { id: { in: dupIds } }, select: { id: true, number: true } }) : [];
    const numberById = new Map(originals.map((o) => [o.id, o.number]));

    const chunkIds = [...new Set(rows.flatMap((r) => r.citations.map((c) => c.chunkId)))];
    const chunkRows = chunkIds.length
      ? await this.prisma.documentChunk.findMany({
          where: { id: { in: chunkIds } },
          select: { id: true, section: true, content: true, document: { select: { kind: true, title: true, effectiveAt: true } } },
        })
      : [];
    const chunks = new Map<string, ChunkInfo>(chunkRows.map((c) => [c.id, c]));

    const userIds = [...new Set(rows.flatMap((r) => [r.authorId, r.fixedByUserId, r.closedByUserId, ...r.verdicts.map((v) => v.userId)]).filter((x): x is string => Boolean(x)))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));

    return rows.map((r) => toRemarkView(r, { duplicateOfNumber: r.duplicateOfId ? numberById.get(r.duplicateOfId) : undefined, chunks, names }));
  }
}
