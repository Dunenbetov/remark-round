/**
 * throttle.spec — аудит беты R-H5: ключ лимита запросов. Сам guard в тестах выключен (skipIf), поэтому проверяем трекер:
 * вошедший — по sub проверенного JWT, аноним и негодный токен — по IP.
 */
import { JwtService } from '@nestjs/jwt';
import { config } from '../config';
import { throttleTracker } from './throttle';

describe('throttle tracker', () => {
  const jwt = new JwtService({ secret: config().JWT_SECRET });

  it('вошедший — bucket по sub проверенного токена, не по IP', () => {
    const token = jwt.sign({ sub: 'user-1', email: 'a@test.dev' });
    expect(throttleTracker({ ip: '10.0.0.1', headers: { authorization: `Bearer ${token}` } })).toBe('u:user-1');
    expect(throttleTracker({ ip: '10.0.0.2', headers: { authorization: `Bearer ${token}` } })).toBe('u:user-1');
  });

  it('без токена, с чужой подписью или просроченный — bucket по IP', () => {
    expect(throttleTracker({ ip: '10.0.0.1', headers: {} })).toBe('ip:10.0.0.1');
    expect(throttleTracker({ ip: '10.0.0.1' })).toBe('ip:10.0.0.1');
    const forged = new JwtService({ secret: 'someone-else' }).sign({ sub: 'user-1' });
    expect(throttleTracker({ ip: '10.0.0.2', headers: { authorization: `Bearer ${forged}` } })).toBe('ip:10.0.0.2');
    const expired = jwt.sign({ sub: 'user-1' }, { expiresIn: -10 });
    expect(throttleTracker({ ip: '10.0.0.3', headers: { authorization: `Bearer ${expired}` } })).toBe('ip:10.0.0.3');
    expect(throttleTracker({ ip: '10.0.0.4', headers: { authorization: 'Bearer not-a-jwt' } })).toBe('ip:10.0.0.4');
  });
});
