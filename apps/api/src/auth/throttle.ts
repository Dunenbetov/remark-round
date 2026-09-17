import { JwtService } from '@nestjs/jwt';
import { config } from '../config';

/** Строгий лимит на вход, регистрацию, смену и сброс пароля, просмотр приглашения: THROTTLE_AUTH_LIMIT в минуту с одного IP. */
export const AUTH_THROTTLE = { default: { limit: config().THROTTLE_AUTH_LIMIT, ttl: 60_000 } };

/** Проверка подписи без DI: JwtModule живёт внутри AuthModule и наружу не отдаётся, а трекер нужен глобальному guard'у. */
const jwt = new JwtService({ secret: config().JWT_SECRET });

/**
 * Ключ лимита запросов (аудит беты R-H5). Вошедший считается по `sub` проверенного JWT: офис за одним NAT не делит
 * один bucket, а 30 открытых карточек без сокета не выбивают 429 всему этажу. Аноним, просроченный или чужой токен —
 * по IP. Подпись проверяется обязательно: декодирование без проверки позволило бы подделать sub и уйти из IP-bucket'а.
 */
export function throttleTracker(req: { ip?: string; headers?: Record<string, unknown> }): string {
  const auth = req.headers?.['authorization'];
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token) {
    try {
      const { sub } = jwt.verify<{ sub?: unknown }>(token);
      if (typeof sub === 'string' && sub) return `u:${sub}`;
    } catch {
      // просроченный или чужой токен: запрос упадёт на JwtAuthGuard, а лимит считаем как анониму
    }
  }
  return `ip:${req.ip ?? 'unknown'}`;
}
