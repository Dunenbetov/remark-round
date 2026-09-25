/**
 * Railway, Infrastructure as Code (runbook: docs/PROD-RAILWAY.md).
 *
 * Те же сервисы, что заводятся в UI по шагам runbook: postgres (pgvector), api, web; mcp по желанию.
 * Применяется НЕ на git push, а из Railway CLI: `railway config plan` (показать разницу с выбранным окружением)
 * и `railway config apply` (применить после подтверждения). Нужен CLI с командой `config` (4.58 ее еще не знает,
 * `npm i -g @railway/cli`). Файл справочный: если в UI уже все настроено, применять его не обязательно.
 *
 * Почему не railway.json: по docs.railway.com/infrastructure-as-code "New services cannot opt into Config as Code",
 * старые railway.json/railway.toml перестают читаться 2026-12-01. Чего этот DSL не умеет (справочник на 17.09.2026)
 * и что задается в UI: путь к Dockerfile (здесь через переменную RAILWAY_DOCKERFILE_PATH),
 * Restart Policy, "Wait for CI". Секреты через preserve(): остаются те, что введены в UI, в коде их нет.
 *
 * Watch Paths DSL умеет (`build: { watchPatterns }`, пакет railway 3.11). На бою они заданы 18.09 (P2) не через
 * `railway config apply`, а мутацией `environmentStageChanges` + `environmentPatchCommitStaged(skipDeploys: true)`
 * через `railway api`: `railway environment edit --service-config api build.watchPatterns …` в CLI 5.57.9 отвечает
 * "No changes to apply" на любой путь. Здесь зеркало боевых значений; синтаксис .gitignore, пути от корня
 * репозитория с ведущим `/`. Список: все, что COPY берет в apps/<сервис>/Dockerfile.
 */
import { defineRailway, github, image, preserve, project, service, volume } from 'railway/iac';

const REPO = 'Dunenbetov/remark-round';
// Ближайший к Казахстану регион Railway: все три сервиса и тома в Амстердаме
const REGION = { 'europe-west4-drams3a': 1 };

export default defineRailway(() => {
  // Postgres 17 + pgvector, тот же образ, что в docker-compose.yml: миграция init делает CREATE EXTENSION vector,
  // а официальный шаблон Postgres Railway расширений не содержит. PGDATA в подкаталоге: в корне тома лежит lost+found,
  // и initdb отказывается инициализировать непустой каталог
  const postgresData = volume('postgres-data', { sizeMB: 2048, region: 'europe-west4-drams3a' });
  const postgres = service('postgres', {
    source: image('pgvector/pgvector:pg17'),
    replicas: REGION,
    volumeMounts: { '/var/lib/postgresql/data': postgresData },
    env: {
      POSTGRES_USER: 'remarkround',
      POSTGRES_PASSWORD: preserve(),
      POSTGRES_DB: 'remarkround',
      PGDATA: '/var/lib/postgresql/data/pgdata',
    },
  });

  // API: один инстанс (семафоры графа и presence WS в памяти процесса), replicas всегда 1.
  // Миграции при старте (MIGRATE_ON_START=true): с одним инстансом это безопасно, отдельного шага `run api migrate`
  // на Railway нет. Healthcheck ждет до 300 с, первый старт прогоняет все миграции.
  const apiStorage = volume('api-storage', { sizeMB: 2048, region: 'europe-west4-drams3a' });
  const api = service('api', {
    // checkSuites = "Wait for CI": деплой только после зеленого workflow ci (без него apply выключил бы ожидание)
    source: github(REPO, { branch: 'main', checkSuites: true }),
    // Коммит только в docs/ или apps/web не пересобирает api (Railway пишет SKIPPED) и не рвет WebSocket пользователям
    build: { watchPatterns: ['/apps/api/**', '/packages/db/**', '/skills/**', '/fixtures/**', '/package.json', '/pnpm-lock.yaml', '/pnpm-workspace.yaml', '/.npmrc'] },
    healthcheck: '/api/v1/health',
    healthcheckTimeout: 300,
    replicas: REGION,
    volumeMounts: { '/app/apps/api/storage': apiStorage },
    env: {
      RAILWAY_DOCKERFILE_PATH: 'apps/api/Dockerfile',
      // Том монтируется root'ом, образ работает от пользователя node, без этого EACCES на записи кадров
      RAILWAY_RUN_UID: '0',
      PORT: '3000',
      // Внутренняя сеть, не публичный прокси: без счетчика трафика и без TLS-накладных
      DATABASE_URL:
        'postgresql://remarkround:${{postgres.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/remarkround?connection_limit=25&pool_timeout=20',
      JWT_SECRET: preserve(),
      JWT_EXPIRES_SECONDS: '86400',
      WEB_ORIGIN: preserve(), // https://<домен web>, известен после "Generate Domain" у web
      ADMIN_EMAILS: preserve(),
      // Регистрация открыта для любого e-mail (ADR 006); проекты создает тот, кому администратор выдал право
      REGISTRATION_MODE: 'open',
      OPENAI_API_KEY: preserve(),
      STORAGE_DIR: '/app/apps/api/storage',
      MIGRATE_ON_START: 'true',
      SEED_ON_START: 'false',
      // nginx (web) шлет один адрес клиента после realip, один hop, как в compose
      TRUST_PROXY_HOPS: '1',
      IMPORT_MAX_ROWS: '100',
      IMPORT_MAX_BYTES: '5242880',
      // Langfuse Cloud (EU) и Sentry (EU) включены на проде с 18.09, ключи только в UI (preserve).
      // Проверка, что span'ы доезжают: /health → tracing: on (не degraded) и трейс по ссылке с карточки (PROD-RAILWAY.md)
      LANGFUSE_TRACING_ENABLED: 'true',
      LANGFUSE_BASE_URL: 'https://cloud.langfuse.com',
      LANGFUSE_PUBLIC_URL: 'https://cloud.langfuse.com',
      LANGFUSE_TRACING_ENVIRONMENT: 'production',
      LANGFUSE_PROJECT_ID: preserve(),
      LANGFUSE_PUBLIC_KEY: preserve(),
      LANGFUSE_SECRET_KEY: preserve(),
      SENTRY_DSN: preserve(),
      SENTRY_DSN_WEB: preserve(), // DSN для SPA: web получает его от api (GET /auth/options)
      SENTRY_ENVIRONMENT: preserve(),
      // Том 5 ГБ: порог "кончается место" ниже дефолтных 2 ГБ, квота проекта 1 ГБ
      STORAGE_MIN_FREE_MB: '512',
      STORAGE_QUOTA_MB_PER_PROJECT: '1024',
      GIT_SHA: '${{RAILWAY_GIT_COMMIT_SHA}}',
    },
  });

  // SPA + nginx: публичный домен, /api и /api/v1/ws идут в api по приватной сети (apps/web/nginx.conf.template)
  const web = service('web', {
    // checkSuites = "Wait for CI": деплой только после зеленого workflow ci (без него apply выключил бы ожидание)
    source: github(REPO, { branch: 'main', checkSuites: true }),
    build: { watchPatterns: ['/apps/web/**', '/package.json', '/pnpm-lock.yaml', '/pnpm-workspace.yaml', '/.npmrc'] },
    healthcheck: '/',
    replicas: REGION,
    env: {
      RAILWAY_DOCKERFILE_PATH: 'apps/web/Dockerfile',
      PORT: '80',
      API_UPSTREAM: '${{api.RAILWAY_PRIVATE_DOMAIN}}:3000',
      // Контейнер достижим только через edge-прокси Railway, а он сам стирает X-Forwarded-For клиента:
      // верить любому адресу безопасно, и лимит входа считается по настоящему IP (R-H5)
      REAL_IP_FROM: '0.0.0.0/0 ::/0',
      // Куда SPA шлет ошибки: регион EU Sentry; без этого CSP connect-src 'self' блокирует отправку из браузера
      CSP_CONNECT_SRC: 'https://*.ingest.de.sentry.io',
      GIT_SHA: '${{RAILWAY_GIT_COMMIT_SHA}}',
    },
  });

  return project('remark-round', { resources: [postgres, api, web] });
});
