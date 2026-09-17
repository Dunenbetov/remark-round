import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Role, User } from '@remarkround/db';
import { isInstanceAdmin } from '../auth/auth.service';
import { securityEvent } from '../observability/security-log';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService, normalizeEmail, type InvitationCreated, type InvitationRelink, type InvitationSummary } from '../tenancy/invitations.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { AdminUpdateUserDto } from './dto/update-user.dto';

export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  preferredRole: Role | null;
  canCreateProjects: boolean;
  isInstanceAdmin: boolean;
  disabledAt: string | null;
  createdAt: string;
  memberships: Array<{ projectId: string; projectName: string; projectSlug: string; role: Role }>;
}

export interface AdminProjectView {
  id: string;
  name: string;
  createdAt: string;
  members: number;
}

/** Известный e-mail получает право сразу; незнакомый — приглашение со ссылкой (токен один раз, как у проектных). */
export type AdminInviteResult = { kind: 'user'; user: AdminUserView } | { kind: 'invitation'; invitation: InvitationCreated };

export const CANNOT_DISABLE_SELF = 'Нельзя отключить себя';

/**
 * Администрирование инстанса (ADR 006): люди и проекты поперёк тенантов. Только чтение и три действия —
 * отключить/включить, выдать право создавать проекты, завершить сессии. Роли внутри проектов не трогает:
 * это дело pm проекта (MembersService).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly invitations: InvitationsService,
  ) {}

  /**
   * Пригласить руководителя приёмки без проекта (ADR 006, дополнение 17.09; A-1): в invite_only это единственный путь
   * для человека не с домена компании. Зарегистрированный получает право сразу, остальным — ссылка /join/<token>.
   */
  async invite(actorId: string, email: string): Promise<AdminInviteResult> {
    const normalized = normalizeEmail(email);
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) return { kind: 'invitation', invitation: await this.invitations.createInstance(actorId, normalized) };
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { canCreateProjects: true } });
    securityEvent('admin.user.update', { by: actorId, userId: user.id, canCreateProjects: true, viaInvite: true });
    return { kind: 'user', user: { ...toView(updated), memberships: [] } };
  }

  listInvitations(): Promise<InvitationSummary[]> {
    return this.invitations.listInstance();
  }

  revokeInvitation(actorId: string, invitationId: string): Promise<void> {
    return this.invitations.revokeInstance(actorId, invitationId);
  }

  invitationLink(actorId: string, invitationId: string): Promise<InvitationRelink> {
    return this.invitations.regenerateInstanceLink(actorId, invitationId);
  }

  async users(): Promise<AdminUserView[]> {
    const rows = await this.prisma.user.findMany({
      include: { memberships: { include: { project: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map((u) => ({
      ...toView(u),
      memberships: u.memberships.map((m) => ({ projectId: m.projectId, projectName: m.project.name, projectSlug: m.project.slug, role: m.role })),
    }));
  }

  async projects(): Promise<AdminProjectView[]> {
    const rows = await this.prisma.project.findMany({ include: { _count: { select: { memberships: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt.toISOString(), members: p._count.memberships }));
  }

  /** Отключение = тот же путь, что отзыв сессий: версия токенов растёт, сокеты рвутся, вход закрыт. */
  async update(actorId: string, userId: string, dto: AdminUpdateUserDto): Promise<AdminUserView> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    if (dto.disabled === true && userId === actorId) throw new ConflictException(CANNOT_DISABLE_SELF);
    const disabling = dto.disabled === true && !user.disabledAt;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.canCreateProjects !== undefined && { canCreateProjects: dto.canCreateProjects }),
        ...(dto.disabled === true && { disabledAt: user.disabledAt ?? new Date() }),
        ...(dto.disabled === false && { disabledAt: null }),
        ...(disabling && { tokenVersion: { increment: 1 } }),
      },
    });
    if (disabling) this.tenancy.revoke(userId);
    securityEvent('admin.user.update', { by: actorId, userId, canCreateProjects: dto.canCreateProjects, disabled: dto.disabled });
    return { ...toView(updated), memberships: [] };
  }

  /** «Завершить все сессии»: старые токены (включая MCP на 30 дней) — 401, человек входит заново. */
  async revokeSessions(actorId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    await this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    this.tenancy.revoke(userId);
    securityEvent('admin.user.revoke_sessions', { by: actorId, userId });
  }
}

function toView(u: User): Omit<AdminUserView, 'memberships'> {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    preferredRole: u.preferredRole,
    canCreateProjects: u.canCreateProjects,
    isInstanceAdmin: isInstanceAdmin(u.email),
    disabledAt: u.disabledAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}
