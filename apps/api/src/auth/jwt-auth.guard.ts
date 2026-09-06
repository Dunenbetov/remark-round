import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, AuthUser } from './auth.service';
import { IS_PUBLIC } from './public.decorator';

export interface AuthedRequest extends Request {
  user: AuthUser;
}

/** Глобальный guard: Bearer JWT на всём, кроме @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    req.user = await this.auth.userFromToken(token);

    // Токен MCP (ADR 003) живёт только внутри своего проекта: список проектов, аккаунт, приглашения
    // и любой другой projectId для него не существуют — 404, как чужой проект.
    const scoped = req.user.scopedProjectId;
    if (scoped) {
      const raw = req.params?.['projectId'];
      const projectId = Array.isArray(raw) ? raw[0] : raw;
      if (projectId !== scoped) throw new NotFoundException();
    }
    return true;
  }
}
