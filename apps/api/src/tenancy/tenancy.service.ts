import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from './project-context';

/**
 * Один источник ProjectContext для REST (MembershipGuard) и WS (join комнаты).
 * Чужой проект — null: наверху это 404 (REST) или «Нет доступа» (WS), но никогда не «фильтр в промпте».
 */
@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  async contextFor(userId: string, projectId: string): Promise<ProjectContext | null> {
    const membership = await this.prisma.membership.findUnique({ where: { userId_projectId: { userId, projectId } } });
    return membership ? { userId, projectId, role: membership.role } : null;
  }
}
