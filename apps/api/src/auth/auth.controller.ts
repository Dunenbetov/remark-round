import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InvitationsService, type InboxInvitation } from '../tenancy/invitations.service';
import { AuthOptions, AuthService, AuthUser, LoginResult, MeResult } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PasswordResetService } from './password-reset.service';
import { Public } from './public.decorator';
import { AUTH_THROTTLE } from './throttle';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly invitations: InvitationsService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto.email, dto.password);
  }

  /** Регистрация открыта (ADR 005): ответ — та же сессия, что у входа. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<LoginResult> {
    return this.auth.register(dto);
  }

  /** Что показывать на входе: карточки демо-персон есть только на демо-стенде. */
  @Public()
  @Get('options')
  options(): AuthOptions {
    return this.auth.options();
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResult> {
    return this.auth.me(user.id);
  }

  @Patch('profile')
  profile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<AuthUser> {
    return this.auth.updateProfile(user.id, dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('password')
  @HttpCode(200)
  password(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<{ accessToken: string }> {
    return this.auth.changePassword(user.id, dto);
  }

  /**
   * «Колокольчик» (ADR 013): приглашения в проекты на e-mail вошедшего — писем нет, зарегистрированный видит их здесь.
   * Токен MCP сюда не пускает JwtAuthGuard (в пути нет projectId — 404), как и остальные личные маршруты.
   */
  @Get('invitations')
  inbox(@CurrentUser() user: AuthUser): Promise<InboxInvitation[]> {
    return this.invitations.listInbox(user.email);
  }

  /** Принять из колокольчика: 200 и свежие membership, как POST /invitations/:token/accept; чужое или истёкшее — 404, принятое — 410. */
  @Post('invitations/:invitationId/accept')
  @HttpCode(200)
  async acceptInvitation(@CurrentUser() user: AuthUser, @Param('invitationId') invitationId: string): Promise<MeResult> {
    await this.invitations.acceptFromInbox(user, invitationId);
    return this.auth.me(user.id);
  }

  /** Отклонить: строка приглашения удаляется, PM видит, что ожидающего больше нет. */
  @Post('invitations/:invitationId/decline')
  @HttpCode(204)
  declineInvitation(@CurrentUser() user: AuthUser, @Param('invitationId') invitationId: string): Promise<void> {
    return this.invitations.declineFromInbox(user, invitationId);
  }

  /** Новый пароль по ссылке от администратора (ADR 013): 204, дальше — обычный вход; мёртвая ссылка — 404, использованная — 410. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset')
  @HttpCode(204)
  reset(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.passwordReset.reset(dto.token, dto.password);
  }
}
