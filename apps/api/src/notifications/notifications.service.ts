import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { NotificationKind, Prisma, RemarkStatus, Role } from '@remarkround/db';
import { config } from '../config';
import { JobsService, RetryJobError, type JobContext } from '../jobs/jobs.service';
import { MailService } from '../mail/mail.service';
import { digestMail, type DigestItem } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';

/** Какой статус какую роль ждёт (docs/STATUS.md): только переходы, после которых у человека появляется кнопка. */
const WAITING: Partial<Record<RemarkStatus, { kind: NotificationKind; role: Role }>> = {
  awaiting_pm: { kind: 'awaiting_pm', role: 'pm' },
  defect: { kind: 'defect', role: 'developer' },
  ready_for_retest: { kind: 'ready_for_retest', role: 'business' },
  awaiting_business_close: { kind: 'awaiting_business_close', role: 'business' },
  cannot_tell: { kind: 'cannot_tell', role: 'business' },
};

/**
 * «Вас ждёт кнопка» (ADR 009, аудит: no-notifications). RemarksService после каждого перехода зовёт remarkChanged;
 * здесь для каждого участника нужной роли пишется Notification `pending` и ставится (одна на человека) задача
 * `notify_digest` с паузой NOTIFY_DIGEST_MS: всё, что накопилось за эти минуты, уходит одним письмом.
 * Уведомление ничего не решает — решение по-прежнему кнопка человека (REMARKROUND.md §15).
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('notify_digest', (payload, ctx) => this.digest((payload as { userId: string }).userId, ctx));
  }

  /**
   * Переход замечания пишется — в той же транзакции (`tx`), чтобы уведомление и статус либо есть оба, либо нет.
   * actorUserId — кто нажал: ему о собственном действии не пишем (null — писать всем, например бизнесу о готовом
   * ретесте, который он сам и запустил).
   */
  async remarkChanged(tx: Prisma.TransactionClient, projectId: string, remarkId: string, status: RemarkStatus, actorUserId: string | null): Promise<void> {
    const waiting = WAITING[status];
    if (!waiting) return;
    const members = await tx.membership.findMany({
      where: { projectId, role: waiting.role, user: { disabledAt: null }, ...(actorUserId ? { userId: { not: actorUserId } } : {}) },
      select: { userId: true, user: { select: { notifyByEmail: true } } },
    });
    if (!members.length) return;
    // Без SMTP или с выключенными письмами запись всё равно остаётся — как след «кого и когда ждали», без задачи
    const deliverable = this.mail.enabled;
    await tx.notification.createMany({
      data: members.map((m) => ({ userId: m.userId, projectId, remarkId, kind: waiting.kind, status: deliverable && m.user.notifyByEmail ? 'pending' : 'skipped' })),
    });
    if (!deliverable) return;
    for (const m of members) {
      if (!m.user.notifyByEmail) continue;
      await this.scheduleDigest(tx, m.userId, projectId);
    }
  }

  /** Одна ждущая задача на человека: пока она не ушла, новые уведомления просто копятся к ней. */
  private async scheduleDigest(tx: Prisma.TransactionClient, userId: string, projectId: string): Promise<void> {
    const queued = await tx.job.findFirst({ where: { kind: 'notify_digest', status: 'queued', payload: { path: ['userId'], equals: userId } }, select: { id: true } });
    if (queued) return;
    await this.jobs.enqueue('notify_digest', { userId }, { projectId, delayMs: config().NOTIFY_DIGEST_MS, tx });
  }

  /** Задача очереди: всё pending человека → одно письмо. Сбой SMTP — повтор с паузой, после последней попытки — failed. */
  private async digest(userId: string, ctx: JobContext): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, notifyByEmail: true, disabledAt: true } });
    const pending = await this.prisma.notification.findMany({
      where: { userId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      include: { remark: { select: { number: true, description: true, round: { select: { number: true } } } }, project: { select: { name: true, slug: true } } },
    });
    if (!pending.length) return;
    const ids = pending.map((n) => n.id);
    if (!user || user.disabledAt || !user.notifyByEmail || !this.mail.enabled) {
      await this.prisma.notification.updateMany({ where: { id: { in: ids } }, data: { status: 'skipped' } });
      return;
    }
    // Одно замечание могло дождаться человека дважды за окно (например, cannot_tell → снова awaiting_pm): пишем последнее
    const latest = new Map<string, (typeof pending)[number]>();
    for (const n of pending) latest.set(n.remarkId, n);
    const origin = config().WEB_ORIGIN;
    const items: DigestItem[] = [...latest.values()].map((n) => ({
      projectName: n.project.name,
      roundNumber: n.remark.round.number,
      number: n.remark.number,
      description: n.remark.description,
      kind: n.kind,
      url: `${origin}/${n.project.slug}/round-${n.remark.round.number}/${n.remark.number}`,
    }));
    try {
      await this.mail.send(digestMail(user.email, user.name, items, `${origin}/profile`));
    } catch (e) {
      const err = e as Error;
      if (ctx.attempt < ctx.maxAttempts) throw new RetryJobError(`smtp: ${err.message}`);
      this.log.error({ msg: `digest ${userId}: письмо не ушло — ${err.message}`, userId, err: { name: err.name, message: err.message } });
      await this.prisma.notification.updateMany({ where: { id: { in: ids } }, data: { status: 'failed', error: err.message } });
      return;
    }
    await this.prisma.notification.updateMany({ where: { id: { in: ids } }, data: { status: 'sent', sentAt: new Date() } });
  }
}
