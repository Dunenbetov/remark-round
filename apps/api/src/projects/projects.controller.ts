import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthService, type AuthUser, type McpTokenResult } from '../auth/auth.service';
import { InvitationsService, type InvitationLink } from '../tenancy/invitations.service';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { AddMemberResult, MemberSummary, MembersService, MembersView } from './members.service';
import { ProjectSummary, ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ProjectSummary[]> {
    return this.projects.listForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto): Promise<ProjectSummary> {
    return this.projects.create(user, dto.name);
  }
}

@Controller('projects/:projectId')
@UseGuards(MembershipGuard, RolesGuard)
export class ProjectController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly auth: AuthService,
    private readonly membersService: MembersService,
    private readonly invitations: InvitationsService,
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

  // Участники (ADR 005): ведёт руководитель приёмки или admin; заказчик и разработчик — 403.

  @Get('members')
  @Roles('pm', 'admin')
  members(@Ctx() ctx: ProjectContext): Promise<MembersView> {
    return this.membersService.list(ctx);
  }

  @Post('members')
  @Roles('pm', 'admin')
  addMember(@Ctx() ctx: ProjectContext, @Body() dto: AddMemberDto): Promise<AddMemberResult> {
    return this.membersService.add(ctx, dto.email, dto.role);
  }

  @Patch('members/:userId')
  @Roles('pm', 'admin')
  changeRole(@Ctx() ctx: ProjectContext, @Param('userId') userId: string, @Body() dto: UpdateMemberDto): Promise<MemberSummary> {
    return this.membersService.changeRole(ctx, userId, dto.role);
  }

  @Delete('members/:userId')
  @Roles('pm', 'admin')
  @HttpCode(204)
  removeMember(@Ctx() ctx: ProjectContext, @Param('userId') userId: string): Promise<void> {
    return this.membersService.remove(ctx, userId);
  }

  @Delete('invitations/:invitationId')
  @Roles('pm', 'admin')
  @HttpCode(204)
  revokeInvitation(@Ctx() ctx: ProjectContext, @Param('invitationId') invitationId: string): Promise<void> {
    return this.invitations.revoke(ctx, invitationId);
  }

  /** Новая ссылка для ожидающего приглашения (ADR 006): сырой токен в БД не хранится, поэтому «скопировать ещё раз» = выпустить заново. */
  @Post('invitations/:invitationId/link')
  @Roles('pm', 'admin')
  @HttpCode(200)
  regenerateLink(@Ctx() ctx: ProjectContext, @Param('invitationId') invitationId: string): Promise<InvitationLink> {
    return this.invitations.regenerateLink(ctx, invitationId);
  }
}
