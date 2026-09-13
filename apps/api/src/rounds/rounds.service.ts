import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentKind, Prisma, RemarkStatus, Role } from '@remarkround/db';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { STATUS_LABEL_RU, TERMINAL_STATUSES } from '../remarks/labels';
import { audienceFor, closedViaOf, historyVisibility, quote } from '../remarks/remark.dto';
import type { ProjectContext } from '../tenancy/project-context';
import { buildJournalXlsx, type JournalEvent, type JournalPerson, type JournalRemark, type JournalRound } from './journal-export';

export interface RoundSummary {
  id: string;
  number: number;
  status: 'open' | 'closed';
  remarks: number;
  /** Замечаний, которые ещё чего-то ждут (не закрыто, не новое желание, не повтор). Пока > 0, новый раунд не открыть. */
  pending: number;
  closedAt: string | null;
}

export const ROUND_CLOSED = 'Раунд закрыт — добавляйте в открытый раунд';

/**
 * Раунды приёмки. Закрытие — момент «здесь мы остановились»: возможно, только когда ни одно замечание ничего
 * не ждёт (закрыто, новое желание, повтор); иначе 409 с перечнем того, что мешает. Выгрузка — журнал приёмки
 * (ADR 011): раунды, замечания и история с теми же правилами видимости, что у карточки.
 * Новый раунд открывается по тому же правилу: пока в проекте есть нерешённые замечания — 409.
 */
@Injectable()
export class RoundsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: ProjectContext): Promise<RoundSummary[]> {
    const [rounds, pending] = await Promise.all([
      this.prisma.round.findMany({
        where: { projectId: ctx.projectId },
        orderBy: { number: 'asc' },
        include: { _count: { select: { remarks: true } } },
      }),
      this.pendingByRound(this.prisma, ctx.projectId),
    ]);
    return rounds.map((r) => ({ id: r.id, number: r.number, status: r.status, remarks: r._count.remarks, pending: pending.get(r.id) ?? 0, closedAt: r.closedAt?.toISOString() ?? null }));
  }

  async create(ctx: ProjectContext, number?: number): Promise<RoundSummary> {
    // Номер под блокировкой строки проекта: два «Новых раунда» разом иначе спотыкались об @@unique(projectId, number)
    const round = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${ctx.projectId} FOR UPDATE`;
      const pending = await this.pendingByRound(tx, ctx.projectId);
      if (pending.size) {
        const blocking = await tx.round.findMany({ where: { id: { in: [...pending.keys()] } }, orderBy: { number: 'asc' }, select: { number: true } });
        const total = [...pending.values()].reduce((a, b) => a + b, 0);
        const where = blocking.length > 1 ? `в раундах ${blocking.map((r) => r.number).join(', ')}` : `в раунде ${blocking[0]?.number}`;
        throw new ConflictException(`Новый раунд можно открыть, когда ${where} не останется нерешённых замечаний (ещё ${total})`);
      }
      const last = await tx.round.findFirst({ where: { projectId: ctx.projectId }, orderBy: { number: 'desc' } });
      const created = await tx.round.create({ data: { projectId: ctx.projectId, number: number ?? (last ? last.number + 1 : 1) } });
      await roundEvent(tx, ctx, created.id, 'open');
      return created;
    });
    return { id: round.id, number: round.number, status: round.status, remarks: 0, pending: 0, closedAt: null };
  }

  /** Закрыть раунд: заказчик или руководитель приёмки, и только когда всё решено. Повтор по закрытому — тот же ответ. */
  async close(ctx: ProjectContext, roundId: string): Promise<RoundSummary> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const round = await this.load(ctx, roundId);
    if (round.status === 'closed') return this.summary(round.id);
    const pending = await this.prisma.remark.groupBy({
      by: ['status'],
      where: { roundId: round.id, status: { notIn: [...TERMINAL_STATUSES] } },
      _count: { _all: true },
    });
    if (pending.length) {
      const parts = pending.map((p) => `${STATUS_LABEL_RU[p.status as RemarkStatus]} — ${p._count._all}`).join(', ');
      throw new ConflictException(`Раунд нельзя закрыть: ещё не решено (${parts})`);
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.round.updateMany({ where: { id: round.id, status: 'open' }, data: { status: 'closed', closedAt: new Date(), closedByUserId: ctx.userId } });
      if (count === 0) throw new ConflictException('Раунд уже закрыт');
      await roundEvent(tx, ctx, round.id, 'close');
    });
    return this.summary(round.id);
  }

  async reopen(ctx: ProjectContext, roundId: string): Promise<RoundSummary> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const round = await this.load(ctx, roundId);
    // closedAt/closedBy у раунда обнуляются, но в событиях раунда прежнее закрытие остаётся (ADR 011)
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.round.updateMany({ where: { id: round.id, status: 'closed' }, data: { status: 'open', closedAt: null, closedByUserId: null } });
      if (count === 1) await roundEvent(tx, ctx, round.id, 'reopen');
    });
    return this.summary(round.id);
  }

  /**
   * Журнал приёмки в xlsx (ADR 011): «Раунды», «Замечания», «История» — весь проект или один раунд. Кто и когда —
   * из строк истории (имя снимком на момент действия), для старых замечаний без истории — из полей карточки.
   * Видимость — те же правила, что у карточки и истории (ADR 007): заказчику без комментариев команды и предложений
   * модели. Шесть запросов плюс люди — на проект любого размера.
   */
  async exportJournal(ctx: ProjectContext, roundId?: string): Promise<{ fileName: string; data: Buffer }> {
    const one = roundId ? await this.load(ctx, roundId) : null;
    const { projectId } = ctx;
    const scope = one ? { roundId: one.id } : {};
    const customer = audienceFor(ctx.role) === 'customer';
    const [project, rounds, counts, remarks, history, roundEvents] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, slug: true } }),
      this.prisma.round.findMany({ where: { projectId, ...(one ? { id: one.id } : {}) }, orderBy: { number: 'asc' } }),
      this.prisma.remark.groupBy({ by: ['roundId', 'status'], where: { projectId, ...scope }, _count: { _all: true } }),
      this.prisma.remark.findMany({
        where: { projectId, ...scope },
        select: {
          id: true,
          number: true,
          externalId: true,
          pageOrScreen: true,
          description: true,
          expected: true,
          severity: true,
          status: true,
          authorId: true,
          createdAt: true,
          fixedByUserId: true,
          closedByUserId: true,
          closedAt: true,
          retestOutcome: true,
          retestExplanation: true,
          round: { select: { number: true } },
          verdicts: { orderBy: { createdAt: 'desc' }, take: 1, select: { code: true, userId: true, comment: true, createdAt: true } },
          citations: { select: { section: true, documentKind: true, quoteText: true } },
          origin: { select: { number: true, round: { select: { number: true } } } },
          reopenedBy: { orderBy: { createdAt: 'desc' }, take: 1, select: { number: true, round: { select: { number: true } } } },
          screenshots: { where: { kind: 'diff', supersededAt: null }, select: { id: true } },
        },
      }),
      this.prisma.remarkStatusChange.findMany({
        where: { remark: { projectId, ...scope } },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { name: true } }, remark: { select: { number: true, round: { select: { number: true } } } } },
      }),
      this.prisma.roundEvent.findMany({ where: { projectId, ...scope }, orderBy: { createdAt: 'asc' }, include: { round: { select: { number: true } } } }),
    ]);

    // Люди без строки истории (замечания до ADR 011): живое имя и нынешняя роль в проекте
    const userIds = [...new Set([...remarks.flatMap((r) => [r.authorId, r.fixedByUserId, r.closedByUserId, r.verdicts[0]?.userId]), ...rounds.map((r) => r.closedByUserId)].filter((id): id is string => Boolean(id)))];
    const [users, memberships] = userIds.length
      ? await Promise.all([
          this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
          this.prisma.membership.findMany({ where: { projectId, userId: { in: userIds } }, select: { userId: true, role: true } }),
        ])
      : [[], []];
    const names = new Map(users.map((u) => [u.id, u.name]));
    const roles = new Map(memberships.map((m) => [m.userId, m.role]));
    const live = (userId: string | null | undefined): JournalPerson | null => (userId && names.has(userId) ? { name: names.get(userId)!, role: roles.get(userId) ?? null } : null);
    const snapshot = (h: { actorName: string | null; role: Role | null; user?: { name: string } | null }): JournalPerson | null => {
      const name = h.actorName ?? h.user?.name;
      return name ? { name, role: h.role } : null;
    };

    const byRemark = new Map<string, typeof history>();
    for (const h of history) byRemark.set(h.remarkId, [...(byRemark.get(h.remarkId) ?? []), h]);
    const last = (rows: typeof history, actions: string[]) => [...rows].reverse().find((h) => actions.includes(h.action));
    const first = (rows: typeof history, actions: string[]) => rows.find((h) => actions.includes(h.action));
    const origin = config().WEB_ORIGIN;

    const journalRemarks: JournalRemark[] = remarks.map((r) => {
      const rows = byRemark.get(r.id) ?? [];
      const created = first(rows, ['create', 'import', 'reopen']);
      const verdictRow = last(rows, ['verdict']);
      const fixedRow = last(rows, ['ready_for_retest']);
      const closeRow = r.status === 'closed' ? last(rows, ['close']) : undefined;
      const verdict = r.verdicts[0];
      const closedVia = closeRow ? (closedViaOf(closeRow.fromStatus) ?? null) : null;
      return {
        roundNumber: r.round.number,
        number: r.number,
        externalId: r.externalId,
        pageOrScreen: r.pageOrScreen,
        description: r.description,
        expected: r.expected,
        severity: r.severity,
        status: r.status,
        author: (created && snapshot(created)) ?? live(r.authorId),
        createdAt: r.createdAt,
        verdict: verdict
          ? { code: verdict.code, by: (verdictRow && snapshot(verdictRow)) ?? live(verdict.userId), at: verdict.createdAt, comment: customer ? null : verdict.comment }
          : null,
        citations: r.citations.flatMap((c) => (c.quoteText ? [`${documentLabel(c.documentKind)}${c.section ? ` (${c.section})` : ''}: ${quote(c.quoteText)}`] : [])),
        fixedBy: (fixedRow && snapshot(fixedRow)) ?? live(r.fixedByUserId),
        fixedAt: fixedRow?.createdAt ?? null,
        closedBy: r.status === 'closed' ? ((closeRow && snapshot(closeRow)) ?? live(r.closedByUserId)) : null,
        closedAt: r.status === 'closed' ? (closeRow?.createdAt ?? r.closedAt) : null,
        closedVia,
        closedWithDiff: closedVia === 'retest' && r.screenshots.length > 0,
        closeComment: closeRow?.comment ?? null,
        retest: r.retestOutcome ? { outcome: r.retestOutcome, explanation: r.retestExplanation } : null,
        origin: r.origin ? { number: r.origin.number, roundNumber: r.origin.round.number } : null,
        reopenedBy: r.reopenedBy[0] ? { number: r.reopenedBy[0].number, roundNumber: r.reopenedBy[0].round.number } : null,
        cardUrl: `${origin}/${project.slug}/round-${r.round.number}/${r.number}`,
      };
    });

    const countOf = (roundId: string, statuses?: RemarkStatus[]) =>
      counts.filter((c) => c.roundId === roundId && (!statuses || statuses.includes(c.status))).reduce((sum, c) => sum + c._count._all, 0);
    const journalRounds: JournalRound[] = rounds.map((r) => {
      const closeEvent = [...roundEvents].reverse().find((e) => e.roundId === r.id && e.action === 'close');
      const closed = r.status === 'closed';
      return {
        number: r.number,
        openedAt: r.createdAt,
        closedAt: closed ? r.closedAt : null,
        closedBy: closed ? ((closeEvent && snapshot(closeEvent)) ?? live(r.closedByUserId)) : null,
        total: countOf(r.id),
        closed: countOf(r.id, ['closed']),
        changeRequests: countOf(r.id, ['change_request']),
        duplicates: countOf(r.id, ['duplicate']),
        pending: countOf(r.id) - countOf(r.id, [...TERMINAL_STATUSES]),
      };
    });

    const events: JournalEvent[] = [
      ...history.map((h) => ({
        roundNumber: h.remark.round.number,
        number: h.remark.number,
        at: h.createdAt,
        by: snapshot(h),
        action: h.action,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        comment: historyVisibility(h, audienceFor(ctx.role)).comment ?? null,
        detail: historyVisibility(h, audienceFor(ctx.role)).detail ?? null,
      })),
      ...roundEvents.map((e) => ({ roundNumber: e.round.number, number: null, at: e.createdAt, by: snapshot(e), action: e.action, fromStatus: null, toStatus: null, comment: null, detail: null })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    const data = await buildJournalXlsx({ projectName: project.name, timeZone: config().REPORT_TIMEZONE, rounds: journalRounds, remarks: journalRemarks, events });
    const fileName = one ? `remarkround-${project.slug}-round-${one.number}.xlsx` : `remarkround-${project.slug}-journal.xlsx`;
    return { fileName, data };
  }

  private async load(ctx: ProjectContext, roundId: string) {
    const round = await this.prisma.round.findFirst({ where: { id: roundId, projectId: ctx.projectId } });
    if (!round) throw new NotFoundException();
    return round;
  }

  private async summary(roundId: string): Promise<RoundSummary> {
    const r = await this.prisma.round.findUniqueOrThrow({ where: { id: roundId }, include: { _count: { select: { remarks: true } } } });
    const pending = await this.prisma.remark.count({ where: { roundId, status: { notIn: [...TERMINAL_STATUSES] } } });
    return { id: r.id, number: r.number, status: r.status, remarks: r._count.remarks, pending, closedAt: r.closedAt?.toISOString() ?? null };
  }

  /** roundId → число нерешённых замечаний; раунды, где всё решено, в карту не попадают. */
  private async pendingByRound(db: Pick<PrismaService, 'remark'>, projectId: string): Promise<Map<string, number>> {
    const rows = await db.remark.groupBy({
      by: ['roundId'],
      where: { projectId, status: { notIn: [...TERMINAL_STATUSES] } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.roundId, r._count._all]));
  }
}

/** Событие раунда (ADR 011): только дописывается, имя — снимком на момент действия, как в истории замечания. */
async function roundEvent(tx: Prisma.TransactionClient, ctx: ProjectContext, roundId: string, action: 'open' | 'close' | 'reopen'): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  await tx.roundEvent.create({ data: { roundId, projectId: ctx.projectId, action, userId: ctx.userId, actorName: user?.name ?? null, role: ctx.role } });
}

function documentLabel(kind: DocumentKind | null): string {
  return kind === 'protocol' ? 'Протокол' : kind === 'addendum' ? 'Доп. соглашение' : 'ТЗ';
}
