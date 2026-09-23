import { Body, Controller, Get, HttpCode, Post, Query, UnprocessableEntityException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { ListNotificationsQuery, ReadNotificationsDto } from './notifications.dto';
import { NotificationsService, type NotificationPage } from './notifications.service';

/**
 * Колокольчик уведомлений (ADR 016) — личный маршрут, как `/auth/invitations`: без `:projectId`, поэтому токен MCP
 * получает 404 в JwtAuthGuard. Видно только свои строки и только в текущей роли в проекте.
 */
@Controller('auth/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQuery): Promise<NotificationPage> {
    return this.notifications.list(user.id, { limit: query.limit, before: query.before });
  }

  @Post('read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Body() dto: ReadNotificationsDto): Promise<{ unread: number }> {
    const given = [dto.ids, dto.remarkId, dto.all].filter((v) => v !== undefined).length;
    if (given !== 1) throw new UnprocessableEntityException('Нужно одно из полей: ids, remarkId или all');
    return this.notifications.markRead(user.id, dto.ids ? { ids: dto.ids } : dto.remarkId ? { remarkId: dto.remarkId } : { all: true });
  }
}
