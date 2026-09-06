import { ConflictException, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role, User } from '@remarkround/db';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService, normalizeEmail } from '../tenancy/invitations.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { RegisterDto } from './dto/register.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { hashPassword, verifyPassword } from './password';

export interface JwtPayload {
  sub: string;
  email: string;
  /**
   * Токен для MCP / IDE привязан к одному проекту (ADR 003): projectId берётся из membership
   * при выпуске, а не из «просьбы модели». Обычный токен из /auth/login поля не имеет.
   */
  projectId?: string;
  /** Момент выпуска в миллисекундах (iat у JWT — секунды, этого мало): токены старше passwordChangedAt недействительны. */
  ts?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Сторона при регистрации (ADR 005): подсказка, право создавать проекты — только pm. */
  preferredRole: Role | null;
  /** Проект, к которому привязан токен; остальные проекты для такого токена не существуют (404). */
  scopedProjectId?: string;
}

export interface MembershipSummary {
  projectId: string;
  projectName: string;
  role: Role;
}

export interface LoginResult {
  accessToken: string;
  user: AuthUser;
  memberships: MembershipSummary[];
}

/** GET /auth/me: свежие пользователь и membership без перелогина. */
export interface MeResult {
  user: AuthUser;
  memberships: MembershipSummary[];
}

export interface McpTokenResult {
  token: string;
  projectId: string;
  projectName: string;
  role: Role;
  expiresAt: string;
}

export interface AuthOptions {
  /** Карточки демо-персон на входе (DEMO_LOGINS); в production выключены. */
  demoLogins: boolean;
}

const MCP_TOKEN_SECONDS = config().MCP_TOKEN_EXPIRES_SECONDS;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly invitations: InvitationsService,
    private readonly tenancy: TenancyService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    // Одинаковый ответ для «нет пользователя» и «не тот пароль»: не светим e-mail.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException();
    }
    // Приглашения, отправленные на этот e-mail, пока человека не было — принимаются при входе
    await this.invitations.acceptPendingByEmail(user.id, user.email);
    return this.session(user);
  }

  /**
   * Регистрация (ADR 005): открыта всем; без проекта человек видит экран ожидания.
   * Приглашение по ссылке (inviteToken) и приглашения на этот e-mail принимаются сразу.
   */
  async register(dto: RegisterDto): Promise<LoginResult> {
    const email = normalizeEmail(dto.email);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: { email, name: dto.name, passwordHash: await hashPassword(dto.password), preferredRole: dto.preferredRole },
      });
    } catch (e) {
      // P2002 — unique(email): одинаковый ответ не нужен, регистрация и так публична
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Этот e-mail уже зарегистрирован');
      throw e;
    }
    if (dto.inviteToken) {
      // Ссылка могла истечь или быть отозвана: регистрация всё равно состоялась, человек увидит экран ожидания
      await this.invitations.acceptByToken(user.id, dto.inviteToken).catch(() => undefined);
    }
    await this.invitations.acceptPendingByEmail(user.id, user.email);
    return this.session(user);
  }

  /** Свежие membership: страница ожидания опрашивает это, пока PM не добавит человека. */
  async me(userId: string): Promise<MeResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    await this.invitations.acceptPendingByEmail(user.id, user.email);
    return { user: toAuthUser(user), memberships: await this.membershipsOf(user.id) };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<AuthUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { ...(dto.name !== undefined && { name: dto.name }), ...(dto.preferredRole !== undefined && { preferredRole: dto.preferredRole }) },
    });
    return toAuthUser(user);
  }

  /**
   * Смена пароля = выход везде: все токены с `ts` раньше passwordChangedAt, включая MCP, недействительны;
   * новый токен подписывается уже после записи. Неверный текущий — 422, не 401: фронт на 401 разлогинивает.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!(await verifyPassword(dto.current, user.passwordHash))) throw new UnprocessableEntityException('Текущий пароль не подходит');
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(dto.next), passwordChangedAt: new Date() },
    });
    this.tenancy.revoke(userId);
    return { accessToken: await this.sign(updated) };
  }

  options(): AuthOptions {
    return { demoLogins: config().demoLogins };
  }

  /**
   * Токен для MCP-фасада (apps/mcp): тот же JWT, но с `projectId` из membership.
   * Такой токен видит только этот проект — MembershipGuard и WS join сверяют его с URL.
   */
  async mcpToken(userId: string, projectId: string): Promise<McpTokenResult> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_projectId: { userId, projectId } },
      include: { project: true, user: true },
    });
    if (!membership) throw new NotFoundException();
    const payload: JwtPayload = { sub: membership.userId, email: membership.user.email, projectId, ts: Date.now() };
    const token = await this.jwt.signAsync(payload, { expiresIn: MCP_TOKEN_SECONDS });
    return {
      token,
      projectId,
      projectName: membership.project.name,
      role: membership.role,
      expiresAt: new Date(Date.now() + MCP_TOKEN_SECONDS * 1000).toISOString(),
    };
  }

  async userFromToken(token: string): Promise<AuthUser> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();
    // Токен без ts (выпущен до фазы 11) после смены пароля тоже недействителен
    if (user.passwordChangedAt && (payload.ts === undefined || payload.ts < user.passwordChangedAt.getTime())) {
      throw new UnauthorizedException();
    }
    return { ...toAuthUser(user), scopedProjectId: payload.projectId };
  }

  private async session(user: User): Promise<LoginResult> {
    return { accessToken: await this.sign(user), user: toAuthUser(user), memberships: await this.membershipsOf(user.id) };
  }

  private sign(user: User): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email, ts: Date.now() };
    return this.jwt.signAsync(payload);
  }

  private async membershipsOf(userId: string): Promise<MembershipSummary[]> {
    const rows = await this.prisma.membership.findMany({ where: { userId }, include: { project: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => ({ projectId: m.projectId, projectName: m.project.name, role: m.role }));
  }
}

function toAuthUser(user: User): AuthUser {
  return { id: user.id, email: user.email, name: user.name, preferredRole: user.preferredRole };
}
