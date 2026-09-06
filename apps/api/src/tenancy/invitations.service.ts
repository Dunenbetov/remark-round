import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import type { Invitation, Role } from '@remarkround/db';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from './project-context';

/** Сколько дней живёт ссылка приглашения. */
export const INVITE_EXPIRES_DAYS = 30;

export interface InvitationSummary {
  id: string;
  email: string;
  role: Role;
  /** Ссылку `${origin}/join/${token}` собирает фронт: API не знает публичного адреса SPA. */
  token: string;
  createdAt: string;
  expiresAt: string | null;
}

/** Что видно по ссылке до входа: ровно столько, чтобы человек понял, куда его зовут. */
export interface InvitationPeek {
  projectName: string;
  role: Role;
  email: string;
  inviterName: string;
  expiresAt: string | null;
}

/**
 * Приглашения (ADR 005). Писем нет: PM копирует ссылку и отправляет сам. Приглашение принимается
 * регистрацией или входом с этим e-mail (acceptPendingByEmail) либо по token уже вошедшим пользователем.
 * Membership создаётся только здесь и в MembersService — единственные пути записи участников.
 */
@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Одно приглашение на e-mail в проекте: повтор меняет роль и продлевает срок; принятое ранее (человека удаляли) оживает с новым token. */
  async create(ctx: ProjectContext, email: string, role: Role): Promise<InvitationSummary> {
    const normalized = normalizeEmail(email);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRES_DAYS * 86_400_000);
    const existing = await this.prisma.invitation.findUnique({ where: { projectId_email: { projectId: ctx.projectId, email: normalized } } });
    const row = existing
      ? await this.prisma.invitation.update({
          where: { id: existing.id },
          data: existing.acceptedAt
            ? { role, expiresAt, token: newToken(), acceptedAt: null, acceptedByUserId: null, invitedById: ctx.userId }
            : { role, expiresAt, invitedById: ctx.userId },
        })
      : await this.prisma.invitation.create({
          data: { projectId: ctx.projectId, email: normalized, role, token: newToken(), invitedById: ctx.userId, expiresAt },
        });
    return summary(row);
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
  }

  /** По ссылке до входа. Принятое — 410 (ссылка уже сработала), неизвестное или истёкшее — 404. */
  async peek(token: string): Promise<InvitationPeek> {
    const row = await this.usable(token);
    const [project, inviter] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: row.projectId } }),
      this.prisma.user.findUnique({ where: { id: row.invitedById } }),
    ]);
    return {
      projectName: project?.name ?? '',
      role: row.role,
      email: row.email,
      inviterName: inviter?.name ?? '',
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }

  /** Принятие по ссылке вошедшим пользователем: e-mail может отличаться — ссылку PM отправил адресно. */
  async acceptByToken(userId: string, token: string): Promise<{ projectId: string; role: Role }> {
    const row = await this.usable(token);
    await this.accept(row, userId);
    return { projectId: row.projectId, role: row.role };
  }

  /** Все живые приглашения на e-mail → membership. Зовётся при регистрации, входе и GET /auth/me (опрос страницы ожидания). */
  async acceptPendingByEmail(userId: string, email: string): Promise<number> {
    const rows = await this.prisma.invitation.findMany({ where: { email: normalizeEmail(email), acceptedAt: null } });
    let accepted = 0;
    for (const row of rows) {
      if (row.expiresAt && row.expiresAt < new Date()) continue;
      await this.accept(row, userId);
      accepted += 1;
    }
    return accepted;
  }

  private async usable(token: string): Promise<Invitation> {
    const row = await this.prisma.invitation.findUnique({ where: { token } });
    if (!row) throw new NotFoundException();
    if (row.acceptedAt) throw new GoneException('Приглашение уже принято');
    if (row.expiresAt && row.expiresAt < new Date()) throw new NotFoundException();
    return row;
  }

  private async accept(row: Invitation, userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.membership.upsert({
        where: { userId_projectId: { userId, projectId: row.projectId } },
        create: { userId, projectId: row.projectId, role: row.role, invitedById: row.invitedById },
        // Уже участник: роль, которую дал PM, не трогаем
        update: {},
      }),
      this.prisma.invitation.update({ where: { id: row.id }, data: { acceptedAt: new Date(), acceptedByUserId: userId } }),
    ]);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function summary(row: Invitation): InvitationSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    token: row.token,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}
