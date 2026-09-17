import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../config';
import { MailModule } from '../mail/mail.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [
    TenancyModule,
    MailModule,
    // Секрет и срок — из config(): в production короткий или дефолтный секрет валит процесс на старте.
    JwtModule.register({
      secret: config().JWT_SECRET,
      signOptions: { expiresIn: config().JWT_EXPIRES_SECONDS },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordResetService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
