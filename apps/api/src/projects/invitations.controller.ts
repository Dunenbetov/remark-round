import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService, type AuthUser, type MeResult } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { AUTH_THROTTLE } from '../auth/throttle';
import { InvitationsService, type InvitationPeek } from '../tenancy/invitations.service';

/** Ссылка /join/<token> (ADR 005): посмотреть до входа, принять после. Токен MCP сюда не пускает JwtAuthGuard. */
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Get(':token')
  peek(@Param('token') token: string): Promise<InvitationPeek> {
    return this.invitations.peek(token);
  }

  @Post(':token/accept')
  @HttpCode(200)
  async accept(@CurrentUser() user: AuthUser, @Param('token') token: string): Promise<MeResult> {
    await this.invitations.acceptByToken(user.id, token);
    return this.auth.me(user.id);
  }
}
