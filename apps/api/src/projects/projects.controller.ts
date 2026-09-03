import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthService, type AuthUser, type McpTokenResult } from '../auth/auth.service';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { MemberSummary, ProjectSummary, ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ProjectSummary[]> {
    return this.projects.listForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto): Promise<ProjectSummary> {
    return this.projects.create(user.id, dto.name);
  }
}

@Controller('projects/:projectId')
@UseGuards(MembershipGuard, RolesGuard)
export class ProjectController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Токен для MCP-фасада (apps/mcp, ADR 003): привязан к этому проекту и роли membership.
   * Cursor / Claude Desktop с таким токеном видят только этот проект — чужой projectId для него 404.
   */
  @Post('mcp-token')
  @HttpCode(200)
  mcpToken(@Ctx() ctx: ProjectContext): Promise<McpTokenResult> {
    return this.auth.mcpToken(ctx.userId, ctx.projectId);
  }

  @Get()
  get(@Ctx() ctx: ProjectContext): Promise<ProjectSummary> {
    return this.projects.get(ctx);
  }

  @Get('members')
  @Roles('admin')
  members(@Ctx() ctx: ProjectContext): Promise<MemberSummary[]> {
    return this.projects.members(ctx);
  }

  @Post('members')
  @Roles('admin')
  addMember(@Ctx() ctx: ProjectContext, @Body() dto: AddMemberDto): Promise<MemberSummary> {
    return this.projects.addMember(ctx, dto.email, dto.role);
  }
}
