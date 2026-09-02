import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectRequest } from './project-context';

/**
 * Tenancy: `:projectId` из URL сверяется с Membership пользователя.
 * Чужой проект выглядит как 404 — не подтверждаем, что он существует (docs/API.md).
 */
@Injectable()
export class MembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ProjectRequest>();
    const raw = req.params['projectId'];
    const projectId = Array.isArray(raw) ? raw[0] : raw;
    if (!projectId) return true;
    if (!req.user) throw new NotFoundException();

    const membership = await this.prisma.membership.findUnique({
      where: { userId_projectId: { userId: req.user.id, projectId } },
    });
    if (!membership) throw new NotFoundException();

    req.ctx = { userId: req.user.id, projectId, role: membership.role };
    return true;
  }
}
