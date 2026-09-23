import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Prisma, RemarkStatusChange } from '@remarkround/db';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { audience, rolesFor } from './audience';
import { NOTIFICATION_SELECT, toNotificationView, type NotificationView } from './notification.view';
import { UserEvents } from './user-events';

/** Толчок по сокету после коммита: задача очереди видна воркеру только когда транзакция решения закоммичена. */
export const NOTIFY_PUSH = 'notify_push';

export const NOTIFY_PAGE_DEFAULT = 30;
export const NOTIFY_PAGE_MAX = 50;

/** Строка истории, которую только что записал RemarksService.writeHistory. */
export type ChangeRow = Pick<RemarkStatusChange, 'id' | 'remarkId' | 'action' | 'fromStatus' | 'toStatus' | 'userId'>;

export interface NotificationPage {
  items: NotificationView[];
  unread: number;
  hasMore: boolean;
}

/** Что прочитать: ровно одно из трёх (проверяет контроллер). */
export interface ReadSelector {
  ids?: string[];
  remarkId?: string;
  all?: true;
}

/**
 * Уведомления о замечаниях (ADR 016). Пишутся одной точкой — из `RemarksService.writeHistory`, в той же транзакции,
 * что строка истории; читаются только свои и только в текущей роли человека в проекте (фильтр в SQL). Сокет — толчок
 * через задачу `notify_push`: правда остаётся в таблице, клиент сверяется по REST. Модуль не знает доменных модулей.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly events: UserEvents,
  ) {}

  onModuleInit(): void {
    // Толчок дешёвый, но не должен занимать слоты воркера, пока импорт на 200 строк раздаёт предложения
    this.jobs.register(NOTIFY_PUSH, (payload) => this.push(payload), { maxConcurrent: 2 });
  }

  /**
   * Разослать событие истории (ADR 016). Под SAVEPOINT: ошибка здесь откатывается до точки сохранения, а решение
   * человека и строка истории остаются в транзакции — уведомление не может стоить записи.
   */
  async record(tx: Prisma.TransactionClient, change: ChangeRow): Promise<void> {
    await tx.$executeRaw`SAVEPOINT rr_notify`;
    try {
      await this.fanOut(tx, change);
      await tx.$executeRaw`RELEASE SAVEPOINT rr_notify`;
    } catch (e) {
      // Postgres после ошибки не примет ни одного запроса до отката к точке. Если не удался и откат — транзакция
      // уже неисправна, бросок уронит её целиком, как уронила бы и без уведомлений
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT rr_notify`;
      await tx.$executeRaw`RELEASE SAVEPOINT rr_notify`;
      this.log.warn({ msg: `notifications: событие ${change.action} замечания ${change.remarkId} не разослано — ${(e as Error).message}`, changeId: change.id });
    }
  }

  /** Получатели одним запросом, строки — одним INSERT; «действовать = прочитать» гасит непрочитанные автора по замечанию. */
  private async fanOut(tx: Prisma.TransactionClient, change: ChangeRow): Promise<void> {
    const actor = change.userId;
    let touched = 0;
    if (actor && change.fromStatus !== null) {
      touched = (await tx.notification.updateMany({ where: { userId: actor, remarkId: change.remarkId, readAt: null }, data: { readAt: new Date() } })).count;
    }
    const roles = rolesFor(audience(change.action, change.fromStatus, change.toStatus));
    let created = 0;
    if (roles.length) {
      const recipients = await tx.membership.findMany({
        where: {
          project: { remarks: { some: { id: change.remarkId } } },
          role: { in: roles },
          user: { disabledAt: null },
          ...(actor ? { userId: { not: actor } } : {}),
        },
        select: { userId: true, projectId: true, role: true },
      });
      if (recipients.length) {
        const rows = recipients.map((r) => ({ userId: r.userId, projectId: r.projectId, remarkId: change.remarkId, changeId: change.id, role: r.role }));
        created = (await tx.notification.createMany({ data: rows, skipDuplicates: true })).count;
      }
    }
    if (!created && !touched) return;
    const remark = await tx.remark.findUniqueOrThrow({ where: { id: change.remarkId }, select: { projectId: true } });
    await this.jobs.enqueue(NOTIFY_PUSH, { changeId: change.id }, { tx, projectId: remark.projectId });
  }

  /**
   * Задача `notify_push`: адресатам — их новые строки и счётчик, автору — «прочитано по замечанию». Идемпотентна:
   * повтор после рестарта даёт тот же толчок, клиент сливает по id. Замечание удалили — строк нет, толкать нечего.
   */
  private async push(payload: unknown): Promise<void> {
    const changeId = typeof (payload as { changeId?: unknown } | null)?.changeId === 'string' ? (payload as { changeId: string }).changeId : null;
    if (!changeId) return;
    const change = await this.prisma.remarkStatusChange.findUnique({ where: { id: changeId }, select: { remarkId: true, userId: true, fromStatus: true } });
    if (!change) return;
    const rows = await this.prisma.notification.findMany({ where: { changeId }, select: NOTIFICATION_SELECT });
    // Роль могла смениться между событием и толчком: строка чужой роли не видна и в списке
    const current = rows.length
      ? await this.prisma.membership.findMany({ where: { OR: rows.map((r) => ({ userId: r.userId, projectId: r.projectId })) }, select: { userId: true, projectId: true, role: true } })
      : [];
    const roleOf = new Map(current.map((m) => [`${m.userId}:${m.projectId}`, m.role]));
    for (const row of rows) {
      if (roleOf.get(`${row.userId}:${row.projectId}`) !== row.role) continue;
      this.events.emit(row.userId, { type: 'notification.new', items: [toNotificationView(row)], unread: await this.unread(row.userId) });
    }
    if (change.userId && change.fromStatus !== null) {
      this.events.emit(change.userId, { type: 'notification.read', remarkId: change.remarkId, unread: await this.unread(change.userId) });
    }
  }

  // ---------- чтение ----------

  async list(userId: string, opts: { limit?: number; before?: string } = {}): Promise<NotificationPage> {
    const scope = await this.scope(userId);
    if (!scope) return { items: [], unread: 0, hasMore: false };
    const limit = Math.min(Math.max(opts.limit ?? NOTIFY_PAGE_DEFAULT, 1), NOTIFY_PAGE_MAX);
    let cursor: Prisma.NotificationWhereInput = {};
    if (opts.before) {
      const b = await this.prisma.notification.findFirst({ where: { id: opts.before, userId }, select: { id: true, createdAt: true } });
      // Курсор исчез (замечание удалили) или чужой — дальше страниц нет
      if (!b) return { items: [], unread: await this.unread(userId), hasMore: false };
      cursor = { OR: [{ createdAt: { lt: b.createdAt } }, { createdAt: b.createdAt, id: { lt: b.id } }] };
    }
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { AND: [{ userId }, scope, cursor] },
        select: NOTIFICATION_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      this.countUnread(userId, scope),
    ]);
    return { items: rows.slice(0, limit).map(toNotificationView), unread, hasMore: rows.length > limit };
  }

  async unread(userId: string): Promise<number> {
    const scope = await this.scope(userId);
    return scope ? this.countUnread(userId, scope) : 0;
  }

  /** Прочитать свои строки: по id, по замечанию или все; чужие id не трогаются. Остальным вкладкам — `notification.read`. */
  async markRead(userId: string, sel: ReadSelector): Promise<{ unread: number }> {
    const which: Prisma.NotificationWhereInput = sel.ids ? { id: { in: sel.ids } } : sel.remarkId ? { remarkId: sel.remarkId } : {};
    await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...which }, data: { readAt: new Date() } });
    const unread = await this.unread(userId);
    this.events.emit(userId, { type: 'notification.read', unread, ...(sel.ids ? { ids: sel.ids } : sel.remarkId ? { remarkId: sel.remarkId } : { all: true as const }) });
    return { unread };
  }

  private countUnread(userId: string, scope: Prisma.NotificationWhereInput): Promise<number> {
    return this.prisma.notification.count({ where: { AND: [{ userId, readAt: null }, scope] } });
  }

  /**
   * Видимые строки — только проектов, где человек сейчас участник, и только его текущей роли: убрали из проекта или
   * сменили роль — старое пропадает (фильтр в SQL, не в UI). Нет проектов — нет и строк.
   */
  private async scope(userId: string): Promise<Prisma.NotificationWhereInput | null> {
    const memberships = await this.prisma.membership.findMany({ where: { userId }, select: { projectId: true, role: true } });
    return memberships.length ? { OR: memberships.map((m) => ({ projectId: m.projectId, role: m.role })) } : null;
  }
}
