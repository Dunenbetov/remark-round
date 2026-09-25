import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, ProposedClass, Remark, RemarkStatus, RetestOutcome, Role, ScreenshotKind, VerdictCode } from '@remarkround/db';
import type { LlmUsage } from '../llm/triage-llm';
import { ObservabilityService } from '../observability/observability.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { ProjectContext } from '../tenancy/project-context';
import { NotificationsService } from '../notifications/notifications.service';
import { AdviceDto, CreateRemarkDto, DEVELOPER_STATUSES, FixRowDto, ImportedRemarkInput, RemarkRow, RemarkView, VerdictDto, audienceFor, canRead, quote, toHistoryEntry, toRemarkView, type HistoryEntry } from './remark.dto';
import { PROPOSED_LABEL_RU, RETEST_OUTCOME_RU } from './labels';

const REMARK_INCLUDE = {
  round: { select: { number: true } },
  // Текущие кадры: заменённые остаются в базе и ссылкой из истории, но на карточку не выходят (ADR 011)
  screenshots: { where: { supersededAt: null } },
  citations: { select: { id: true, chunkId: true, quoteText: true, section: true, documentTitle: true, documentKind: true, effectiveAt: true } },
  verdicts: { select: { code: true, userId: true, comment: true, createdAt: true } },
  advices: { select: { code: true, userId: true, comment: true, updatedAt: true } },
  runs: { select: { id: true, createdAt: true, status: true, mode: true, failureMessage: true, model: true } },
  origin: { select: { id: true, number: true, round: { select: { number: true } } } },
  reopenedBy: { select: { id: true, number: true, round: { select: { number: true } } }, orderBy: { createdAt: 'desc' }, take: 1 },
  // Как закрыли и с каким комментарием (ADR 010): строка `close` одна — closed терминален, повтор претензии — новое замечание
  history: { where: { action: 'close' }, orderBy: { createdAt: 'desc' }, take: 1, select: { fromStatus: true, comment: true } },
} satisfies Prisma.RemarkInclude;

export const ROUND_CLOSED = 'Раунд закрыт — добавляйте в открытый раунд';
const RETEST_RUNNING = 'Кадры уже сравниваются — дождитесь диффа';

/** Сколько соседей раунда получает модель для поиска повторов. */
const MAX_SIBLINGS = 60;

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
  /** Абзацы черновика; первый: заголовок, как в apps/web/src/app/core/copy.ts. */
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
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Кадр из тела запроса — только ключ этого проекта той же формы, что выдаёт POST /media: чужой иначе ушёл бы в vision и pixel-diff (фаза 11). */
  private async assertShot(ctx: ProjectContext, storageKey: string): Promise<void> {
    if (!this.storage.belongsTo(ctx.projectId, storageKey)) throw new UnprocessableEntityException('Кадр не из этого проекта');
  }

  /**
   * Номер в раунде под блокировкой строки раунда: два одновременных замечания иначе получали один номер
   * (@@unique(roundId, number) → P2002). На всякий случай — повтор.
   */
  private async createNumbered(
    roundId: string,
    data: Omit<Prisma.RemarkUncheckedCreateInput, 'number' | 'roundId'>,
    by: HistoryBy & { action: 'create' | 'import' | 'reopen' },
    /** Дописать ещё что-то в той же транзакции (повтор претензии — строку на оригинале). */
    also?: (tx: Prisma.TransactionClient, created: Remark) => Promise<void>,
  ): Promise<Remark> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Round" WHERE "id" = ${roundId} FOR UPDATE`;
          const last = await tx.remark.findFirst({ where: { roundId }, orderBy: { number: 'desc' }, select: { number: true } });
          const created = await tx.remark.create({ data: { ...data, roundId, number: (last?.number ?? 0) + 1 }, include: { screenshots: { select: { id: true } } } });
          // Строка «создано» ссылается на кадр, с которым замечание пришло
          await this.writeHistory(tx, { ...by, remarkId: created.id, fromStatus: null, toStatus: created.status, screenshotId: created.screenshots[0]?.id ?? null });
          if (also) await also(tx, created);
          return created;
        });
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002' || attempt >= 3) throw e;
      }
    }
  }

  // ---------- чтение ----------

  async list(ctx: ProjectContext, roundId: string): Promise<RemarkView[]> {
    const round = await this.prisma.round.findFirst({ where: { id: roundId, projectId: ctx.projectId } });
    if (!round) throw new NotFoundException();
    const rows = await this.prisma.remark.findMany({
      where: { projectId: ctx.projectId, roundId, ...(ctx.role === 'developer' ? { status: { in: DEVELOPER_STATUSES } } : {}) },
      include: REMARK_INCLUDE,
      orderBy: { number: 'desc' },
    });
    return this.views(rows, ctx);
  }

  async devQueue(ctx: ProjectContext): Promise<RemarkView[]> {
    const rows = await this.prisma.remark.findMany({
      where: { projectId: ctx.projectId, status: { in: DEVELOPER_STATUSES } },
      include: REMARK_INCLUDE,
      orderBy: [{ status: 'asc' }, { number: 'asc' }],
    });
    return this.views(rows, ctx);
  }

  /** Разработчику: что сейчас на приёмке у PM — можно посоветовать решение. Не очередь работы (docs/STATUS.md). */
  async advisoryQueue(ctx: ProjectContext): Promise<RemarkView[]> {
    if (ctx.role !== 'developer') throw new ForbiddenException();
    const rows = await this.prisma.remark.findMany({
      where: { projectId: ctx.projectId, status: 'awaiting_pm' },
      include: REMARK_INCLUDE,
      orderBy: { number: 'asc' },
    });
    return this.views(rows, ctx);
  }

  async get(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    const row = await this.load(ctx, remarkId);
    if (!canRead(ctx.role, row.status)) throw new NotFoundException();
    return (await this.views([row], ctx))[0]!;
  }

  /** По адресу SPA: раунд по номеру в проекте, замечание по номеру в раунде (@@unique(roundId, number)). */
  async getAt(ctx: ProjectContext, roundNumber: number, number: number): Promise<RemarkView> {
    const row = await this.prisma.remark.findFirst({ where: { projectId: ctx.projectId, number, round: { number: roundNumber } }, select: { id: true } });
    if (!row) throw new NotFoundException();
    return this.get(ctx, row.id);
  }

  async statusOf(ctx: ProjectContext, remarkId: string): Promise<RemarkStatus> {
    const row = await this.prisma.remark.findFirst({ where: { id: remarkId, projectId: ctx.projectId }, select: { status: true } });
    if (!row) throw new NotFoundException();
    return row.status;
  }

  /**
   * История переходов (аудит: remark-history, ADR 011): тот же ACL, что у карточки. Имя — снимком на момент действия,
   * кадр действия — ссылкой, даже если его потом заменили. Заказчику — без предложений модели и слов команды (ADR 007).
   */
  async history(ctx: ProjectContext, remarkId: string): Promise<HistoryEntry[]> {
    await this.get(ctx, remarkId);
    const rows = await this.prisma.remarkStatusChange.findMany({ where: { remarkId }, orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } });
    const shotIds = rows.map((h) => h.screenshotId).filter((id): id is string => Boolean(id));
    const shots = shotIds.length ? await this.prisma.remarkScreenshot.findMany({ where: { remarkId, id: { in: shotIds } }, select: { id: true, kind: true, storageKey: true, supersededAt: true } }) : [];
    const shotById = new Map(shots.map((s) => [s.id, s]));
    const audience = audienceFor(ctx.role);
    return rows.map((h) => toHistoryEntry(h, audience, ctx.projectId, shotById));
  }

  // ---------- создание ----------

  /** Ручное замечание → `imported`. Разбор стартует AgentService (граф), не здесь. */
  async create(ctx: ProjectContext, roundId: string, dto: CreateRemarkDto): Promise<RemarkView> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const round = await this.openRound(ctx, roundId);
    if (dto.screenshotKey) await this.assertShot(ctx, dto.screenshotKey);
    const remark = await this.createNumbered(roundId, {
      projectId: ctx.projectId,
      description: dto.description.trim(),
      pageOrScreen: dto.pageOrScreen?.trim() || null,
      expected: dto.expected?.trim() || null,
      status: 'imported',
      authorId: ctx.userId,
      screenshots: dto.screenshotKey ? { create: { kind: 'original', storageKey: dto.screenshotKey } } : undefined,
    }, { action: 'create', userId: ctx.userId, role: ctx.role });
    return this.get(ctx, remark.id);
  }

  /**
   * Строка журнала из ImportService. Разбор здесь не стартует: импорт запускает его сам по распарсенным
   * строкам, а needs_human_parse ждёт человека (docs/STATUS.md: «граф не стартовать»).
   */
  async createImported(ctx: ProjectContext, roundId: string, input: ImportedRemarkInput): Promise<{ id: string; number: number; status: RemarkStatus }> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const round = await this.openRound(ctx, roundId);
    const created = await this.createNumbered(roundId, {
      projectId: ctx.projectId,
      externalId: input.externalId,
      pageOrScreen: input.pageOrScreen,
      description: input.description.trim(),
      expected: input.expected,
      severity: input.severity,
      status: input.status,
      authorId: ctx.userId,
      screenshots: input.screenshot ? { create: { kind: 'original', ...input.screenshot } } : undefined,
    }, { action: 'import', userId: ctx.userId, role: ctx.role });
    return { id: created.id, number: created.number, status: created.status };
  }

  /**
   * Повтор претензии (docs/STATUS.md closed → reopened): заказчик говорит «в новом раунде это то же самое, что вы
   * закрыли». Закрытое замечание не трогаем — оно остаётся записью с кадрами, цитатами и решением; в открытом раунде появляется
   * новое со ссылкой на оригинал, тем же текстом и кадром (или новым), статус `reopened` → дальше обычный триаж.
   */
  async reopen(ctx: ProjectContext, remarkId: string, roundId: string, screenshotKey?: string | null): Promise<RemarkView> {
    if (ctx.role !== 'business') throw new ForbiddenException('Открыть претензию снова может только тот, кто принимает работу');
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['closed'], 'reopen');
    const target = await this.openRound(ctx, roundId);
    if (screenshotKey) await this.assertShot(ctx, screenshotKey);
    const original = row.screenshots.find((s) => s.kind === 'original');
    const shot = screenshotKey ? { storageKey: screenshotKey } : original ? { storageKey: original.storageKey, width: original.width, height: original.height } : null;
    const created = await this.createNumbered(target.id, {
      projectId: ctx.projectId,
      externalId: row.externalId,
      pageOrScreen: row.pageOrScreen,
      description: row.description,
      expected: row.expected,
      severity: row.severity,
      status: 'reopened',
      authorId: ctx.userId,
      originRemarkId: row.id,
      screenshots: shot ? { create: { kind: 'original', ...shot } } : undefined,
    }, { action: 'reopen', userId: ctx.userId, role: ctx.role, detail: `Повтор № ${row.number} из раунда ${row.round.number}` }, async (tx, created) => {
      // Оригинал остаётся закрытым, но в его истории видно, что претензию предъявили снова (ADR 011)
      await this.writeHistory(tx, { remarkId: row.id, fromStatus: row.status, toStatus: row.status, action: 'reopened_as', userId: ctx.userId, role: ctx.role, detail: `Повтор в раунде ${target.number} — № ${created.number}` });
    });
    return this.get(ctx, created.id);
  }

  /** Раунд этого проекта, в который ещё можно писать: закрытый — 409 (RoundsService.close). */
  private async openRound(ctx: ProjectContext, roundId: string): Promise<{ id: string; number: number; status: 'open' | 'closed' }> {
    const round = await this.prisma.round.findFirst({ where: { id: roundId, projectId: ctx.projectId }, select: { id: true, number: true, status: true } });
    if (!round) throw new NotFoundException();
    if (round.status === 'closed') throw new ConflictException(ROUND_CLOSED);
    return round;
  }

  /** «Допишите строку журнала»: needs_human_parse → imported (человек починил строку). Дальше — граф. */
  async fixRow(ctx: ProjectContext, remarkId: string, dto: FixRowDto): Promise<RemarkView> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['needs_human_parse'], 'fix_row');
    await this.prisma.$transaction((tx) =>
      this.transition(tx, row.id, ['needs_human_parse'], 'fix_row', {
        description: dto.description.trim(),
        pageOrScreen: dto.pageOrScreen?.trim() || row.pageOrScreen,
        expected: dto.expected?.trim() || row.expected,
        status: 'imported',
      }, { userId: ctx.userId, role: ctx.role, fromStatus: row.status }),
    );
    return this.get(ctx, row.id);
  }

  /** Новый кадр по «Не хватает скрина»: кадр меняется, статус остаётся до старта графа. */
  async attachScreenshot(ctx: ProjectContext, remarkId: string, screenshotKey: string): Promise<RemarkView> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['cannot_tell', 'imported'], 'attach_screenshot');
    await this.assertShot(ctx, screenshotKey);
    await this.prisma.$transaction(async (tx) => {
      // Прежний кадр не удаляется, а помечается заменённым: на него могла ссылаться история и решение (ADR 011)
      await supersede(tx, remarkId, ['original']);
      const shot = await tx.remarkScreenshot.create({ data: { remarkId, kind: 'original', storageKey: screenshotKey } });
      await this.writeHistory(tx, { remarkId, fromStatus: row.status, toStatus: row.status, action: 'attach_screenshot', userId: ctx.userId, role: ctx.role, screenshotId: shot.id });
    });
    return this.get(ctx, remarkId);
  }

  // ---------- прогон графа: старт, снимки, запись результата ----------

  /** imported | cannot_tell | reopened → triaging. Один AgentRun на прогон; thread_id графа = его id. */
  async beginTriage(ctx: ProjectContext, remarkId: string, model: string): Promise<{ runId: string }> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['imported', 'cannot_tell', 'reopened'], 'triage');
    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agentRun.create({ data: { remarkId: row.id, projectId: ctx.projectId, mode: 'triage', status: 'running', model } });
      await this.transition(tx, row.id, ['imported', 'cannot_tell', 'reopened'], 'triage', { status: 'triaging' }, { userId: ctx.userId, role: ctx.role, fromStatus: row.status, runId: created.id });
      return created;
    });
    return { runId: run.id };
  }

  async triageFacts(ctx: ProjectContext, remarkId: string): Promise<TriageFacts> {
    const row = await this.load(ctx, remarkId);
    // Соседи раунда идут в промпт целиком: потолок, иначе раунд на 500 строк раздувает каждый прогон (аудит: unbounded-text-into-prompt)
    const siblings = await this.prisma.remark.findMany({
      where: { roundId: row.roundId, projectId: ctx.projectId, id: { not: row.id }, status: { notIn: ['duplicate'] } },
      select: { number: true, description: true },
      orderBy: { number: 'asc' },
      take: MAX_SIBLINGS,
    });
    const original = row.screenshots.find((s) => s.kind === 'original');
    return {
      description: row.description,
      expected: row.expected,
      pageOrScreen: row.pageOrScreen,
      hasScreenshot: Boolean(original),
      screenshotKey: original?.storageKey ?? null,
      siblings,
      citedChunkIds: row.citations.map((c) => c.chunkId).filter((id): id is string => Boolean(id)),
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
    // Чужой чанк в цитаты не попадёт, даже если модель его «вспомнила»: фильтр проекта стоит в SQL.
    // Цитата хранится снимком (текст, раздел, документ): переиндексация ТЗ не отнимет обоснование у решения.
    const own = proposal.chunkIds.length
      ? await this.prisma.documentChunk.findMany({
          where: { id: { in: proposal.chunkIds }, projectId: ctx.projectId },
          select: { id: true, section: true, content: true, document: { select: { kind: true, title: true, effectiveAt: true } } },
        })
      : [];
    const byId = new Map(own.map((c) => [c.id, c]));
    const citations = proposal.chunkIds.flatMap((id) => {
      const c = byId.get(id);
      return c ? [{ remarkId, chunkId: c.id, quoteText: c.content, section: c.section, documentTitle: c.document.title, documentKind: c.document.kind, effectiveAt: c.document.effectiveAt }] : [];
    });
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, remarkId, ['triaging'], 'proposal', {
        status: 'awaiting_pm',
        proposedClass: proposal.proposedClass,
        rationale: proposal.rationale.join('\n\n'),
        visionFacts: proposal.visionFacts ?? null,
        duplicateOfId: duplicateOf?.id ?? null,
      }, { userId: null, role: null, fromStatus: 'triaging', runId, detail: proposalDetail(proposal) });
      await tx.evidenceCitation.deleteMany({ where: { remarkId } });
      if (citations.length) await tx.evidenceCitation.createMany({ data: citations });
      // Снимок предложения в самом прогоне: новый прогон (после cannot_tell, reopen) не затирает прежний разбор
      await tx.agentRun.update({
        where: { id: runId },
        data: { status: 'awaiting_human', proposedClass: proposal.proposedClass, rationale: proposal.rationale.join('\n\n'), visionFacts: proposal.visionFacts ?? null },
      });
      // Второй проход того же run («Не та цитата») дописывает свой расход к первому, а не затирает его (P3)
      await addUsage(tx, runId, proposal.usage);
    });
    return this.get(ctx, remarkId);
  }

  /**
   * Прогон упал: run = failed с причиной, замечание возвращается туда, откуда можно «Запустить снова».
   * `usage` — уже оплаченные вызовы сбойного прогона: прибавляются к run, как и у дошедшего до черновика (P3).
   */
  async failRun(runId: string, failure?: { code: string; message: string }, usage?: LlmUsage): Promise<RemarkStatus | null> {
    const run = await this.prisma.agentRun.findUnique({ where: { id: runId }, include: { remark: { select: { id: true, status: true } } } });
    if (!run || run.status !== 'running') return run?.remark.status ?? null;
    const next: RemarkStatus = run.mode === 'triage' && run.remark.status === 'triaging' ? 'imported' : run.remark.status;
    await this.prisma.$transaction(async (tx) => {
      await tx.agentRun.update({ where: { id: runId }, data: { status: 'failed', failureCode: failure?.code ?? null, failureMessage: failure?.message ?? null } });
      await addUsage(tx, runId, usage);
      if (next !== run.remark.status) await tx.remark.update({ where: { id: run.remark.id }, data: { status: next } });
      await tx.remarkStatusChange.create({ data: { remarkId: run.remark.id, fromStatus: run.remark.status, toStatus: next, action: 'run_failed', runId, detail: failure?.message ?? null } });
    });
    return next;
  }

  /**
   * Прогоны, которые остались `running` без исполнителя: чекпоинт есть, задачи в очереди нет (упал процесс до
   * появления очереди, задача исчерпала попытки и была снята вручную). Прогон с живой задачей — ждёт свой повтор.
   * С 18.09 (P2) зовётся по таймеру раз в минуту, поэтому «давно» считается от последнего действия с прогоном, а не
   * от его создания: «Не та цитата» через час после старта снова делает run `running` и ставит задачу resume
   * отдельным шагом после транзакции — в этот миг задачи ещё нет, но прогон не сирота.
   */
  async failStaleRuns(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const stale = await this.prisma.agentRun.findMany({ where: { status: 'running', createdAt: { lt: cutoff } }, select: { id: true, remarkId: true } });
    let n = 0;
    for (const run of stale) {
      const pending = await this.prisma.job.count({ where: { runId: run.id, status: { in: ['queued', 'running'] } } });
      if (pending) continue;
      const recent = await this.prisma.remarkStatusChange.count({ where: { remarkId: run.remarkId, runId: run.id, createdAt: { gte: cutoff } } });
      if (recent) continue;
      await this.failRun(run.id, { code: 'process_restart', message: 'Прогон прервался при перезапуске сервера — запустите снова' });
      n++;
    }
    return n;
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
    // Статус меняется только из того, что прочитали: параллельный вердикт не будет перезаписан отменой.
    // Порядок блокировок как у verdict(): сначала Remark, потом AgentRun — иначе две встречные транзакции ловят deadlock.
    await this.prisma.$transaction(async (tx) => {
      let changed: { count: number } = { count: 0 };
      let next: RemarkStatus = row.status;
      if (latest?.id === runId) {
        if (run.mode === 'triage' && (row.status === 'triaging' || row.status === 'awaiting_pm')) {
          next = 'imported';
          changed = await tx.remark.updateMany({ where: { id: remarkId, status: { in: ['triaging', 'awaiting_pm'] } }, data: { status: next } });
        }
        if (run.mode === 'retest' && (row.status === 'ready_for_retest' || row.status === 'awaiting_business_close')) {
          next = 'ready_for_retest';
          changed = await tx.remark.updateMany({ where: { id: remarkId, status: { in: ['ready_for_retest', 'awaiting_business_close'] } }, data: { status: next, retestOutcome: null, retestExplanation: null } });
          // Кадр остановленного ретеста остаётся в базе заменённым — с карточки уходит, из истории нет (ADR 011)
          if (changed.count === 1) await supersede(tx, remarkId, ['retest', 'diff']);
        }
      }
      // Прогон, который параллельный вердикт уже перевёл в persisted, отменой не трогаем
      const cancelled = await tx.agentRun.updateMany({ where: { id: runId, status: { in: ['running', 'awaiting_human'] } }, data: { status: 'cancelled' } });
      if (cancelled.count === 1 || changed.count === 1) {
        await this.writeHistory(tx, { remarkId, fromStatus: row.status, toStatus: changed.count === 1 ? next : row.status, action: 'cancel', userId: ctx.userId, role: ctx.role, runId });
      }
    });
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
      const comment = dto.comment.trim();
      await this.prisma.$transaction(async (tx) => {
        await this.transition(tx, remarkId, ['awaiting_pm'], 'rejected_binding', { status: 'triaging' }, { userId: ctx.userId, role: ctx.role, fromStatus: row.status, runId: dto.runId, comment });
        await tx.humanVerdict.create({ data: { remarkId, runId: dto.runId, userId: ctx.userId, code: 'rejected_binding', comment, idempotencyKey: dto.idempotencyKey } });
        await tx.agentRun.update({ where: { id: dto.runId }, data: { status: 'running' } });
      });
      return { remark: await this.get(ctx, remarkId), applied: true };
    }

    const next = this.nextStatusForVerdict(ctx, row.status, dto.verdict);
    const duplicateOf = dto.verdict === 'duplicate' && dto.duplicateOfNumber
      ? await this.prisma.remark.findFirst({ where: { roundId: row.roundId, number: dto.duplicateOfNumber } })
      : null;
    // Условная запись: два одновременных решения не дадут «произвольного победителя» — второе получит 409 и перечитает карточку
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, remarkId, [row.status], 'verdict', { status: next, duplicateOfId: duplicateOf?.id ?? row.duplicateOfId }, { userId: ctx.userId, role: ctx.role, fromStatus: row.status, runId: dto.runId, comment: dto.comment?.trim() || null });
      await tx.humanVerdict.create({ data: { remarkId, runId: dto.runId, userId: ctx.userId, code: dto.verdict, comment: dto.comment?.trim() || null, idempotencyKey: dto.idempotencyKey } });
      await tx.agentRun.update({ where: { id: dto.runId }, data: { status: 'persisted' } });
    });
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
    // Закрытый раунд — только для чтения: связи в нём не меняются (ADR 011)
    await this.openRound(ctx, row.roundId);
    const original = await this.prisma.remark.findFirst({ where: { roundId: row.roundId, number: duplicateOfNumber } });
    if (!original || original.id === row.id) throw new NotFoundException('Оригинал не найден в этом раунде');
    // Статус не меняется, но связь — решение человека: в истории видно, кто и с каким номером связал (ADR 011)
    await this.prisma.$transaction(async (tx) => {
      await tx.remark.update({ where: { id: remarkId }, data: { duplicateOfId: original.id } });
      await this.writeHistory(tx, { remarkId, fromStatus: row.status, toStatus: row.status, action: 'link_duplicate', userId: ctx.userId, role: ctx.role, detail: `Оригинал — № ${original.number}` });
    });
    return this.get(ctx, remarkId);
  }

  async readyForRetest(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    if (ctx.role !== 'developer') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['defect'], 'ready_for_retest');
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, remarkId, ['defect'], 'ready_for_retest', { status: 'ready_for_retest', fixedByUserId: ctx.userId }, { userId: ctx.userId, role: ctx.role, fromStatus: row.status });
    });
    return this.get(ctx, remarkId);
  }

  // ---------- совет разработчика ----------

  /**
   * Совет по замечанию в awaiting_pm: не вердикт — статус и прогон не трогает, PM видит его рядом с вариантом.
   * Один совет на человека: повтор меняет код и комментарий. Решённое замечание советов не принимает (409).
   */
  async advise(ctx: ProjectContext, remarkId: string, dto: AdviceDto): Promise<RemarkView> {
    if (ctx.role !== 'developer') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['awaiting_pm'], 'advice');
    const comment = dto.comment?.trim() || null;
    await this.prisma.developerAdvice.upsert({
      where: { remarkId_userId: { remarkId, userId: ctx.userId } },
      create: { remarkId, userId: ctx.userId, code: dto.code, comment },
      update: { code: dto.code, comment },
    });
    return this.get(ctx, remarkId);
  }

  async retractAdvice(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    if (ctx.role !== 'developer') throw new ForbiddenException();
    await this.load(ctx, remarkId);
    await this.prisma.developerAdvice.deleteMany({ where: { remarkId, userId: ctx.userId } });
    return this.get(ctx, remarkId);
  }

  // ---------- ретест ----------

  /** Новый кадр от бизнеса: старый ретест и дифф помечаются заменёнными, стартует AgentRun mode=retest. Статус — до диффа. */
  async beginRetest(ctx: ProjectContext, remarkId: string, screenshotKey: string, model: string): Promise<{ runId: string }> {
    if (ctx.role !== 'business') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['ready_for_retest'], 'retest');
    if (row.runs.some((r) => r.mode === 'retest' && r.status === 'running')) throw new ConflictException(RETEST_RUNNING);
    await this.assertShot(ctx, screenshotKey);
    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agentRun.create({ data: { remarkId, projectId: ctx.projectId, mode: 'retest', status: 'running', model } });
      // Прежний круг ретеста остаётся в истории (ADR 011): кадры не удаляются, строка истории ссылается на новый кадр —
      // поэтому кадр пишется раньше строки. Статус не меняется, но условная запись (SET status=status) проверит, что
      // замечание всё ещё ready_for_retest; 409 откатит и кадр.
      await supersede(tx, remarkId, ['retest', 'diff']);
      const shot = await tx.remarkScreenshot.create({ data: { remarkId, kind: 'retest', storageKey: screenshotKey } });
      await this.transition(tx, remarkId, ['ready_for_retest'], 'retest', { status: 'ready_for_retest' }, { userId: ctx.userId, role: ctx.role, fromStatus: row.status, runId: created.id, screenshotId: shot.id });
      return created;
    });
    return { runId: run.id };
  }

  async retestFacts(ctx: ProjectContext, remarkId: string): Promise<RetestFacts> {
    const row = await this.load(ctx, remarkId);
    const retest = [...row.screenshots].filter((s) => s.kind === 'retest').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!retest) throw new ConflictException('Нет нового кадра для ретеста');
    return {
      description: row.description,
      expected: row.expected,
      originalKey: row.screenshots.find((s) => s.kind === 'original')?.storageKey ?? null,
      retestKey: retest.storageKey,
      // Снимок цитаты: тот же текст, что видел PM, даже если ТЗ с тех пор переиндексировали
      citations: row.citations.flatMap((c) => (c.quoteText ? [{ section: c.section, text: quote(c.quoteText) }] : [])),
    };
  }

  /** Дифф и пояснение → awaiting_business_close. Модель здесь ничего не закрывает: только бизнес. */
  async applyRetest(ctx: ProjectContext, remarkId: string, runId: string, result: RetestResultInput): Promise<RemarkView> {
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['ready_for_retest'], 'retest_result');
    const run = await this.prisma.agentRun.findFirst({ where: { id: runId, remarkId, status: 'running' } });
    if (!run) throw new ConflictException('Прогон уже завершён или остановлен');
    const retest = [...row.screenshots].filter((s) => s.kind === 'retest').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    await this.prisma.$transaction(async (tx) => {
      if (retest && result.retestSize) await tx.remarkScreenshot.update({ where: { id: retest.id }, data: result.retestSize });
      await supersede(tx, remarkId, ['diff']);
      // Дифф — результат этого сравнения: строка истории ссылается на него, поэтому кадр пишется первым
      const diff = result.diffShot ? await tx.remarkScreenshot.create({ data: { remarkId, kind: 'diff', ...result.diffShot } }) : null;
      await this.transition(tx, remarkId, ['ready_for_retest'], 'retest_result', { status: 'awaiting_business_close', retestOutcome: result.outcome, retestExplanation: result.explanation }, { userId: null, role: null, fromStatus: row.status, runId, detail: [RETEST_OUTCOME_RU[result.outcome], result.explanation].filter(Boolean).join(' — ').slice(0, 300), screenshotId: diff?.id ?? null });
      await tx.agentRun.update({ where: { id: runId }, data: { status: 'awaiting_human' } });
      await addUsage(tx, runId, result.usage);
    });
    return this.get(ctx, remarkId);
  }

  /**
   * «Закрыть: исправлено» — только заказчик (ADR 010). Из `awaiting_business_close` — после нового кадра и диффа;
   * из `ready_for_retest` — сразу после «Готово»: заказчик проверил сам, его закрытие и есть признание. Система
   * «исправлено» без кадра по-прежнему не утверждает — граф здесь не участвует. Пока кадры сравниваются — 409.
   */
  async close(ctx: ProjectContext, remarkId: string, comment?: string | null): Promise<RemarkView> {
    if (ctx.role !== 'business') throw new ForbiddenException('Закрыть замечание может только тот, кто принимает работу');
    const row = await this.load(ctx, remarkId);
    this.assertTransition(row.status, ['ready_for_retest', 'awaiting_business_close'], 'close');
    if (row.runs.some((r) => r.mode === 'retest' && r.status === 'running')) throw new ConflictException(RETEST_RUNNING);
    await this.prisma.$transaction(async (tx) => {
      // Из того статуса, что видел человек: если между чтением и кнопкой пришёл дифф — 409 и карточка перечитается
      await this.transition(tx, remarkId, [row.status], 'close', { status: 'closed', closedByUserId: ctx.userId, closedAt: new Date() }, { userId: ctx.userId, role: ctx.role, fromStatus: row.status, comment: comment?.trim() || null });
      // beginRetest статус не меняет: ретест, записанный пока ждали блокировку строки, откатывает закрытие
      if (await tx.agentRun.count({ where: { remarkId, mode: 'retest', status: 'running' } })) throw new ConflictException(RETEST_RUNNING);
      await tx.agentRun.updateMany({ where: { remarkId, mode: 'retest', status: 'awaiting_human' }, data: { status: 'persisted' } });
    });
    return this.get(ctx, remarkId);
  }

  async notFixed(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    if (ctx.role !== 'business') throw new ForbiddenException();
    const row = await this.load(ctx, remarkId);
    // Вернуть разработчику — только с новым кадром: без него «не исправлено» ничем не подтверждено (ADR 010)
    if (row.status === 'ready_for_retest') throw new ConflictException('«Не исправлено» — только с новым кадром: сначала прикрепите кадр ретеста');
    this.assertTransition(row.status, ['awaiting_business_close'], 'not_fixed');
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, remarkId, ['awaiting_business_close'], 'not_fixed', { status: 'defect', retestOutcome: null, retestExplanation: null }, { userId: ctx.userId, role: ctx.role, fromStatus: row.status });
      // Кадр, которым заказчик показал «не исправлено», остаётся в истории (ADR 011): с карточки уходит, из базы — нет
      await supersede(tx, remarkId, ['retest', 'diff']);
      await tx.agentRun.updateMany({ where: { remarkId, mode: 'retest', status: 'awaiting_human' }, data: { status: 'persisted' } });
    });
    return this.get(ctx, remarkId);
  }

  // ---------- helpers ----------


  private assertTransition(from: RemarkStatus, allowed: RemarkStatus[], action: string): void {
    if (!allowed.includes(from)) throw new ConflictException(`Переход «${action}» из статуса ${from} запрещён (docs/STATUS.md)`);
  }

  /**
   * Условная запись статуса (аудит: concurrent-verdict-races). assertTransition проверяет прочитанное в памяти,
   * а здесь Postgres гарантирует, что строка всё ещё в ожидаемом статусе: два одновременных решения дадут
   * одну запись и один 409 с актуальным статусом, а не произвольного «победителя». Бросок откатывает транзакцию.
   */
  private async transition(tx: Prisma.TransactionClient, remarkId: string, from: RemarkStatus[], action: string, data: Prisma.RemarkUncheckedUpdateManyInput, by: HistoryBy = {}): Promise<void> {
    const { count } = await tx.remark.updateMany({ where: { id: remarkId, status: { in: from } }, data });
    if (count === 1) {
      // История — в той же транзакции, что и статус (аудит: remark-history): строка на переход, кто, в какой роли, каким прогоном
      const toStatus = typeof data.status === 'string' ? data.status : undefined;
      if (toStatus) await this.writeHistory(tx, { ...by, remarkId, action, fromStatus: by.fromStatus ?? (from.length === 1 ? from[0]! : null), toStatus });
      return;
    }
    const now = await tx.remark.findUnique({ where: { id: remarkId }, select: { status: true } });
    throw new ConflictException(`Переход «${action}» из статуса ${now?.status ?? '?'} запрещён (docs/STATUS.md): карточка изменилась, обновите её`);
  }

  /**
   * Строка истории (ADR 011). Postgres не даст её потом поправить (триггер rr_append_only), поэтому всё известно
   * сейчас: имя человека — снимком (переименование и удаление аккаунта историю не меняют), кадр действия — ссылкой.
   * Уведомления (ADR 016) — здесь же, одной точкой на все переходы: под SAVEPOINT, их сбой решение не откатывает.
   */
  private async writeHistory(tx: Prisma.TransactionClient, h: Omit<HistoryBy, 'fromStatus'> & { remarkId: string; action: string; fromStatus: RemarkStatus | null; toStatus: RemarkStatus }): Promise<void> {
    const actorName = h.userId ? ((await tx.user.findUnique({ where: { id: h.userId }, select: { name: true } }))?.name ?? null) : null;
    const change = await tx.remarkStatusChange.create({
      data: {
        remarkId: h.remarkId,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        action: h.action,
        userId: h.userId ?? null,
        actorName,
        role: h.role ?? null,
        runId: h.runId ?? null,
        detail: h.detail ?? null,
        comment: h.comment ?? null,
        screenshotId: h.screenshotId ?? null,
      },
    });
    await this.notifications.record(tx, change);
  }

  private async load(ctx: ProjectContext, remarkId: string): Promise<RemarkRow> {
    const row = await this.prisma.remark.findFirst({ where: { id: remarkId, projectId: ctx.projectId }, include: REMARK_INCLUDE });
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Карточки для читателя `ctx`: заказчик (business) получает урезанный вид — ADR 007, `audienceFor`. */
  private async views(rows: RemarkRow[], ctx: ProjectContext): Promise<RemarkView[]> {
    const audience = audienceFor(ctx.role);
    const dupIds = rows.map((r) => r.duplicateOfId).filter((x): x is string => Boolean(x));
    const originals = dupIds.length ? await this.prisma.remark.findMany({ where: { id: { in: dupIds } }, select: { id: true, number: true } }) : [];
    const numberById = new Map(originals.map((o) => [o.id, o.number]));

    const userIds = [
      ...new Set(rows.flatMap((r) => [r.authorId, r.fixedByUserId, r.closedByUserId, ...r.verdicts.map((v) => v.userId), ...r.advices.map((a) => a.userId)]).filter((x): x is string => Boolean(x))),
    ];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    // Роль в проекте — рядом с именем: людей на стороне может быть несколько. Все строки — одного проекта (tenancy).
    const memberships = userIds.length ? await this.prisma.membership.findMany({ where: { projectId: rows[0]!.projectId, userId: { in: userIds } }, select: { userId: true, role: true } }) : [];
    const roles = new Map(memberships.map((m) => [m.userId, m.role]));

    const traceUrl = (runId: string) => this.observability.traceUrl(runId);
    return rows.map((r) => toRemarkView(r, { duplicateOfNumber: r.duplicateOfId ? numberById.get(r.duplicateOfId) : undefined, names, roles, traceUrl }, audience));
  }
}

/**
 * Токены и стоимость прогона прибавляются, а не перезаписываются (P3, аудит 18.09 §3.4): после «Не та цитата» тот же run
 * проходит classify и draft второй раз, а takeUsage отдаёт только расход этого прохода. Сырой SQL, потому что
 * Prisma `increment` на NULL даёт NULL (`NULL + x`), а у нового прогона счётчики пустые.
 */
async function addUsage(tx: Prisma.TransactionClient, runId: string, usage?: LlmUsage): Promise<void> {
  if (!usage || (usage.inputTokens === 0 && usage.outputTokens === 0)) return;
  await tx.$executeRaw`
    UPDATE "AgentRun" SET
      "inputTokens" = COALESCE("inputTokens", 0) + ${usage.inputTokens}::int,
      "outputTokens" = COALESCE("outputTokens", 0) + ${usage.outputTokens}::int,
      "costUsd" = COALESCE("costUsd", 0) + ${usage.costUsd}::numeric
    WHERE "id" = ${runId}`;
}


/** Кто и чем вызвал переход — для строки истории. */
interface HistoryBy {
  userId?: string | null;
  role?: Role | null;
  fromStatus?: RemarkStatus;
  runId?: string | null;
  detail?: string | null;
  /** Слова человека: комментарий к решению PM, к «не та цитата», к закрытию. */
  comment?: string | null;
  /** Кадр, который действие приложило или построило (attach_screenshot, retest, retest_result). */
  screenshotId?: string | null;
}

/** Текущие кадры вида `kinds` становятся заменёнными (ADR 011): строка остаётся в базе и в истории, с карточки кадр уходит. */
async function supersede(tx: Prisma.TransactionClient, remarkId: string, kinds: ScreenshotKind[]): Promise<void> {
  await tx.remarkScreenshot.updateMany({ where: { remarkId, kind: { in: kinds }, supersededAt: null }, data: { supersededAt: new Date() } });
}

/** Короткая пометка «что предложила модель»: класс и первый абзац черновика без заголовка. */
function proposalDetail(p: ProposalInput): string {
  const body = p.rationale.slice(1).find((x) => x.trim()) ?? p.rationale[0] ?? '';
  return `${PROPOSED_LABEL_RU[p.proposedClass]}${body ? `: ${body.trim()}` : ''}`.slice(0, 300);
}
