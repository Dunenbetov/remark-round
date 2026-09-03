import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@remarkround/db';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password';

export interface JwtPayload {
  sub: string;
  email: string;
  /**
   * Токен для MCP / IDE привязан к одному проекту (ADR 003): projectId берётся из membership
   * при выпуске, а не из «просьбы модели». Обычный токен из /auth/login поля не имеет.
   */
  projectId?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Проект, к которому привязан токен; остальные проекты для такого токена не существуют (404). */
  scopedProjectId?: string;
}

export interface LoginResult {
  accessToken: string;
  user: AuthUser;
  memberships: Array<{ projectId: string; projectName: string; role: Role }>;
}

export interface McpTokenResult {
  token: string;
  projectId: string;
  projectName: string;
  role: Role;
  expiresAt: string;
}

const MCP_TOKEN_SECONDS = Number(process.env['MCP_TOKEN_EXPIRES_SECONDS'] ?? 30 * 24 * 3600);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { memberships: { include: { project: true } } },
    });
    // Одинаковый ответ для «нет пользователя» и «не тот пароль»: не светим e-mail.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException();
    }
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { id: user.id, email: user.email, name: user.name },
      memberships: user.memberships.map((m) => ({
        projectId: m.projectId,
        projectName: m.project.name,
        role: m.role,
      })),
    };
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
    const payload: JwtPayload = { sub: membership.userId, email: membership.user.email, projectId };
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
    return { id: user.id, email: user.email, name: user.name, scopedProjectId: payload.projectId };
  }
}
