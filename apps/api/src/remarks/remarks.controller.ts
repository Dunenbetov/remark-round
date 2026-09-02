import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';
import { CreateRemarkDto, LinkDuplicateDto, RemarkView, ScreenshotDto, VerdictDto } from './remark.dto';
import { RemarksService } from './remarks.service';

/** Маршруты docs/API.md. Роли проверяет RolesGuard, переходы — RemarksService. */
@Controller('projects/:projectId')
@UseGuards(MembershipGuard, RolesGuard)
export class RemarksController {
  constructor(private readonly remarks: RemarksService) {}

  @Get('rounds/:roundId/remarks')
  list(@Ctx() ctx: ProjectContext, @Param('roundId') roundId: string): Promise<RemarkView[]> {
    return this.remarks.list(ctx, roundId);
  }

  @Post('rounds/:roundId/remarks')
  @Roles('business', 'pm')
  @HttpCode(201)
  create(@Ctx() ctx: ProjectContext, @Param('roundId') roundId: string, @Body() dto: CreateRemarkDto): Promise<RemarkView> {
    return this.remarks.create(ctx, roundId, dto);
  }

  @Get('dev-queue')
  @Roles('developer')
  devQueue(@Ctx() ctx: ProjectContext): Promise<RemarkView[]> {
    return this.remarks.devQueue(ctx);
  }

  @Get('remarks/:remarkId')
  get(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string): Promise<RemarkView> {
    return this.remarks.get(ctx, remarkId);
  }

  @Post('remarks/:remarkId/triage')
  @Roles('pm', 'business')
  @HttpCode(200)
  triage(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string): Promise<RemarkView> {
    return this.remarks.runTriage(ctx, remarkId);
  }

  @Post('remarks/:remarkId/verdict')
  @Roles('pm', 'business')
  @HttpCode(200)
  verdict(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string, @Body() dto: VerdictDto): Promise<RemarkView> {
    return this.remarks.verdict(ctx, remarkId, dto);
  }

  @Post('remarks/:remarkId/link-duplicate')
  @Roles('pm')
  @HttpCode(200)
  linkDuplicate(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string, @Body() dto: LinkDuplicateDto): Promise<RemarkView> {
    return this.remarks.linkDuplicate(ctx, remarkId, dto.duplicateOfNumber);
  }

  @Post('remarks/:remarkId/screenshot')
  @Roles('business', 'pm')
  @HttpCode(200)
  attachScreenshot(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string, @Body() dto: ScreenshotDto): Promise<RemarkView> {
    return this.remarks.attachScreenshot(ctx, remarkId, dto.screenshotKey);
  }

  @Post('remarks/:remarkId/ready-for-retest')
  @Roles('developer')
  @HttpCode(200)
  readyForRetest(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string): Promise<RemarkView> {
    return this.remarks.readyForRetest(ctx, remarkId);
  }

  @Post('remarks/:remarkId/retest')
  @Roles('business')
  @HttpCode(200)
  retest(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string, @Body() dto: ScreenshotDto): Promise<RemarkView> {
    return this.remarks.retest(ctx, remarkId, dto.screenshotKey);
  }

  @Post('remarks/:remarkId/close')
  @Roles('business')
  @HttpCode(200)
  close(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string): Promise<RemarkView> {
    return this.remarks.close(ctx, remarkId);
  }

  @Post('remarks/:remarkId/not-fixed')
  @Roles('business')
  @HttpCode(200)
  notFixed(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string): Promise<RemarkView> {
    return this.remarks.notFixed(ctx, remarkId);
  }
}
