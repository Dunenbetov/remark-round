import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';
import { DocumentsService, DocumentSummary } from './documents.service';

@Controller('projects/:projectId/documents')
@UseGuards(MembershipGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @Roles('admin', 'pm', 'business')
  list(@Ctx() ctx: ProjectContext): Promise<DocumentSummary[]> {
    return this.documents.list(ctx);
  }

  @Get(':documentId')
  get(@Ctx() ctx: ProjectContext, @Param('documentId') documentId: string): Promise<DocumentSummary> {
    return this.documents.get(ctx, documentId);
  }
}
