import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { RunEvents } from '../agent/run-events';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';
import { AdviceDto, CancelRunDto, CreateRemarkDto, FixRowDto, LinkDuplicateDto, RemarkView, ReopenDto, ScreenshotDto, VerdictDto } from './remark.dto';
import { RemarksService } from './remarks.service';

/**
 * Маршруты docs/API.md. Роли проверяет RolesGuard, переходы — RemarksService, прогон графа — AgentService.
 * Разбор идёт в фоне: ответ приходит сразу со статусом `triaging` и `runId`, фазы — в комнате WS.
 */
@Controller('projects/:projectId')
@UseGuards(MembershipGuard, RolesGuard)
export class RemarksController {
  constructor(
    private readonly remarks: RemarksService,
    private readonly agent: AgentService,
    private readonly events: RunEvents,
  ) {}

  @Get('rounds/:roundId/remarks')
  list(@Ctx() ctx: ProjectContext, @Param('roundId') roundId: string): Promise<RemarkView[]> {
    return this.remarks.list(ctx, roundId);
  }

  @Post('rounds/:roundId/remarks')
  @Roles('business', 'pm')
  @HttpCode(201)
  async create(@Ctx() ctx: ProjectContext, @Param('roundId') roundId: string, @Body() dto: CreateRemarkDto): Promise<RemarkView> {
    const created = await this.remarks.create(ctx, roundId, dto);
    return this.agent.startTriage(ctx, created.id);
  }

  @Get('dev-queue')
  @Roles('developer')
  devQueue(@Ctx() ctx: ProjectContext): Promise<RemarkView[]> {
    return this.remarks.devQueue(ctx);
  }

  /** Разработчику: что сейчас на приёмке у PM — можно посоветовать решение (не очередь работы). */
  @Get('advisory-queue')
  @Roles('developer')
  advisoryQueue(@Ctx() ctx: ProjectContext): Promise<RemarkView[]> {
    return this.remarks.advisoryQueue(ctx);
  }

  @Get('remarks/:remarkId')
  get(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string): Promise<RemarkView> {
    return this.remarks.get(ctx, remarkId);
  }

  /** Совет разработчика по awaiting_pm: не вердикт, статус не меняет; PM в комнате видит его сразу (remark.advice). */
  @Put('remarks/:remarkId/advice')
  @Roles('developer')
  @HttpCode(200)
  async advise(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string, @Body() dto: AdviceDto): Promise<RemarkView> {
    const view = await this.remarks.advise(ctx, remarkId, dto);
    this.events.emit(remarkId, { type: 'remark.advice', remarkId, advice: view.advice });
    return view;
  }

  /** Повтор претензии (business): новое замечание в открытом раунде со ссылкой на закрытый оригинал → `reopened`. */
  @Post('remarks/:remarkId/reopen')
  @Roles('business')
  @HttpCode(201)
  reopen(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string, @Body() dto: ReopenDto): Promise<RemarkView> {
    return this.remarks.reopen(ctx, remarkId, dto.roundId, dto.screenshotKey ?? null);
  }

  @Delete('remarks/:remarkId/advice')
  @Roles('developer')
  @HttpCode(200)
  async retractAdvice(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string): Promise<RemarkView> {
    const view = await this.remarks.retractAdvice(ctx, remarkId);
    this.events.emit(remarkId, { type: 'remark.advice', remarkId, advice: view.advice });
    return view;
  }

  /** «Допишите строку журнала»: needs_human_parse → imported → разбор. */
  @Post('remarks/:remarkId/fix-row')
  @Roles('business', 'pm')
  @HttpCode(200)
  async fixRow(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string, @Body() dto: FixRowDto): Promise<RemarkView> {
    await this.remarks.fixRow(ctx, remarkId, dto);
    return this.agent.startTriage(ctx, remarkId);
  }

  @Post('remarks/:remarkId/triage')
  @Roles('pm', 'business')
  @HttpCode(200)
  triage(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string): Promise<RemarkView> {
    return this.agent.startTriage(ctx, remarkId);
  }

  @Post('remarks/:remarkId/verdict')
  @Roles('pm', 'business')
  @HttpCode(200)
  verdict(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string, @Body() dto: VerdictDto): Promise<RemarkView> {
    return this.agent.verdict(ctx, remarkId, dto);
  }

  /** run.cancel по REST (дубль WS): вердикта нет, run = cancelled. */
  @Post('remarks/:remarkId/cancel')
  @Roles('pm', 'business')
  @HttpCode(200)
  cancel(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string, @Body() dto: CancelRunDto): Promise<RemarkView> {
    return this.agent.cancel(ctx, remarkId, dto.runId);
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
  async attachScreenshot(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string, @Body() dto: ScreenshotDto): Promise<RemarkView> {
    await this.remarks.attachScreenshot(ctx, remarkId, dto.screenshotKey);
    return this.agent.startTriage(ctx, remarkId);
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
    return this.agent.retest(ctx, remarkId, dto.screenshotKey);
  }

  @Post('remarks/:remarkId/close')
  @Roles('business')
  @HttpCode(200)
  close(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string): Promise<RemarkView> {
    return this.agent.close(ctx, remarkId);
  }

  @Post('remarks/:remarkId/not-fixed')
  @Roles('business')
  @HttpCode(200)
  notFixed(@Ctx() ctx: ProjectContext, @Param('remarkId') remarkId: string): Promise<RemarkView> {
    return this.agent.notFixed(ctx, remarkId);
  }
}
