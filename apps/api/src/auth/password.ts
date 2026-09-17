import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const KEY_LENGTH = 64;
const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

/**
 * scrypt из node:crypto — без нативных зависимостей. Формат: `scrypt$<salt>$<hash>`.
 * Асинхронный: синхронный вариант блокировал event loop на каждом входе (фаза 11).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, KEY_LENGTH)).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** `stored` = null — у пользователя нет пароля (вход только через внешний провайдер): всегда false. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scryptAsync(password, salt, KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
