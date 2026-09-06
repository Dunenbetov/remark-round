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

  it('production: демо-пароль БД, плейсхолдер Langfuse и отсутствие ключа модели без LLM_MODE=rules — ошибки с именем переменной', () => {
    const secret = 'a'.repeat(32);
    const prodBase = { DATABASE_URL: 'postgresql://remarkround:s3cret@postgres:5432/remarkround', JWT_SECRET: secret, NODE_ENV: 'production', OPENAI_API_KEY: 'sk-x' };
    expect(() => parseConfig({ ...prodBase, DATABASE_URL: 'postgresql://remarkround:remarkround@postgres:5432/remarkround' })).toThrow(/DATABASE_URL/);
    expect(() => parseConfig({ ...prodBase, LANGFUSE_SECRET_KEY: 'sk-lf-remarkround-local' })).toThrow(/LANGFUSE_SECRET_KEY/);
    expect(parseConfig({ ...prodBase, LANGFUSE_SECRET_KEY: 'sk-lf-remarkround-local', LANGFUSE_TRACING_ENABLED: 'false' }).isProduction).toBe(true);
    expect(() => parseConfig({ ...prodBase, OPENAI_API_KEY: '' })).toThrow(/OPENAI_API_KEY/);
    expect(parseConfig({ ...prodBase, OPENAI_API_KEY: '', LLM_MODE: 'rules' }).llmMode).toBe('rules');
    expect(parseConfig(prodBase).llmMode).toBe('openai');
    expect(parseConfig({ ...base, NODE_ENV: 'development' }).llmMode).toBe('rules');
    expect(parseConfig({ ...base, APP_VERSION: 'sha-abc' }).APP_VERSION).toBe('sha-abc');
  });

  it('production с настоящим секретом: демо-входов нет; DEMO_LOGINS переопределяет в любую сторону', () => {
    const secret = 'a'.repeat(32);
    const prod = parseConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: secret, WEB_ORIGIN: 'https://rr.example', OPENAI_API_KEY: 'sk-x', DATABASE_URL: 'postgresql://remarkround:s3cret@postgres/remarkround' });
    expect(prod.isProduction).toBe(true);
    expect(prod.demoLogins).toBe(false);
    expect(parseConfig({ ...base, NODE_ENV: 'development', DEMO_LOGINS: 'false' }).demoLogins).toBe(false);
    expect(parseConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: secret, DEMO_LOGINS: 'true', OPENAI_API_KEY: 'sk-x', DATABASE_URL: 'postgresql://remarkround:s3cret@postgres/remarkround' }).demoLogins).toBe(true);
  });

  it('контур доступа (ADR 006): режим регистрации по NODE_ENV, домены и администраторы нормализуются', () => {
    const secret = 'a'.repeat(32);
    expect(parseConfig({ ...base, NODE_ENV: 'development' }).registrationMode).toBe('open');
    const prod = { ...base, NODE_ENV: 'production', JWT_SECRET: secret, OPENAI_API_KEY: 'sk-x', DATABASE_URL: 'postgresql://remarkround:s3cret@postgres/remarkround' };
    expect(parseConfig(prod).registrationMode).toBe('invite_only');
    expect(parseConfig({ ...prod, REGISTRATION_MODE: 'open' }).registrationMode).toBe('open');
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
