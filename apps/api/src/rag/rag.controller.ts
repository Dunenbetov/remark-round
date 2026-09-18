import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BOUND_SCORE } from '../llm/triage-llm';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { RolesGuard } from '../tenancy/roles';
import { RagService, SearchHit } from './rag.service';

export interface SearchResponse {
  query: string;
  /** Top-k ближайших фрагментов проекта, без отсечения по близости — как и раньше. */
  hits: SearchHit[];
  /**
   * Близость, с которой фрагмент считается опорой: тот же `BOUND_SCORE`, по которому граф привязывает замечание
   * к пункту ТЗ. Ниже — ближайший текст, но не опора. MCP `search_spec` берёт порог отсюда, чтобы у внешнего
   * ассистента и у графа он был один.
   */
  boundScore: number;
}

/** GET /projects/:projectId/search?q=…&k=5 — поиск с цитатой по пакету документов проекта. */
@Controller('projects/:projectId/search')
@UseGuards(MembershipGuard, RolesGuard)
export class RagController {
  constructor(private readonly rag: RagService) {}

  @Get()
  async search(@Ctx() ctx: ProjectContext, @Query('q') q = '', @Query('k') k?: string): Promise<SearchResponse> {
    const topK = k ? Number(k) : undefined;
    const hits = await this.rag.search(ctx, q, Number.isFinite(topK) ? topK : undefined);
    return { query: q, hits, boundScore: BOUND_SCORE };
  }
}
