import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth.service';
import type { AuthedRequest } from './jwt-auth.guard';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});
