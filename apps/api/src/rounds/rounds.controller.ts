import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';

export class CreateRoundDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  number?: number;
}

export interface RoundSummary {
  id: string;
  number: number;
  status: 'open' | 'closed';
  remarks: number;
}

@Controller('projects/:projectId/rounds')
@UseGuards(MembershipGuard, RolesGuard)
export class RoundsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Ctx() ctx: ProjectContext): Promise<RoundSummary[]> {
    const rounds = await this.prisma.round.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { number: 'asc' },
      include: { _count: { select: { remarks: true } } },
    });
    return rounds.map((r) => ({ id: r.id, number: r.number, status: r.status, remarks: r._count.remarks }));
  }

  @Post()
  @Roles('pm', 'business', 'admin')
  async create(@Ctx() ctx: ProjectContext, @Body() dto: CreateRoundDto): Promise<RoundSummary> {
    // Номер под блокировкой строки проекта: два «Новых раунда» разом иначе спотыкались об @@unique(projectId, number)
    const round = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${ctx.projectId} FOR UPDATE`;
      const last = await tx.round.findFirst({ where: { projectId: ctx.projectId }, orderBy: { number: 'desc' } });
      const number = dto.number ?? (last ? last.number + 1 : 1);
      return tx.round.create({ data: { projectId: ctx.projectId, number } });
    });
    return { id: round.id, number: round.number, status: round.status, remarks: 0 };
  }
}
