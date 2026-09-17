import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import type { Invitation, Role } from '@remarkround/db';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config';
import { MailService } from '../mail/mail.service';
import { instanceInvitationMail, invitationMail, memberAddedMail } from '../mail/templates';
import { securityEvent } from '../observability/security-log';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from './project-context';

/** Сколько дней живёт ссылка приглашения (ADR 006: неделя — PM пересоздаёт ссылку кнопкой). */
export const INVITE_EXPIRES_DAYS = 7;

export interface InvitationSummary {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string | null;
}

/** Сырой токен отдаётся один раз: при создании и по «Новая ссылка». В БД — только sha256. */
export interface InvitationLink {
  /** Ссылку `${origin}/join/${token}` собирает фронт: API не знает публичного адреса SPA. */
  token: string;
  expiresAt: string;
}

/** «Новая ссылка»: новый токен и признак, что письмо с ним ушло (I-2). */
export type InvitationRelink = InvitationLink & {
  emailed: boolean;
};

export type InvitationCreated = InvitationSummary & InvitationLink & {
  /** Письмо со ссылкой ушло приглашённому (ADR 009): без SMTP — false, ссылку шлёт PM сам. */
  emailed: boolean;
};

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
 * Приглашения (ADR 005, ADR 006). Со SMTP письмо со ссылкой уходит само (ADR 009), без него PM копирует ссылку
 * и отправляет сам — в любом случае ссылка показывается один раз. Приглашение принимается
 * ТОЛЬКО по ссылке — регистрацией с inviteToken или вошедшим пользователем. Совпадение e-mail без ссылки
 * ничего не даёт: иначе место в чужом проекте забирал бы тот, кто первым зарегистрировал угаданный адрес.
 * Membership создаётся только здесь и в MembersService — единственные пути записи участников.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

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
    const emailed = await this.sendLink(row, ctx.userId, token, expiresAt);
    return { ...summary(row), token, expiresAt: expiresAt.toISOString(), emailed };
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
    const emailed = await this.sendLink(row, actorUserId, token, expiresAt);
    return { ...summary(row), token, expiresAt: expiresAt.toISOString(), emailed };
  }

  /** Ожидающие приглашения руководителей (без проекта) — для страницы администрирования. */
  async listInstance(): Promise<InvitationSummary[]> {
    const rows = await this.prisma.invitation.findMany({ where: { projectId: null, acceptedAt: null }, orderBy: { createdAt: 'asc' } });
    return rows.map(summary);
  }

  async revokeInstance(actorUserId: string, invitationId: string): Promise<void> {
    const row = await this.prisma.invitation.findFirst({ where: { id: invitationId, projectId: null } });
    if (!row) throw new NotFoundException();
    await this.prisma.invitation.delete({ where: { id: row.id } });
    securityEvent('invitation.revoke', { projectId: null, by: actorUserId, invitationId: row.id, email: row.email });
  }

  /** «Новая ссылка» для приглашения руководителя: то же, что regenerateLink, но без проекта. */
  async regenerateInstanceLink(actorUserId: string, invitationId: string): Promise<InvitationRelink> {
    const row = await this.prisma.invitation.findFirst({ where: { id: invitationId, projectId: null, acceptedAt: null } });
    if (!row) throw new NotFoundException();
    return this.reissue(row, actorUserId);
  }

  /**
   * Письмо со ссылкой (ADR 009): текст — без e-mail других участников, только проект, роль и кто зовёт;
   * без проекта — письмо «вас приглашают руководителем приёмки».
   */
  private async sendLink(row: Pick<Invitation, 'projectId' | 'email' | 'role'>, byUserId: string, token: string, expiresAt: Date): Promise<boolean> {
    if (!this.mail.enabled) return false;
    const [project, inviter] = await Promise.all([
      row.projectId ? this.prisma.project.findUnique({ where: { id: row.projectId }, select: { name: true } }) : Promise.resolve(null),
      this.prisma.user.findUnique({ where: { id: byUserId }, select: { name: true } }),
    ]);
    const url = `${config().WEB_ORIGIN}/join/${token}`;
    const inviterName = inviter?.name ?? '';
    const message = row.projectId
      ? invitationMail({ to: row.email, projectName: project?.name ?? '', role: row.role, inviterName, url, expiresAt })
      : instanceInvitationMail({ to: row.email, inviterName, url, expiresAt });
    return this.mail.enqueue(message, row.projectId ?? undefined);
  }

  /** Новая ссылка для ожидающего приглашения: прежняя перестаёт работать, срок продлевается, письмо уходит снова (I-2). */
  async regenerateLink(ctx: ProjectContext, invitationId: string): Promise<InvitationRelink> {
    const row = await this.prisma.invitation.findFirst({ where: { id: invitationId, projectId: ctx.projectId, acceptedAt: null } });
    if (!row) throw new NotFoundException();
    return this.reissue(row, ctx.userId);
  }

  private async reissue(row: Invitation, byUserId: string): Promise<InvitationRelink> {
    const token = newToken();
    const expiresAt = expiry();
    await this.prisma.invitation.update({ where: { id: row.id }, data: { tokenHash: hashToken(token), expiresAt, invitedById: byUserId } });
    securityEvent('invitation.link', { projectId: row.projectId, by: byUserId, invitationId: row.id });
    const emailed = await this.sendLink(row, byUserId, token, expiresAt);
    return { token, expiresAt: expiresAt.toISOString(), emailed };
  }

  /** Зарегистрированного добавили напрямую (ADR 006): письмо «вы в проекте» со ссылкой на проект, без токенов (I-3). */
  async notifyAdded(ctx: ProjectContext, to: { email: string; name: string }, role: Role): Promise<boolean> {
    if (!this.mail.enabled) return false;
    const [project, inviter] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: ctx.projectId }, select: { name: true, slug: true } }),
      this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }),
    ]);
    if (!project) return false;
    const url = `${config().WEB_ORIGIN}/${project.slug}`;
    return this.mail.enqueue(memberAddedMail({ to: to.email, name: to.name, projectName: project.name, role, inviterName: inviter?.name ?? '', url }), ctx.projectId);
  }

  async listPending(projectId: string): Promise<InvitationSummary[]> {
    const rows = await this.prisma.invitation.findMany({ where: { projectId, acceptedAt: null }, orderBy: { createdAt: 'asc' } });
    return rows.map(summary);
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

function summary(row: Invitation): InvitationSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}
