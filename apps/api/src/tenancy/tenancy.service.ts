import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from './project-context';

export type RevokeListener = (userId: string, projectId?: string) => void;

/**
 * Один источник ProjectContext для REST (MembershipGuard) и WS (join комнаты).
 * Чужой проект — null: наверху это 404 (REST) или «Нет доступа» (WS), но никогда не «фильтр в промпте».
 */
@Injectable()
export class TenancyService {
  private readonly listeners = new Set<RevokeListener>();

  constructor(private readonly prisma: PrismaService) {}

  async contextFor(userId: string, projectId: string): Promise<ProjectContext | null> {
    const membership = await this.prisma.membership.findUnique({ where: { userId_projectId: { userId, projectId } } });
    return membership ? { userId, projectId, role: membership.role } : null;
  }

  /**
   * Участника убрали из проекта или он сменил пароль: REST перечитывает Membership на каждом запросе и так,
   * а WS-гейтвей кеширует контекст на join — по этому сигналу он выкидывает сокеты пользователя из комнат проекта
   * (без projectId — отовсюду). Эмиттер в процессе, как RunEvents: для второго инстанса API нужен внешний шине.
   */
  revoke(userId: string, projectId?: string): void {
    for (const listener of this.listeners) listener(userId, projectId);
  }

  onRevoke(listener: RevokeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
