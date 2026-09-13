import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { RemarkStatus } from '@remarkround/db';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { STATUS_LABEL_RU, TERMINAL_STATUSES } from '../remarks/labels';
import { RemarksService } from '../remarks/remarks.service';
import type { ProjectContext } from '../tenancy/project-context';
import { buildRoundXlsx } from './round-export';

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
 * не ждёт (закрыто, новое желание, повтор); иначе 409 с перечнем того, что мешает. Выгрузка — итог раунда
 * для акта, собранный из тех же карточек, что видит человек (фильтр аудитории RemarksService).
 * Новый раунд открывается по тому же правилу: пока в проекте есть нерешённые замечания — 409.
 */
@Injectable()
export class RoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly remarks: RemarksService,
  ) {}

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
      return tx.round.create({ data: { projectId: ctx.projectId, number: number ?? (last ? last.number + 1 : 1) } });
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
    const { count } = await this.prisma.round.updateMany({ where: { id: round.id, status: 'open' }, data: { status: 'closed', closedAt: new Date(), closedByUserId: ctx.userId } });
    if (count === 0) throw new ConflictException('Раунд уже закрыт');
    return this.summary(round.id);
  }

  async reopen(ctx: ProjectContext, roundId: string): Promise<RoundSummary> {
    if (ctx.role !== 'business' && ctx.role !== 'pm') throw new ForbiddenException();
    const round = await this.load(ctx, roundId);
    await this.prisma.round.updateMany({ where: { id: round.id, status: 'closed' }, data: { status: 'open', closedAt: null, closedByUserId: null } });
    return this.summary(round.id);
  }

  /** Итог раунда для заказчика и подрядчика: xlsx из карточек, которые видит читатель. */
  async exportXlsx(ctx: ProjectContext, roundId: string): Promise<{ fileName: string; data: Buffer }> {
    const round = await this.load(ctx, roundId);
    const [project, remarks] = await Promise.all([this.prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } }), this.remarks.list(ctx, round.id)]);
    const data = await buildRoundXlsx({ projectName: project.name, roundNumber: round.number, publicOrigin: config().WEB_ORIGIN, remarks });
    return { fileName: `remarkround-${slug(project.name)}-round-${round.number}.xlsx`, data };
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

function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '');
  return s || 'project';
}
