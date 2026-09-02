import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@remarkround/db';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password';

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface LoginResult {
  accessToken: string;
  user: AuthUser;
  memberships: Array<{ projectId: string; projectName: string; role: Role }>;
}

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

  async userFromToken(token: string): Promise<AuthUser> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, name: user.name };
  }
}
