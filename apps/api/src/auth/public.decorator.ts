import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'rr:isPublic';

/** Маршрут без JWT: только /health и /auth/login. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
