import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ProposedClass, RemarkStatus, RetestOutcome, VerdictCode } from '@remarkround/db';
import type { LlmUsage } from '../llm/triage-llm';
import { ObservabilityService } from '../observability/observability.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../tenancy/project-context';
import { ChunkInfo, CreateRemarkDto, FixRowDto, ImportedRemarkInput, RemarkRow, RemarkView, VerdictDto, quote, toRemarkView } from './remark.dto';

const REMARK_INCLUDE = {
  round: { select: { number: true } },
  screenshots: true,
  citations: { select: { id: true, chunkId: true } },
  verdicts: { select: { code: true, userId: true, comment: true, createdAt: true } },
  runs: { select: { id: true, createdAt: true, status: true, mode: true } },
} satisfies Prisma.RemarkInclude;

/** Разработчик видит только принятые поломки и то, что сам отдал на ретест. */
const DEVELOPER_STATUSES: RemarkStatus[] = ['defect', 'ready_for_retest'];

/** Снимок замечания для графа триажа: ноды читают через сервис, не через Prisma. */
export interface TriageFacts {
  description: string;
  expected: string | null;
  pageOrScreen: string | null;
  hasScreenshot: boolean;
  screenshotKey: string | null;
  siblings: Array<{ number: number; description: string }>;
  /** Цитаты текущего предложения — их исключают после «Не та цитата из ТЗ». */
  citedChunkIds: string[];
}

export interface RetestFacts {
  description: string;
  expected: string | null;
  originalKey: string | null;
  retestKey: string;
  citations: Array<{ section: string | null; text: string }>;
}

export interface ProposalInput {
  proposedClass: ProposedClass;
  /** Абзацы черновика; первый — заголовок по docs/ui/COPY.md. */
  rationale: string[];
  chunkIds: string[];
  duplicateOfNumber?: number | null;
  visionFacts?: string | null;
  usage?: LlmUsage;
}

export interface RetestResultInput {
  outcome: RetestOutcome;
  explanation: string;
  retestSize: { width: number; height: number } | null;
  diffShot: { storageKey: string; width: number; height: number } | null;
  usage?: LlmUsage;
}

export interface VerdictResult {
  remark: RemarkView;
  /** false — повтор idempotencyKey: вердикт не записан второй раз, граф не трогаем. */
  applied: boolean;
}

/**
 * Единственный путь записи Remark / Verdict / Run (docs/ENGINEERING.md, паттерн 2).
 * Переходы статусов — строго docs/STATUS.md; нелегальный переход → 409.
 * Граф (AgentModule) и MCP пишут только через методы ниже. Модель никогда не ставит `closed`:
 * нет метода, который бы это делал без роли business.
 */
@Injectable()
export class RemarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly observability: ObservabilityService,
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

  async statusOf(ctx: ProjectContext, remarkId: string): Promise<RemarkStatus> {
    const row = await this.prisma.remark.findFirst({ where: { id: remarkId, projectId: ctx.projectId }, select: { status: true } });
    if (!row) throw new NotFoundException();
    return row.status;
  }

  // ---------- создание ----------

  /** Ручное замечание → `imported`. Разбор стартует AgentService (граф), не здесь. */
  async create(ctx: ProjectContext, roundId: string, dto: CreateRemarkDto): Promise<RemarkView> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
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
    return this.get(ctx, remark.id);
  }

  /**
   * Строка журнала из ImportService. Разбор здесь не стартует: импорт запускает его сам по распарсенным
   * строкам, а needs_human_parse ждёт человека (docs/STATUS.md: «граф не стартовать»).
   */
  async createImported(ctx: ProjectContext, roundId: string, input: ImportedRemarkInput): Promise<{ id: string; number: number; status: RemarkStatus }> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const round = await this.prisma.round.findFirst({ where: { id: roundId, projectId: ctx.projectId } });
    if (!round) throw new NotFoundException();
    const last = await this.prisma.remark.findFirst({ where: { roundId }, orderBy: { number: 'desc' } });
    return this.prisma.remark.create({
      data: {
        projectId: ctx.projectId,
        roundId,
        number: (last?.number ?? 0) + 1,
        externalId: input.externalId,
        pageOrScreen: input.pageOrScreen,
        description: input.description.trim(),
        expected: input.expected,
        severity: input.severity,
        status: input.status,
        authorId: ctx.userId,
        screenshots: input.screenshot ? { create: { kind: 'original', ...input.screenshot } } : undefined,
      },
      select: { id: true, number: true, status: true },
    });
  }

  /** «Допишите строку журнала»: needs_human_parse → imported (человек починил строку). Дальше — граф. */
  async fixRow(ctx: ProjectContext, remarkId: string, dto: FixRowDto): Promise<RemarkView> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['needs_human_parse'], 'fix_row');
    await this.prisma.remark.update({
      where: { id: row.id },
      data: {
        description: dto.description.trim(),
        pageOrScreen: dto.pageOrScreen?.trim() || row.pageOrScreen,
        expected: dto.expected?.trim() || row.expected,
        status: 'imported',
      },
    });
    return this.get(ctx, row.id);
  }

  /** Новый кадр по «Не хватает скрина»: кадр меняется, статус остаётся до старта графа. */
  async attachScreenshot(ctx: ProjectContext, remarkId: string, screenshotKey: string): Promise<RemarkView> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['cannot_tell', 'imported'], 'attach_screenshot');
    await this.prisma.$transaction([
      this.prisma.remarkScreenshot.deleteMany({ where: { remarkId, kind: 'original' } }),
      this.prisma.remarkScreenshot.create({ data: { remarkId, kind: 'original', storageKey: screenshotKey } }),
    ]);
    return this.get(ctx, remarkId);
  }

  // ---------- прогон графа: старт, снимки, запись результата ----------

  /** imported | cannot_tell | reopened → triaging. Один AgentRun на прогон; thread_id графа = его id. */
  async beginTriage(ctx: ProjectContext, remarkId: string, model: string): Promise<{ runId: string }> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['imported', 'cannot_tell', 'reopened'], 'triage');
    const [, run] = await this.prisma.$transaction([
      this.prisma.remark.update({ where: { id: row.id }, data: { status: 'triaging' } }),
      this.prisma.agentRun.create({ data: { remarkId: row.id, projectId: ctx.projectId, mode: 'triage', status: 'running', model } }),
    ]);
    return { runId: run.id };
  }

  async triageFacts(ctx: ProjectContext, remarkId: string): Promise<TriageFacts> {
    const row = await this.load(ctx, remarkId);
    const siblings = await this.prisma.remark.findMany({
      where: { roundId: row.roundId, projectId: ctx.projectId, id: { not: row.id }, status: { notIn: ['duplicate'] } },
      select: { number: true, description: true },
      orderBy: { number: 'asc' },
    });
    const original = row.screenshots.find((s) => s.kind === 'original');
    return {
      description: row.description,
      expected: row.expected,
      pageOrScreen: row.pageOrScreen,
      hasScreenshot: Boolean(original),
      screenshotKey: original?.storageKey ?? null,
      siblings,
      citedChunkIds: row.citations.map((c) => c.chunkId),
    };
  }

  /** Предложение модели → awaiting_pm. Сюда пишет только нода propose графа (и MCP в фазе 7). */
  async applyProposal(ctx: ProjectContext, remarkId: string, runId: string, proposal: ProposalInput): Promise<RemarkView> {
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['triaging'], 'proposal');
    const run = await this.prisma.agentRun.findFirst({ where: { id: runId, remarkId, status: 'running' } });
    if (!run) throw new ConflictException('Прогон уже завершён или остановлен');
    const duplicateOf = proposal.duplicateOfNumber
      ? await this.prisma.remark.findFirst({ where: { roundId: row.roundId, number: proposal.duplicateOfNumber } })
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
          visionFacts: proposal.visionFacts ?? null,
          duplicateOfId: duplicateOf?.id ?? null,
        },
      }),
      this.prisma.agentRun.update({
        where: { id: runId },
        data: { status: 'awaiting_human', ...usageData(proposal.usage) },
      }),
    ]);
    return this.get(ctx, remarkId);
  }

  /** Прогон упал: run = failed, замечание возвращается туда, откуда можно «Запустить снова». */
  async failRun(runId: string): Promise<RemarkStatus | null> {
    const run = await this.prisma.agentRun.findUnique({ where: { id: runId }, include: { remark: { select: { id: true, status: true } } } });
    if (!run || run.status !== 'running') return run?.remark.status ?? null;
    const next: RemarkStatus = run.mode === 'triage' && run.remark.status === 'triaging' ? 'imported' : run.remark.status;
    await this.prisma.$transaction([
      this.prisma.agentRun.update({ where: { id: runId }, data: { status: 'failed' } }),
      ...(next !== run.remark.status ? [this.prisma.remark.update({ where: { id: run.remark.id }, data: { status: next } })] : []),
    ]);
    return next;
  }

  /** Прогоны, которые остались `running` после падения процесса: чекпоинт есть, исполнителя нет. */
  async failStaleRuns(olderThanMs: number): Promise<number> {
    const stale = await this.prisma.agentRun.findMany({ where: { status: 'running', createdAt: { lt: new Date(Date.now() - olderThanMs) } }, select: { id: true } });
    for (const run of stale) await this.failRun(run.id);
    return stale.length;
  }

  /**
   * run.cancel (docs/WS.md): вердикта нет, run = cancelled. Триаж возвращается в `imported`,
   * ретест — в `ready_for_retest` без нового кадра. Повтор по уже остановленному прогону — тот же ответ.
   */
  async cancelRun(ctx: ProjectContext, remarkId: string, runId: string): Promise<RemarkView> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    const run = row.runs.find((r) => r.id === runId);
    if (!run) throw new ConflictException('runId не относится к этому замечанию');
    if (run.status !== 'running' && run.status !== 'awaiting_human') return this.get(ctx, remarkId);
    const latest = [...row.runs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const ops: Prisma.PrismaPromise<unknown>[] = [this.prisma.agentRun.update({ where: { id: runId }, data: { status: 'cancelled' } })];
    if (latest?.id === runId) {
      if (run.mode === 'triage' && (row.status === 'triaging' || row.status === 'awaiting_pm')) {
        ops.push(this.prisma.remark.update({ where: { id: remarkId }, data: { status: 'imported' } }));
      }
      if (run.mode === 'retest' && (row.status === 'ready_for_retest' || row.status === 'awaiting_business_close')) {
        ops.push(
          this.prisma.remarkScreenshot.deleteMany({ where: { remarkId, kind: { in: ['retest', 'diff'] } } }),
          this.prisma.remark.update({ where: { id: remarkId }, data: { status: 'ready_for_retest', retestOutcome: null, retestExplanation: null } }),
        );
      }
    }
    await this.prisma.$transaction(ops);
    return this.get(ctx, remarkId);
  }

  // ---------- решения человека ----------

  /**
   * Вердикт PM (и бизнеса на `unspecified`). `rejected_binding` записывает вердикт и возвращает замечание
   * в `triaging` того же run — граф продолжает его из чекпоинта (AgentService). Повтор idempotencyKey —
   * тот же результат без второго HumanVerdict.
   */
  async verdict(ctx: ProjectContext, remarkId: string, dto: VerdictDto): Promise<VerdictResult> {
    const row = await this.load(ctx, remarkId);
    const run = row.runs.find((r) => r.id === dto.runId);
    if (!run) throw new ConflictException('runId не относится к этому замечанию');

    const existing = await this.prisma.humanVerdict.findUnique({ where: { runId_idempotencyKey: { runId: dto.runId, idempotencyKey: dto.idempotencyKey } } });
    if (existing) return { remark: await this.get(ctx, remarkId), applied: false };

    if (dto.verdict === 'rejected_binding') {
      if (ctx.role !== 'pm') throw new ForbiddenException();
      this.assertTransition(row.status, ['awaiting_pm'], 'rejected_binding');
      if (!dto.comment?.trim()) throw new ConflictException('Для «не та цитата» нужен комментарий');
      await this.prisma.$transaction([
        this.prisma.humanVerdict.create({ data: { remarkId, runId: dto.runId, userId: ctx.userId, code: 'rejected_binding', comment: dto.comment.trim(), idempotencyKey: dto.idempotencyKey } }),
        this.prisma.remark.update({ where: { id: remarkId }, data: { status: 'triaging' } }),
        this.prisma.agentRun.update({ where: { id: dto.runId }, data: { status: 'running' } }),
      ]);
      return { remark: await this.get(ctx, remarkId), applied: true };
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
    return { remark: await this.get(ctx, remarkId), applied: true };
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

  // ---------- ретест ----------

  /** Новый кадр от бизнеса: старый ретест и дифф снимаются, стартует AgentRun mode=retest. Статус — до диффа. */
  async beginRetest(ctx: ProjectContext, remarkId: string, screenshotKey: string, model: string): Promise<{ runId: string }> {
    if (ctx.role !== 'business') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['ready_for_retest'], 'retest');
    if (row.runs.some((r) => r.mode === 'retest' && r.status === 'running')) throw new ConflictException('Кадры уже сравниваются');
    const [, , run] = await this.prisma.$transaction([
      this.prisma.remarkScreenshot.deleteMany({ where: { remarkId, kind: { in: ['retest', 'diff'] } } }),
      this.prisma.remarkScreenshot.create({ data: { remarkId, kind: 'retest', storageKey: screenshotKey } }),
      this.prisma.agentRun.create({ data: { remarkId, projectId: ctx.projectId, mode: 'retest', status: 'running', model } }),
    ]);
    return { runId: run.id };
  }

  async retestFacts(ctx: ProjectContext, remarkId: string): Promise<RetestFacts> {
    const row = await this.load(ctx, remarkId);
    const retest = [...row.screenshots].filter((s) => s.kind === 'retest').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!retest) throw new ConflictException('Нет нового кадра для ретеста');
    const chunkIds = row.citations.map((c) => c.chunkId);
    const chunks = chunkIds.length ? await this.prisma.documentChunk.findMany({ where: { id: { in: chunkIds }, projectId: ctx.projectId }, select: { section: true, content: true } }) : [];
    return {
      description: row.description,
      expected: row.expected,
      originalKey: row.screenshots.find((s) => s.kind === 'original')?.storageKey ?? null,
      retestKey: retest.storageKey,
      citations: chunks.map((c) => ({ section: c.section, text: quote(c.content) })),
    };
  }

  /** Дифф и пояснение → awaiting_business_close. Модель здесь ничего не закрывает: только бизнес. */
  async applyRetest(ctx: ProjectContext, remarkId: string, runId: string, result: RetestResultInput): Promise<RemarkView> {
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['ready_for_retest'], 'retest_result');
    const run = await this.prisma.agentRun.findFirst({ where: { id: runId, remarkId, status: 'running' } });
    if (!run) throw new ConflictException('Прогон уже завершён или остановлен');
    const retest = [...row.screenshots].filter((s) => s.kind === 'retest').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    await this.prisma.$transaction([
      ...(retest && result.retestSize ? [this.prisma.remarkScreenshot.update({ where: { id: retest.id }, data: result.retestSize })] : []),
      this.prisma.remarkScreenshot.deleteMany({ where: { remarkId, kind: 'diff' } }),
      ...(result.diffShot ? [this.prisma.remarkScreenshot.create({ data: { remarkId, kind: 'diff', ...result.diffShot } })] : []),
      this.prisma.remark.update({
        where: { id: remarkId },
        data: { status: 'awaiting_business_close', retestOutcome: result.outcome, retestExplanation: result.explanation },
      }),
      this.prisma.agentRun.update({ where: { id: runId }, data: { status: 'awaiting_human', ...usageData(result.usage) } }),
    ]);
    return this.get(ctx, remarkId);
  }

  async close(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    if (ctx.role !== 'business') throw new ForbiddenException('Закрыть замечание может только тот, кто принимает работу');
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['awaiting_business_close'], 'close');
    await this.prisma.$transaction([
      this.prisma.remark.update({ where: { id: remarkId }, data: { status: 'closed', closedByUserId: ctx.userId, closedAt: new Date() } }),
      this.prisma.agentRun.updateMany({ where: { remarkId, mode: 'retest', status: 'awaiting_human' }, data: { status: 'persisted' } }),
    ]);
    return this.get(ctx, remarkId);
  }

  async notFixed(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    if (ctx.role !== 'business') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['awaiting_business_close'], 'not_fixed');
    await this.prisma.$transaction([
      this.prisma.remarkScreenshot.deleteMany({ where: { remarkId, kind: { in: ['retest', 'diff'] } } }),
      this.prisma.remark.update({ where: { id: remarkId }, data: { status: 'defect', retestOutcome: null, retestExplanation: null } }),
      this.prisma.agentRun.updateMany({ where: { remarkId, mode: 'retest', status: 'awaiting_human' }, data: { status: 'persisted' } }),
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

    const traceUrl = (runId: string) => this.observability.traceUrl(runId);
    return rows.map((r) => toRemarkView(r, { duplicateOfNumber: r.duplicateOfId ? numberById.get(r.duplicateOfId) : undefined, chunks, names, traceUrl }));
  }
}

function usageData(usage?: LlmUsage): { inputTokens?: number; outputTokens?: number; costUsd?: number } {
  if (!usage || (usage.inputTokens === 0 && usage.outputTokens === 0)) return {};
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd };
}
