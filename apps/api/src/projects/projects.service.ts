import { Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@remarkround/db';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../tenancy/project-context';

export interface ProjectSummary {
  id: string;
  name: string;
  role: Role;
  createdAt: Date;
}

export interface MemberSummary {
  userId: string;
  email: string;
  name: string;
  role: Role;
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

  /** Пилот: любой залогиненный создаёт проект и становится его admin. */
  async create(userId: string, name: string): Promise<ProjectSummary> {
    const project = await this.prisma.project.create({
      data: { name, memberships: { create: { userId, role: 'admin' } } },
    });
    return { id: project.id, name: project.name, role: 'admin', createdAt: project.createdAt };
  }

  async get(ctx: ProjectContext): Promise<ProjectSummary> {
    const project = await this.prisma.project.findFirst({ where: { id: ctx.projectId } });
    if (!project) throw new NotFoundException();
    return { id: project.id, name: project.name, role: ctx.role, createdAt: project.createdAt };
  }

  async members(ctx: ProjectContext): Promise<MemberSummary[]> {
    const rows = await this.prisma.membership.findMany({
      where: { projectId: ctx.projectId },
      include: { user: true },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role }));
  }

  /** Добавить существующего пользователя или сменить ему роль. Пользователей не создаём. */
  async addMember(ctx: ProjectContext, email: string, role: Role): Promise<MemberSummary> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const membership = await this.prisma.membership.upsert({
      where: { userId_projectId: { userId: user.id, projectId: ctx.projectId } },
      create: { userId: user.id, projectId: ctx.projectId, role },
      update: { role },
    });
    return { userId: user.id, email: user.email, name: user.name, role: membership.role };
  }
}
