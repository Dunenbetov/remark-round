import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@remarkround/db';
import type { AuthUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../tenancy/project-context';
import { withUniqueSlug } from './slug';

export const NO_CREATE_RIGHT = 'Право создавать проекты выдаёт администратор';

export interface ProjectSummary {
  id: string;
  name: string;
  /** Имя в адресе SPA: /<slug>/round-2/12. */
  slug: string;
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
      slug: m.project.slug,
      role: m.role,
      createdAt: m.project.createdAt,
    }));
  }

  /** Проект создаёт тот, кому администратор инстанса выдал право (ADR 006); он же становится pm проекта — решает и зовёт людей. */
  async create(user: AuthUser, name: string): Promise<ProjectSummary> {
    if (!user.canCreateProjects) throw new ForbiddenException(NO_CREATE_RIGHT);
    const project = await withUniqueSlug(
      name,
      async (slug) => (await this.prisma.project.count({ where: { slug } })) > 0,
      (slug) => this.prisma.project.create({ data: { name, slug, memberships: { create: { userId: user.id, role: 'pm' } } } }),
    );
    return { id: project.id, name: project.name, slug: project.slug, role: 'pm', createdAt: project.createdAt };
  }

  async get(ctx: ProjectContext): Promise<ProjectSummary> {
    const project = await this.prisma.project.findFirst({ where: { id: ctx.projectId } });
    if (!project) throw new NotFoundException();
    return { id: project.id, name: project.name, slug: project.slug, role: ctx.role, createdAt: project.createdAt };
  }
}
