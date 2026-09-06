import { parseConfig } from './config';

const base = { DATABASE_URL: 'postgresql://remarkround@localhost/remarkround', JWT_SECRET: 'change-me' };

describe('config', () => {
  it('development: дефолтный секрет допустим, демо-входы включены, дефолты на месте', () => {
    const c = parseConfig({ ...base, NODE_ENV: 'development' });
    expect(c.isProduction).toBe(false);
    expect(c.demoLogins).toBe(true);
    expect(c.JWT_EXPIRES_SECONDS).toBe(12 * 3600);
    expect(c.THROTTLE_LIMIT).toBe(1200);
    expect(c.TRUST_PROXY_HOPS).toBe(0);
  });

  it('production: дефолтный или короткий секрет — ошибка с именем переменной', () => {
    expect(() => parseConfig({ ...base, NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    expect(() => parseConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: 'short-secret' })).toThrow(/JWT_SECRET/);
  });

  it('production с настоящим секретом: демо-входов нет; DEMO_LOGINS переопределяет в любую сторону', () => {
    const secret = 'a'.repeat(32);
    const prod = parseConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: secret, WEB_ORIGIN: 'https://rr.example' });
    expect(prod.isProduction).toBe(true);
    expect(prod.demoLogins).toBe(false);
    expect(parseConfig({ ...base, NODE_ENV: 'development', DEMO_LOGINS: 'false' }).demoLogins).toBe(false);
    expect(parseConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: secret, DEMO_LOGINS: 'true' }).demoLogins).toBe(true);
  });

  it('контур доступа (ADR 006): режим регистрации по NODE_ENV, домены и администраторы нормализуются', () => {
    const secret = 'a'.repeat(32);
    expect(parseConfig({ ...base, NODE_ENV: 'development' }).registrationMode).toBe('open');
    expect(parseConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: secret }).registrationMode).toBe('invite_only');
    expect(parseConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: secret, REGISTRATION_MODE: 'open' }).registrationMode).toBe('open');
    expect(() => parseConfig({ ...base, REGISTRATION_MODE: 'closed' })).toThrow(/REGISTRATION_MODE/);
    const c = parseConfig({ ...base, REGISTRATION_DOMAINS: ' @Company.KZ, partner.ru,, ', ADMIN_EMAILS: 'CTO@Company.kz , it@company.kz' });
    expect(c.registrationDomains).toEqual(['company.kz', 'partner.ru']);
    expect([...c.adminEmails]).toEqual(['cto@company.kz', 'it@company.kz']);
    expect(parseConfig(base).adminEmails.size).toBe(0);
  });

  it('несколько проблем перечисляются разом', () => {
    expect(() => parseConfig({ NODE_ENV: 'development', JWT_SECRET: '' })).toThrow(/DATABASE_URL[\s\S]*JWT_SECRET/);
  });
});
