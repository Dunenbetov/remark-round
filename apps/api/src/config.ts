/**
 * Конфиг процесса API: читается один раз и проверяется zod'ом до старта Nest (фаза 11).
 * Демо и прод различает NODE_ENV: в образе api он production, но базовый docker-compose.yml ставит
 * development (демо-стенд: seed, карточки ролей на входе), а docker-compose.prod.yml — production.
 * В production JWT_SECRET обязан быть настоящим, seed отказывается работать, демо-входов нет.
 * Остальные переменные (LLM, Langfuse, STORAGE_DIR) читаются на месте — им fail-fast не нужен.
 */
import { z } from 'zod';

const Schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
    JWT_SECRET: z.string().min(1, 'JWT_SECRET обязателен'),
    JWT_EXPIRES_SECONDS: z.coerce.number().int().positive().default(12 * 3600),
    MCP_TOKEN_EXPIRES_SECONDS: z.coerce.number().int().positive().default(30 * 24 * 3600),
    WEB_ORIGIN: z.string().url().default('http://localhost:4200'),
    /** Карточки демо-персон на входе. Без значения: включены везде, кроме production. */
    DEMO_LOGINS: z.enum(['true', 'false']).optional(),
    /** Сколько прокси перед API (nginx в демо — 1, Caddy → nginx в проде — 2): от этого зависит req.ip для лимитов. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    /** Запросов в минуту с одного IP: общий лимит и строгий для входа/регистрации. */
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(1200),
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(30),
    SEED_FORCE: z.string().optional(),
    /**
     * Кто может зарегистрироваться сам (ADR 006). Без значения: в production — только по ссылке приглашения,
     * иначе (демо, тесты) — открыто. Администраторы инстанса регистрируются всегда — так появляется первый человек.
     */
    REGISTRATION_MODE: z.enum(['open', 'invite_only']).optional(),
    /** Домены, с которых регистрация разрешена и без приглашения (сотрудники компании): `company.kz,company.ru`. */
    REGISTRATION_DOMAINS: z.string().optional(),
    /** Администраторы инстанса по e-mail через запятую: отключают людей, выдают право создавать проекты. */
    ADMIN_EMAILS: z.string().optional(),
    /** Версия сборки из образа (ARG GIT_SHA → ENV APP_VERSION); отдаётся в /health. */
    APP_VERSION: z.string().default('dev'),
    /**
     * Ключ модели читается в LlmModule на месте, здесь — только для fail-fast: в production без ключа процесс не стартует,
     * если владелец не подтвердил режим правил явно (LLM_MODE=rules). Тихий переход на правила — аудит «silent-rules-fallback».
     */
    OPENAI_API_KEY: z.string().optional(),
    LLM_MODE: z.enum(['openai', 'rules']).optional(),
    LANGFUSE_SECRET_KEY: z.string().optional(),
    LANGFUSE_TRACING_ENABLED: z.string().optional(),
    /** Почта (ADR 009): smtp://user:pass@host:587 или smtps://…:465. Без значения писем нет — приглашения только ссылкой. */
    SMTP_URL: z.string().optional(),
    SMTP_FROM: z.string().default('RemarkRound <no-reply@localhost>'),
    /** Окно, за которое уведомления одного человека склеиваются в одно письмо (мс). */
    NOTIFY_DIGEST_MS: z.coerce.number().int().min(0).default(5 * 60 * 1000),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV !== 'production') return;
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (c.JWT_SECRET.length < 32 || PLACEHOLDERS.has(c.JWT_SECRET)) issue('JWT_SECRET', 'в production нужен секрет не короче 32 символов (openssl rand -hex 32)');
    // Пароль БД из демо-compose (remarkround:remarkround) в проде — забытый .env, а не выбор
    if (/:\/\/[^:\/]+:(remarkround|postgres|change-me[^@]*)@/.test(c.DATABASE_URL)) issue('DATABASE_URL', 'в production пароль БД не может быть демо-значением');
    if (c.LANGFUSE_TRACING_ENABLED !== 'false' && c.LANGFUSE_SECRET_KEY && PLACEHOLDERS.has(c.LANGFUSE_SECRET_KEY)) {
      issue('LANGFUSE_SECRET_KEY', 'в production ключи Langfuse не могут быть локальными плейсхолдерами');
    }
    if (!c.OPENAI_API_KEY && c.LLM_MODE !== 'rules') {
      issue('OPENAI_API_KEY', 'в production нужен ключ модели; режим правил без модели включается только явно: LLM_MODE=rules');
    }
  });

/** Значения из .env.example и docker-compose.yml, которые никогда не должны доехать до прода. */
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  'change-me',
  'change-me-local-dev',
  'remarkround',
  'sk-lf-remarkround-local',
  'pk-lf-remarkround-local',
  '0000000000000000000000000000000000000000000000000000000000000000',
]);

export type RegistrationMode = 'open' | 'invite_only';

export type LlmMode = 'openai' | 'rules';

export type AppConfig = z.infer<typeof Schema> & {
  readonly isProduction: boolean;
  /** Чем работает граф: ключ есть — модель, иначе правила по retrieve (в production — только с LLM_MODE=rules). */
  readonly llmMode: LlmMode;
  readonly demoLogins: boolean;
  readonly registrationMode: RegistrationMode;
  /** Нормализованные (lower-case) домены без `@`. */
  readonly registrationDomains: readonly string[];
  /** Нормализованные (lower-case) e-mail администраторов инстанса. */
  readonly adminEmails: ReadonlySet<string>;
  /** SMTP_URL задан: письма отправляются (приглашения, «вас ждёт кнопка»). */
  readonly mailEnabled: boolean;
};

let cached: AppConfig | null = null;

/**
 * Разбор env с понятной ошибкой: перечисляет все проблемные переменные разом, а не первую.
 * Пустая строка = переменная не задана: docker compose подставляет `${VAR:-}` именно так, и для zod
 * `''` — не то же самое, что отсутствие ключа (enum на пустой строке падал бы при каждом старте стенда).
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = Schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Конфигурация API не прошла проверку:\n${lines.join('\n')}`);
  }
  const c = result.data;
  if (c.NODE_ENV === 'production' && !c.WEB_ORIGIN.startsWith('https://')) {
    console.warn(`config: WEB_ORIGIN=${c.WEB_ORIGIN} без https — допустимо только во внутренней сети`);
  }
  return {
    ...c,
    isProduction: c.NODE_ENV === 'production',
    demoLogins: c.DEMO_LOGINS ? c.DEMO_LOGINS === 'true' : c.NODE_ENV !== 'production',
    llmMode: c.OPENAI_API_KEY && c.LLM_MODE !== 'rules' ? 'openai' : 'rules',
    registrationMode: c.REGISTRATION_MODE ?? (c.NODE_ENV === 'production' ? 'invite_only' : 'open'),
    registrationDomains: splitList(c.REGISTRATION_DOMAINS).map((d) => d.replace(/^@/, '')),
    adminEmails: new Set(splitList(c.ADMIN_EMAILS)),
    mailEnabled: Boolean(c.SMTP_URL),
  };
}

/** `a@x.kz, B@Y.kz` → ['a@x.kz', 'b@y.kz']: пробелы и регистр не важны, пустые элементы отбрасываются. */
function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function config(): AppConfig {
  return (cached ??= parseConfig());
}

/** Для тестов: забыть разобранный конфиг после подмены process.env. */
export function resetConfig(): void {
  cached = null;
}
