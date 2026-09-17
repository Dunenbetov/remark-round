import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import type { Invitation, Role } from '@remarkround/db';
import { createHash, randomBytes } from 'node:crypto';
import { securityEvent } from '../observability/security-log';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from './project-context';

/** Сколько дней живёт ссылка приглашения (ADR 006: неделя — PM пересоздаёт ссылку кнопкой). */
export const INVITE_EXPIRES_DAYS = 7;

export interface InvitationSummary {
  id: string;
  email: string;
  role: Role;
  /**
   * Имя аккаунта, зарегистрированного на этот e-mail; null — такого нет (ADR 013). Адрес при регистрации не подтверждается:
   * PM по имени видит, кому на самом деле уйдёт приглашение в колокольчик, и отзывает, если это не тот человек.
   */
  inviteeName: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/** Сырой токен отдаётся один раз: при создании и по «Новая ссылка». В БД — только sha256. */
export interface InvitationLink {
  /** Ссылку `${origin}/join/${token}` собирает фронт: API не знает публичного адреса SPA. */
  token: string;
  expiresAt: string;
}

export type InvitationCreated = InvitationSummary & InvitationLink;

/** Приглашение в колокольчике вошедшего (ADR 013): куда, с какой ролью и кто зовёт. Токена нет — принимается по id. */
export interface InboxInvitation {
  id: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  role: Role;
  inviterName: string;
  createdAt: string;
  expiresAt: string | null;
}

/** Что видно по ссылке до входа: ровно столько, чтобы человек понял, куда его зовут. E-mail приглашённого не показываем. */
export interface InvitationPeek {
  /** `project` — в проект с ролью; `instance` — руководителем приёмки от администратора (право создавать проекты). */
  kind: 'project' | 'instance';
  projectName: string | null;
  role: Role;
  inviterName: string;
  expiresAt: string | null;
}

/**
 * Приглашения (ADR 005, ADR 006, ADR 013). Писем нет: ссылку PM копирует и отправляет сам (показывается один раз).
 * Принимается двумя путями: по ссылке — регистрацией с inviteToken или вошедшим пользователем (так приходят
 * незарегистрированные); из колокольчика — вошедшим, чей e-mail совпал с адресом приглашения (ADR 013).
 * Адрес при регистрации не подтверждается, поэтому в сводке приглашения PM видит `inviteeName` — имя аккаунта на этот адрес.
 * Membership создаётся только здесь и в MembersService — единственные пути записи участников.
 */
@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Одно приглашение на e-mail в проекте: повтор меняет роль и выпускает новую ссылку (старая перестаёт работать). */
  async create(ctx: ProjectContext, email: string, role: Role): Promise<InvitationCreated> {
    const normalized = normalizeEmail(email);
    const token = newToken();
    const expiresAt = expiry();
    const existing = await this.prisma.invitation.findUnique({ where: { projectId_email: { projectId: ctx.projectId, email: normalized } } });
    const row = existing
      ? await this.prisma.invitation.update({
          where: { id: existing.id },
          data: { role, expiresAt, tokenHash: hashToken(token), acceptedAt: null, acceptedByUserId: null, invitedById: ctx.userId },
        })
      : await this.prisma.invitation.create({
          data: { projectId: ctx.projectId, email: normalized, role, tokenHash: hashToken(token), invitedById: ctx.userId, expiresAt },
        });
    securityEvent('invitation.create', { projectId: ctx.projectId, by: ctx.userId, email: normalized, role, invitationId: row.id });
    const [withName] = await this.withInviteeNames([row]);
    return { ...withName!, token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Приглашение руководителя приёмки без проекта (ADR 006, дополнение 17.09): только администратор инстанса.
   * Принятие выдаёт canCreateProjects; одна строка на e-mail — повтор выпускает новую ссылку.
   */
  async createInstance(actorUserId: string, email: string): Promise<InvitationCreated> {
    const normalized = normalizeEmail(email);
    const token = newToken();
    const expiresAt = expiry();
    const existing = await this.prisma.invitation.findFirst({ where: { projectId: null, email: normalized } });
    const data = { role: 'pm' as Role, expiresAt, tokenHash: hashToken(token), acceptedAt: null, acceptedByUserId: null, invitedById: actorUserId };
    const row = existing
      ? await this.prisma.invitation.update({ where: { id: existing.id }, data })
      : await this.prisma.invitation.create({ data: { ...data, projectId: null, email: normalized } });
    securityEvent('invitation.create', { projectId: null, by: actorUserId, email: normalized, role: 'pm', invitationId: row.id });
    const [withName] = await this.withInviteeNames([row]);
    return { ...withName!, token, expiresAt: expiresAt.toISOString() };
  }

  /** Ожидающие приглашения руководителей (без проекта) — для страницы администрирования. */
  async listInstance(): Promise<InvitationSummary[]> {
    const rows = await this.prisma.invitation.findMany({ where: { projectId: null, acceptedAt: null }, orderBy: { createdAt: 'asc' } });
    return this.withInviteeNames(rows);
  }

  async revokeInstance(actorUserId: string, invitationId: string): Promise<void> {
    const row = await this.prisma.invitation.findFirst({ where: { id: invitationId, projectId: null } });
    if (!row) throw new NotFoundException();
    await this.prisma.invitation.delete({ where: { id: row.id } });
    securityEvent('invitation.revoke', { projectId: null, by: actorUserId, invitationId: row.id, email: row.email });
  }

  /** «Новая ссылка» для приглашения руководителя: то же, что regenerateLink, но без проекта. */
  async regenerateInstanceLink(actorUserId: string, invitationId: string): Promise<InvitationLink> {
    const row = await this.prisma.invitation.findFirst({ where: { id: invitationId, projectId: null, acceptedAt: null } });
    if (!row) throw new NotFoundException();
    return this.reissue(row, actorUserId);
  }

  /** Новая ссылка для ожидающего приглашения: прежняя перестаёт работать, срок продлевается. */
  async regenerateLink(ctx: ProjectContext, invitationId: string): Promise<InvitationLink> {
    const row = await this.prisma.invitation.findFirst({ where: { id: invitationId, projectId: ctx.projectId, acceptedAt: null } });
    if (!row) throw new NotFoundException();
    return this.reissue(row, ctx.userId);
  }

  private async reissue(row: Invitation, byUserId: string): Promise<InvitationLink> {
    const token = newToken();
    const expiresAt = expiry();
    await this.prisma.invitation.update({ where: { id: row.id }, data: { tokenHash: hashToken(token), expiresAt, invitedById: byUserId } });
    securityEvent('invitation.link', { projectId: row.projectId, by: byUserId, invitationId: row.id });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async listPending(projectId: string): Promise<InvitationSummary[]> {
    const rows = await this.prisma.invitation.findMany({ where: { projectId, acceptedAt: null }, orderBy: { createdAt: 'asc' } });
    return this.withInviteeNames(rows);
  }

  /**
   * Колокольчик (ADR 013): живые приглашения в проекты на e-mail вошедшего, старые сверху. Приглашения руководителя
   * без проекта сюда не попадают: зарегистрированному администратор выдаёт право сразу (AdminService.invite).
   */
  async listInbox(email: string): Promise<InboxInvitation[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { email: normalizeEmail(email), projectId: { not: null }, acceptedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { project: { select: { name: true, slug: true } }, invitedBy: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId!,
      projectName: r.project?.name ?? '',
      projectSlug: r.project?.slug ?? '',
      role: r.role,
      inviterName: r.invitedBy.name,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
    }));
  }

  /** Принять из колокольчика: та же атомарная транзакция, что и по ссылке — вторая вкладка получит 410. */
  async acceptFromInbox(user: { id: string; email: string }, invitationId: string): Promise<void> {
    const row = await this.addressedTo(user.email, invitationId);
    await this.accept(row, user.id);
    securityEvent('invitation.accept', { projectId: row.projectId, userId: user.id, role: row.role, invitationId: row.id, invitedEmail: row.email, via: 'inbox' });
  }

  /** Отклонить: строка удаляется — PM видит, что ждать некого, и может позвать снова. */
  async declineFromInbox(user: { id: string; email: string }, invitationId: string): Promise<void> {
    const row = await this.addressedTo(user.email, invitationId);
    // Условно, как accept: приглашение, принятое в соседней вкладке, не исчезает из истории
    const { count } = await this.prisma.invitation.deleteMany({ where: { id: row.id, acceptedAt: null } });
    if (count !== 1) throw new GoneException('Приглашение уже принято');
    securityEvent('invitation.decline', { projectId: row.projectId, userId: user.id, role: row.role, invitationId: row.id, invitedEmail: row.email });
  }

  /** Чужое, без проекта, неизвестное или истёкшее — 404 (не 403: наличие чужих приглашений не раскрываем); принятое — 410. */
  private async addressedTo(email: string, invitationId: string): Promise<Invitation> {
    const row = await this.prisma.invitation.findFirst({ where: { id: invitationId, email: normalizeEmail(email), projectId: { not: null } } });
    if (!row) throw new NotFoundException();
    if (row.acceptedAt) throw new GoneException('Приглашение уже принято');
    if (row.expiresAt && row.expiresAt < new Date()) throw new NotFoundException();
    return row;
  }

  /** Имена аккаунтов на адреса приглашений — одним запросом на всю страницу, без N+1. */
  private async withInviteeNames(rows: Invitation[]): Promise<InvitationSummary[]> {
    const emails = [...new Set(rows.map((r) => r.email))];
    const users = emails.length ? await this.prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.email, u.name]));
    return rows.map((r) => summary(r, names.get(r.email) ?? null));
  }

  /** Отозвать: чужое приглашение выглядит как 404, не как 403. */
  async revoke(ctx: ProjectContext, invitationId: string): Promise<void> {
    const row = await this.prisma.invitation.findFirst({ where: { id: invitationId, projectId: ctx.projectId } });
    if (!row) throw new NotFoundException();
    await this.prisma.invitation.delete({ where: { id: row.id } });
    securityEvent('invitation.revoke', { projectId: ctx.projectId, by: ctx.userId, invitationId: row.id, email: row.email });
  }

  /** По ссылке до входа. Принятое — 410 (ссылка уже сработала), неизвестное или истёкшее — 404. */
  async peek(token: string): Promise<InvitationPeek> {
    const row = await this.usable(token);
    const [project, inviter] = await Promise.all([
      row.projectId ? this.prisma.project.findUnique({ where: { id: row.projectId } }) : Promise.resolve(null),
      this.prisma.user.findUnique({ where: { id: row.invitedById } }),
    ]);
    return {
      kind: row.projectId ? 'project' : 'instance',
      projectName: project?.name ?? null,
      role: row.role,
      inviterName: inviter?.name ?? '',
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }

  /** Живое ли приглашение — для регистрации по ссылке: проверяется ДО создания пользователя. */
  async assertUsable(token: string): Promise<void> {
    await this.usable(token);
  }

  /** Принятие по ссылке вошедшим пользователем: e-mail может отличаться — ссылку PM отправил адресно. */
  async acceptByToken(userId: string, token: string): Promise<{ projectId: string | null; role: Role }> {
    const row = await this.usable(token);
    await this.accept(row, userId);
    securityEvent('invitation.accept', { projectId: row.projectId, userId, role: row.role, invitationId: row.id, invitedEmail: row.email });
    return { projectId: row.projectId, role: row.role };
  }

  private async usable(token: string): Promise<Invitation> {
    if (!token) throw new NotFoundException();
    const row = await this.prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row) throw new NotFoundException();
    if (row.acceptedAt) throw new GoneException('Приглашение уже принято');
    if (row.expiresAt && row.expiresAt < new Date()) throw new NotFoundException();
    return row;
  }

  private async accept(row: Invitation, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Две вкладки принимают одну ссылку разом (I-4): acceptedAt ставится условно, второй получает 410, а не второе место
      const { count } = await tx.invitation.updateMany({ where: { id: row.id, acceptedAt: null }, data: { acceptedAt: new Date(), acceptedByUserId: userId } });
      if (count !== 1) throw new GoneException('Приглашение уже принято');
      if (!row.projectId) {
        // Приглашение руководителя от администратора: право создавать проекты, membership появится с первым проектом
        await tx.user.update({ where: { id: userId }, data: { canCreateProjects: true } });
        return;
      }
      await tx.membership.upsert({
        where: { userId_projectId: { userId, projectId: row.projectId } },
        create: { userId, projectId: row.projectId, role: row.role, invitedById: row.invitedById },
        // Уже участник: роль, которую дал PM, не трогаем
        update: {},
      });
    });
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** sha256 в hex: то же, что миграция 20260907100000 сделала с прежними сырыми токенами. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 32 символа base64url — тот же формат у ссылок приглашения и сброса пароля (DTO: @Length(20, 80)). */
export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function expiry(): Date {
  return new Date(Date.now() + INVITE_EXPIRES_DAYS * 86_400_000);
}

function summary(row: Invitation, inviteeName: string | null): InvitationSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    inviteeName,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}
