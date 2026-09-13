import { Body, Controller, Get, Header, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, Min } from 'class-validator';
import type { Response } from 'express';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';
import { XLSX_MIME } from './journal-export';
import { RoundsService, type RoundSummary } from './rounds.service';

export class CreateRoundDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  number?: number;
}

export type { RoundSummary } from './rounds.service';

@Controller('projects/:projectId/rounds')
@UseGuards(MembershipGuard, RolesGuard)
export class RoundsController {
  constructor(private readonly rounds: RoundsService) {}

  @Get()
  list(@Ctx() ctx: ProjectContext): Promise<RoundSummary[]> {
    return this.rounds.list(ctx);
  }

  @Post()
  @Roles('pm', 'business', 'admin')
  create(@Ctx() ctx: ProjectContext, @Body() dto: CreateRoundDto): Promise<RoundSummary> {
    return this.rounds.create(ctx, dto.number);
  }

  /** «Здесь мы остановились»: только когда все замечания решены (закрыто / новое желание / повтор), иначе 409 с перечнем. */
  @Post(':roundId/close')
  @Roles('pm', 'business')
  @HttpCode(200)
  close(@Ctx() ctx: ProjectContext, @Param('roundId') roundId: string): Promise<RoundSummary> {
    return this.rounds.close(ctx, roundId);
  }

  @Post(':roundId/reopen')
  @Roles('pm', 'business')
  @HttpCode(200)
  reopen(@Ctx() ctx: ProjectContext, @Param('roundId') roundId: string): Promise<RoundSummary> {
    return this.rounds.reopen(ctx, roundId);
  }

  /**
   * Журнал приёмки всего проекта (ADR 011): «Раунды», «Замечания», «История». Разработчику — 403: журнал читает базу
   * напрямую, а очередь разработчика — это не журнал. Маршрут в один сегмент не пересекается с `:roundId/…`.
   */
  @Get('export.xlsx')
  @Roles('pm', 'business', 'admin')
  @Header('Cache-Control', 'no-store')
  async exportJournal(@Ctx() ctx: ProjectContext, @Res() res: Response): Promise<void> {
    sendXlsx(res, await this.rounds.exportJournal(ctx));
  }

  /** Тот же журнал, ограниченный одним раундом — итог раунда для акта. */
  @Get(':roundId/export.xlsx')
  @Roles('pm', 'business', 'admin')
  @Header('Cache-Control', 'no-store')
  async exportRound(@Ctx() ctx: ProjectContext, @Param('roundId') roundId: string, @Res() res: Response): Promise<void> {
    sendXlsx(res, await this.rounds.exportJournal(ctx, roundId));
  }
}

function sendXlsx(res: Response, file: { fileName: string; data: Buffer }): void {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.send(file.data);
}
