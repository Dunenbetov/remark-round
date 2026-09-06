import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('хеш проверяется, чужой пароль — нет', async () => {
    const stored = await hashPassword('secret-1');
    expect(stored.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('secret-1', stored)).resolves.toBe(true);
    await expect(verifyPassword('secret-2', stored)).resolves.toBe(false);
  });

  it('без пароля (null) и кривой формат — false, не исключение', async () => {
    await expect(verifyPassword('x', null)).resolves.toBe(false);
    await expect(verifyPassword('x', undefined)).resolves.toBe(false);
    await expect(verifyPassword('x', 'md5$abc$def')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$$')).resolves.toBe(false);
  });

  it('две соли — два разных хеша одного пароля', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});
