import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';
import { PasswordResetService, type PasswordResetLink } from '../auth/password-reset.service';
import type { InvitationLink, InvitationSummary } from '../tenancy/invitations.service';
import { AdminInviteResult, AdminProjectView, AdminService, AdminUserView } from './admin.service';
import { AdminInviteDto } from './dto/invite.dto';
import { AdminUpdateUserDto } from './dto/update-user.dto';
import { InstanceAdminGuard } from './instance-admin.guard';

/** /admin/* — только для e-mail из ADMIN_EMAILS (ADR 006). Не путать с проектной ролью `admin`. */
@Controller('admin')
@UseGuards(InstanceAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Get('users')
  users(): Promise<AdminUserView[]> {
    return this.admin.users();
  }

  @Get('projects')
  projects(): Promise<AdminProjectView[]> {
    return this.admin.projects();
  }

  @Patch('users/:userId')
  update(@CurrentUser() actor: AuthUser, @Param('userId') userId: string, @Body() dto: AdminUpdateUserDto): Promise<AdminUserView> {
    return this.admin.update(actor.id, userId, dto);
  }

  @Post('users/:userId/revoke-sessions')
  @HttpCode(204)
  revokeSessions(@CurrentUser() actor: AuthUser, @Param('userId') userId: string): Promise<void> {
    return this.admin.revokeSessions(actor.id, userId);
  }

  /**
   * Ссылка смены пароля (ADR 013): писем нет, администратор передаёт её человеку сам. Одноразовая, живёт сутки,
   * прежние ссылки человека гаснут; отключённому — 409.
   */
  @Post('users/:userId/reset-link')
  @HttpCode(200)
  resetLink(@CurrentUser() actor: AuthUser, @Param('userId') userId: string): Promise<PasswordResetLink> {
    return this.passwordReset.issueLink(actor.id, userId);
  }

  // Приглашение руководителя приёмки без проекта (ADR 006, 17.09): по ссылке — право создавать проекты

  @Get('invitations')
  invitations(): Promise<InvitationSummary[]> {
    return this.admin.listInvitations();
  }

  @Post('invitations')
  invite(@CurrentUser() actor: AuthUser, @Body() dto: AdminInviteDto): Promise<AdminInviteResult> {
    return this.admin.invite(actor.id, dto.email);
  }

  @Delete('invitations/:invitationId')
  @HttpCode(204)
  revokeInvitation(@CurrentUser() actor: AuthUser, @Param('invitationId') invitationId: string): Promise<void> {
    return this.admin.revokeInvitation(actor.id, invitationId);
  }

  @Post('invitations/:invitationId/link')
  @HttpCode(200)
  invitationLink(@CurrentUser() actor: AuthUser, @Param('invitationId') invitationId: string): Promise<InvitationLink> {
    return this.admin.invitationLink(actor.id, invitationId);
  }
}
