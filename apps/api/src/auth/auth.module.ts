import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const secret = process.env['JWT_SECRET'];
if (!secret && process.env['NODE_ENV'] === 'production') {
  throw new Error('JWT_SECRET is required in production');
}

@Module({
  imports: [
    JwtModule.register({
      secret: secret ?? 'change-me',
      signOptions: { expiresIn: Number(process.env['JWT_EXPIRES_SECONDS'] ?? 12 * 3600) },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
