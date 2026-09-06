import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@remarkround/db';
import type { AuthUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../tenancy/project-context';

export interface ProjectSummary {
  id: string;
  name: string;
  role: Role;
  createdAt: Date;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Только проекты, где у пользователя есть Membership. */
  async listForUser(userId: string): Promise<ProjectSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { project: true },
      orderBy: { project: { createdAt: 'asc' } },
    });
    return memberships.map((m) => ({
      id: m.project.id,
      name: m.project.name,
      role: m.role,
      createdAt: m.project.createdAt,
    }));
  }

  /** Проект создаёт тот, кто при регистрации выбрал сторону pm (ADR 005); он же становится pm проекта — решает и зовёт людей. */
  async create(user: AuthUser, name: string): Promise<ProjectSummary> {
    if (user.preferredRole !== 'pm') throw new ForbiddenException('Проекты создаёт руководитель приёмки');
    const project = await this.prisma.project.create({
      data: { name, memberships: { create: { userId: user.id, role: 'pm' } } },
    });
    return { id: project.id, name: project.name, role: 'pm', createdAt: project.createdAt };
  }

  async get(ctx: ProjectContext): Promise<ProjectSummary> {
    const project = await this.prisma.project.findFirst({ where: { id: ctx.projectId } });
    if (!project) throw new NotFoundException();
    return { id: project.id, name: project.name, role: ctx.role, createdAt: project.createdAt };
  }
}
