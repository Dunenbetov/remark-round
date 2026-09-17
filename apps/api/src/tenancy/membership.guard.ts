import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectRequest } from './project-context';
import { TenancyService } from './tenancy.service';

/**
 * Tenancy: `:projectId` из URL сверяется с Membership пользователя.
 * Чужой проект выглядит как 404 — не подтверждаем, что он существует (docs/API.md).
 */
@Injectable()
export class MembershipGuard implements CanActivate {
  constructor(private readonly tenancy: TenancyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ProjectRequest>();
    const raw = req.params['projectId'];
    const projectId = Array.isArray(raw) ? raw[0] : raw;
    if (!projectId) return true;
    if (!req.user) throw new NotFoundException();
    // Токен MCP привязан к одному проекту: любой другой для него не существует, даже при membership.
    if (req.user.scopedProjectId && req.user.scopedProjectId !== projectId) throw new NotFoundException();

    const ctx = await this.tenancy.contextFor(req.user.id, projectId);
    if (!ctx) throw new NotFoundException();

    req.ctx = ctx;
    return true;
  }
}
