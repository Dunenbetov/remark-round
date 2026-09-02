import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@remarkround/db';
import type { AuthedRequest } from '../auth/jwt-auth.guard';

/**
 * Контекст проекта после MembershipGuard. Единственный источник projectId для SQL:
 * каждый findMany/findFirst в проектных сервисах фильтруется по ctx.projectId.
 */
export interface ProjectContext {
  userId: string;
  projectId: string;
  role: Role;
}

export interface ProjectRequest extends AuthedRequest {
  ctx: ProjectContext;
}

export const Ctx = createParamDecorator((_data: unknown, ctx: ExecutionContext): ProjectContext => {
  return ctx.switchToHttp().getRequest<ProjectRequest>().ctx;
});
