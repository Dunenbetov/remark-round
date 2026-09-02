import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { RolesGuard } from '../tenancy/roles';
import { RagService, SearchHit } from './rag.service';

/** GET /projects/:projectId/search?q=…&k=5 — поиск с цитатой по пакету документов проекта. */
@Controller('projects/:projectId/search')
@UseGuards(MembershipGuard, RolesGuard)
export class RagController {
  constructor(private readonly rag: RagService) {}

  @Get()
  async search(
    @Ctx() ctx: ProjectContext,
    @Query('q') q = '',
    @Query('k') k?: string,
  ): Promise<{ query: string; hits: SearchHit[] }> {
    const topK = k ? Number(k) : undefined;
    const hits = await this.rag.search(ctx, q, Number.isFinite(topK) ? topK : undefined);
    return { query: q, hits };
  }
}
