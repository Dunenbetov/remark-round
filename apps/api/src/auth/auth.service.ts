import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role, User } from '@remarkround/db';
import { config, type RegistrationMode } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { securityEvent } from '../observability/security-log';
import { InvitationsService, normalizeEmail } from '../tenancy/invitations.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { RegisterDto } from './dto/register.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoAccount } from './demo-accounts';
import { isInstanceAdmin } from './instance-admin';
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
  /** Версия сессий (ADR 006): не совпала с User.tokenVersion — токен отозван администратором или «выйти везде». */
  tv?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Сторона при регистрации (ADR 005): подсказка для экранов, прав не даёт. У администратора инстанса всегда null (ADR 006, 17.09). */
  preferredRole: Role | null;
  /** Право создавать проекты (ADR 006): выдаёт администратор инстанса; у администратора есть всегда. */
  canCreateProjects: boolean;
  /** E-mail в ADMIN_EMAILS: администрирование инстанса — люди, проекты, отключение, отзыв сессий. */
  isInstanceAdmin: boolean;
  /** Проект, к которому привязан токен; остальные проекты для такого токена не существуют (404). */
  scopedProjectId?: string;
}

export interface MembershipSummary {
  projectId: string;
  projectName: string;
  /** Имя проекта в адресе SPA (/<slug>/round-2/12); фронт по нему находит projectId. */
  projectSlug: string;
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
  /** open — регистрация всем; invite_only — только по ссылке приглашения (и администраторам инстанса). */
  registration: RegistrationMode;
  /** Демо-персоны стенда и их пароль — только при demoLogins; иначе полей нет (D-2). */
  demoAccounts?: readonly DemoAccount[];
  demoPassword?: string;
  /** Sentry для SPA (R-L5): DSN публичный по природе, отдаётся при SENTRY_DSN_WEB; `release` — версия сборки API. */
  sentryDsn?: string;
  release: string;
}

export const ACCOUNT_DISABLED = 'Учётная запись отключена — обратитесь к администратору';
export const REGISTRATION_CLOSED = 'Регистрация только по ссылке приглашения';

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
      securityEvent('login.fail', { email: normalizeEmail(email), known: Boolean(user) });
      throw new UnauthorizedException();
    }
    // Пароль верный, но человека отключили: сказать прямо — это не «неверный пароль»
    if (user.disabledAt) {
      securityEvent('login.disabled', { userId: user.id, email: user.email });
      throw new ForbiddenException(ACCOUNT_DISABLED);
    }
    securityEvent('login.ok', { userId: user.id, email: user.email });
    return this.session(user);
  }

  /**
   * Регистрация (ADR 006). Кто может: все (REGISTRATION_MODE=open), пришедший по живой ссылке приглашения,
   * e-mail с домена из REGISTRATION_DOMAINS, администратор инстанса (первый человек в пустой системе).
   * Приглашение принимается только по ссылке: совпадение e-mail без неё ничего не даёт.
   */
  async register(dto: RegisterDto): Promise<LoginResult> {
    const email = normalizeEmail(dto.email);
    // Ссылка проверяется до создания пользователя: по мёртвой ссылке в закрытом режиме аккаунт не появится
    if (dto.inviteToken) await this.invitations.assertUsable(dto.inviteToken).catch((e: unknown) => this.rejectInvite(e));
    if (!dto.inviteToken && !this.selfRegistrationAllowed(email)) throw new ForbiddenException(REGISTRATION_CLOSED);
    // Администратор инстанса — скрытая роль без стороны (ADR 006, 17.09): DTO требует сторону от всех, у него она не сохраняется
    const preferredRole = isInstanceAdmin(email) ? null : dto.preferredRole;
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: { email, name: dto.name, passwordHash: await hashPassword(dto.password), preferredRole },
      });
    } catch (e) {
      // P2002 — unique(email): одинаковый ответ не нужен, регистрация и так публична
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Этот e-mail уже зарегистрирован');
      throw e;
    }
    if (dto.inviteToken) {
      await this.invitations.acceptByToken(user.id, dto.inviteToken);
      // Приглашение руководителя (ADR 006, 17.09) меняет самого пользователя: сессия — по свежей строке, не по созданной
      user = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    }
    securityEvent('register', { userId: user.id, email, preferredRole, viaInvite: Boolean(dto.inviteToken), mode: config().registrationMode });
    return this.session(user);
  }

  /** Свежие membership: страница ожидания опрашивает это, пока PM не добавит человека. */
  async me(userId: string): Promise<MeResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return { user: toAuthUser(user), memberships: await this.membershipsOf(user.id) };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<AuthUser> {
    const current = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!current) throw new UnauthorizedException();
    // Сторону администратора инстанса не пишем: у него её нет (ADR 006, 17.09), присланная — игнорируется
    const sideChanged = dto.preferredRole !== undefined && !isInstanceAdmin(current.email);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(sideChanged && { preferredRole: dto.preferredRole }),
      },
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
    securityEvent('password.change', { userId });
    return { accessToken: await this.sign(updated) };
  }

  options(): AuthOptions {
    const cfg = config();
    const base: AuthOptions = { demoLogins: cfg.demoLogins, registration: cfg.registrationMode, release: cfg.APP_VERSION, ...(cfg.SENTRY_DSN_WEB && { sentryDsn: cfg.SENTRY_DSN_WEB }) };
    return cfg.demoLogins ? { ...base, demoAccounts: DEMO_ACCOUNTS, demoPassword: DEMO_PASSWORD } : base;
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
    const payload: JwtPayload = { sub: membership.userId, email: membership.user.email, projectId, ts: Date.now(), tv: membership.user.tokenVersion };
    const token = await this.jwt.signAsync(payload, { expiresIn: MCP_TOKEN_SECONDS });
    securityEvent('mcp_token.issue', { userId, projectId, role: membership.role, expiresInSeconds: MCP_TOKEN_SECONDS });
    return {
      token,
      projectId,
      projectName: membership.project.name,
      role: membership.role,
      expiresAt: new Date(Date.now() + MCP_TOKEN_SECONDS * 1000).toISOString(),
    };
  }

  /**
   * Единственная проверка токена для REST, WS и MCP. Недействителен, если: подпись/срок не прошли; пользователя нет
   * или он отключён; версия сессий `tv` не совпала (отзыв администратором); выпущен до смены пароля.
   */
  async userFromToken(token: string): Promise<AuthUser> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.disabledAt) throw new UnauthorizedException();
    // Токен без tv (выпущен до ADR 006) считается версии 0
    if ((payload.tv ?? 0) !== user.tokenVersion) throw new UnauthorizedException();
    // Токен без ts (выпущен до фазы 11) после смены пароля тоже недействителен
    if (user.passwordChangedAt && (payload.ts === undefined || payload.ts < user.passwordChangedAt.getTime())) {
      throw new UnauthorizedException();
    }
    return { ...toAuthUser(user), scopedProjectId: payload.projectId };
  }

  private selfRegistrationAllowed(email: string): boolean {
    const cfg = config();
    if (cfg.adminEmails.has(email)) return true;
    if (cfg.registrationMode === 'open') return true;
    const domain = email.slice(email.lastIndexOf('@') + 1);
    return cfg.registrationDomains.includes(domain);
  }

  /** Мёртвая ссылка при регистрации: 404/410 как у GET /invitations/:token, чтобы фронт показал то же сообщение. */
  private rejectInvite(e: unknown): never {
    if (e instanceof NotFoundException) throw new NotFoundException('Ссылка приглашения не действует');
    throw e;
  }

  private async session(user: User): Promise<LoginResult> {
    return { accessToken: await this.sign(user), user: toAuthUser(user), memberships: await this.membershipsOf(user.id) };
  }

  private sign(user: User): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email, ts: Date.now(), tv: user.tokenVersion };
    return this.jwt.signAsync(payload);
  }

  private async membershipsOf(userId: string): Promise<MembershipSummary[]> {
    const rows = await this.prisma.membership.findMany({ where: { userId }, include: { project: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => ({ projectId: m.projectId, projectName: m.project.name, projectSlug: m.project.slug, role: m.role }));
  }
}

export { isInstanceAdmin } from './instance-admin';

/** Администратор инстанса — скрытая роль «Администратор», не сторона: `preferredRole` у него всегда null, что бы ни лежало в строке. */
export function toAuthUser(user: User): AuthUser {
  const admin = isInstanceAdmin(user.email);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    preferredRole: admin ? null : user.preferredRole,
    canCreateProjects: user.canCreateProjects || admin,
    isInstanceAdmin: admin,
  };
}
