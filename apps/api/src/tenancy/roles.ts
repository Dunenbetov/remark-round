import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@remarkround/db';
import type { ProjectRequest } from './project-context';

export const ROLES = 'rr:roles';

/** Роли по docs/API.md. Без декоратора — любой member проекта. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [context.getHandler(), context.getClass()]);
    if (!roles || roles.length === 0) return true;
    const req = context.switchToHttp().getRequest<ProjectRequest>();
    if (!req.ctx || !roles.includes(req.ctx.role)) throw new ForbiddenException();
    return true;
  }
}
