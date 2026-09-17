import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthedRequest } from '../auth/jwt-auth.guard';

/**
 * Администратор инстанса (ADR 006): e-mail из ADMIN_EMAILS. Не роль проекта — тот, кто отвечает за установку:
 * заводит людей, отключает уволенных, выдаёт право создавать проекты. MCP-токен сюда не пускает JwtAuthGuard.
 */
@Injectable()
export class InstanceAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user?.isInstanceAdmin) throw new ForbiddenException('Только администратор инстанса');
    return true;
  }
}
