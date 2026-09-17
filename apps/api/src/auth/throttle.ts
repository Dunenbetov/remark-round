import { config } from '../config';

/** Строгий лимит на вход, регистрацию, смену пароля и просмотр приглашения: THROTTLE_AUTH_LIMIT в минуту с одного IP. */
export const AUTH_THROTTLE = { default: { limit: config().THROTTLE_AUTH_LIMIT, ttl: 60_000 } };
