import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isInstanceAdmin } from '../auth/instance-admin';
import type { Membership, Role, User } from '@remarkround/db';
import { securityEvent } from '../observability/security-log';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService, normalizeEmail, type InvitationCreated, type InvitationSummary } from '../tenancy/invitations.service';
import type { ProjectContext } from '../tenancy/project-context';
import { TenancyService } from '../tenancy/tenancy.service';

export interface MemberSummary {
  userId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface MembersView {
  members: MemberSummary[];
  /** Ещё не приняли: ссылка или колокольчик ждут человека (ADR 013) */
  invitations: InvitationSummary[];
}

/** `member` — уже участник, сменили роль; иначе приглашение: сырой `token` один раз (ADR 006), дальше только «Новая ссылка». */
export type AddMemberResult = { kind: 'member'; member: MemberSummary } | { kind: 'invitation'; invitation: InvitationCreated };

export const LAST_PM = 'Единственный руководитель приёмки — сначала назначьте другого';
/** Администратор инстанса — не сторона и не участник (ADR 006, 20.09): для работы в проекте нужен отдельный аккаунт. */
export const ADMIN_NOT_MEMBER = 'Администратор инстанса не участвует в проектах — заведите ему отдельный аккаунт';

/**
 * Участники проекта (ADR 005): ведёт руководитель приёмки (pm) или admin. Роль — на проект.
 * Единственный путь записи Membership вместе с InvitationsService.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    private readonly tenancy: TenancyService,
  ) {}

  async list(ctx: ProjectContext): Promise<MembersView> {
    const rows = await this.prisma.membership.findMany({
      where: { projectId: ctx.projectId },
      include: { user: true },
      orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
    });
    return { members: rows.map((m) => toSummary(m.user, m)), invitations: await this.invitations.listPending(ctx.projectId) };
  }

  /**
   * Уже участник — повтор меняет роль. Любой другой, зарегистрированный или нет, — приглашение (ADR 013): напрямую
   * в проект никого не записываем. Зарегистрированный увидит его в колокольчике и примет сам, остальным PM отправит
   * ссылку (token — один раз); `inviteeName` показывает PM, чей аккаунт стоит за адресом.
   */
  async add(ctx: ProjectContext, email: string, role: Role): Promise<AddMemberResult> {
    const normalized = normalizeEmail(email);
    if (isInstanceAdmin(normalized)) throw new ConflictException(ADMIN_NOT_MEMBER);
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    const existing = user ? await this.prisma.membership.findUnique({ where: { userId_projectId: { userId: user.id, projectId: ctx.projectId } } }) : null;
    if (!user || !existing) return { kind: 'invitation', invitation: await this.invitations.create(ctx, normalized, role) };
    if (existing.role === 'pm' && role !== 'pm') await this.assertNotLastPm(ctx.projectId, user.id);
    const membership = await this.prisma.membership.update({ where: { id: existing.id }, data: { role } });
    if (existing.role !== role) this.tenancy.revoke(user.id, ctx.projectId);
    securityEvent('member.role', { projectId: ctx.projectId, by: ctx.userId, userId: user.id, role, from: existing.role });
    return { kind: 'member', member: toSummary(user, membership) };
  }

  async changeRole(ctx: ProjectContext, userId: string, role: Role): Promise<MemberSummary> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_projectId: { userId, projectId: ctx.projectId } },
      include: { user: true },
    });
    if (!membership) throw new NotFoundException();
    if (membership.role === 'pm' && role !== 'pm') await this.assertNotLastPm(ctx.projectId, userId);
    const updated = await this.prisma.membership.update({ where: { id: membership.id }, data: { role }, include: { user: true } });
    // WS кэширует роль на join: без отзыва бывший pm продолжил бы решать в открытых комнатах
    if (membership.role !== role) this.tenancy.revoke(userId, ctx.projectId);
    securityEvent('member.role', { projectId: ctx.projectId, by: ctx.userId, userId, role, from: membership.role });
    return toSummary(updated.user, updated);
  }

  /** Убрать из проекта: membership и приглашение на этот e-mail (старая ссылка не должна вернуть человека); WS-сокеты выкидываются из комнат проекта. */
  async remove(ctx: ProjectContext, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_projectId: { userId, projectId: ctx.projectId } },
      include: { user: true },
    });
    if (!membership) throw new NotFoundException();
    if (membership.role === 'pm') await this.assertNotLastPm(ctx.projectId, userId);
    await this.prisma.$transaction([
      this.prisma.membership.delete({ where: { id: membership.id } }),
      this.prisma.invitation.deleteMany({ where: { projectId: ctx.projectId, email: membership.user.email } }),
    ]);
    this.tenancy.revoke(userId, ctx.projectId);
    securityEvent('member.remove', { projectId: ctx.projectId, by: ctx.userId, userId, role: membership.role });
  }

  /** В проекте всегда остаётся хотя бы один pm: иначе некому решать и некому звать людей. */
  private async assertNotLastPm(projectId: string, userId: string): Promise<void> {
    const others = await this.prisma.membership.count({ where: { projectId, role: 'pm', NOT: { userId } } });
    if (others === 0) throw new ConflictException(LAST_PM);
  }
}

function toSummary(user: User, membership: Membership): MemberSummary {
  return { userId: user.id, email: user.email, name: user.name, role: membership.role, createdAt: membership.createdAt.toISOString() };
}
