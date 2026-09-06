import { Body, Controller, Get, Header, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, Min } from 'class-validator';
import type { Response } from 'express';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';
import { ROUND_XLSX_MIME } from './round-export';
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

  /** Итог раунда для акта: xlsx из карточек, которые видит читатель (заказчик — без внутренней кухни, ADR 007). */
  @Get(':roundId/export.xlsx')
  @Header('Cache-Control', 'no-store')
  async exportXlsx(@Ctx() ctx: ProjectContext, @Param('roundId') roundId: string, @Res() res: Response): Promise<void> {
    const { fileName, data } = await this.rounds.exportXlsx(ctx, roundId);
    res.setHeader('Content-Type', ROUND_XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(data);
  }
}
