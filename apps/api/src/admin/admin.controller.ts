import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';
import { AdminProjectView, AdminService, AdminUserView } from './admin.service';
import { AdminUpdateUserDto } from './dto/update-user.dto';
import { InstanceAdminGuard } from './instance-admin.guard';

/** /admin/* — только для e-mail из ADMIN_EMAILS (ADR 006). Не путать с проектной ролью `admin`. */
@Controller('admin')
@UseGuards(InstanceAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

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
}
