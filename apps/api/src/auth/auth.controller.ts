import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthOptions, AuthService, AuthUser, LoginResult, MeResult } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from './public.decorator';
import { AUTH_THROTTLE } from './throttle';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
}
