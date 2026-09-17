import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'rr:isPublic';

/** Маршрут без JWT: /health, /auth/login, /auth/register, /auth/options, GET /invitations/:token. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
