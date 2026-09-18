/**
 * Railway — Infrastructure as Code (runbook: docs/PROD-RAILWAY.md; задача A2 в docs/BETA-REVIEW.md).
 *
 * Те же сервисы, что владелец заводит в UI по шагам runbook'а: postgres (pgvector), api, web, backup (cron, шаг 9); mcp — по желанию.
 * Применяется НЕ на git push, а из Railway CLI: `railway config plan` (показать разницу с выбранным окружением)
 * → `railway config apply` (применить после подтверждения). Нужен CLI с командой `config` (4.58 её ещё не знает —
 * `npm i -g @railway/cli`). Файл справочный: если руками в UI уже всё настроено, применять его не обязательно.
 *
 * Почему не railway.json: по docs.railway.com/infrastructure-as-code «New services cannot opt into Config as Code»,
 * старые railway.json/railway.toml перестают читаться 2026-12-01. Чего этот DSL не умеет (справочник на 17.09.2026)
 * и что задаётся в UI: путь к Dockerfile (здесь — через переменную RAILWAY_DOCKERFILE_PATH), Watch Paths,
 * Restart Policy, «Wait for CI». Секреты — preserve(): остаются те, что введены в UI, в коде их нет.
 */
import { defineRailway, github, image, preserve, project, service, volume } from 'railway/iac';

const REPO = 'Dunenbetov/remark-round';
// Ближайший к Казахстану регион Railway (решение владельца 17.09): все три сервиса и тома — в Амстердаме
const REGION = { 'europe-west4-drams3a': 1 };

export default defineRailway(() => {
  // Postgres 17 + pgvector — тот же образ, что в docker-compose.yml: миграция init делает CREATE EXTENSION vector,
  // а официальный шаблон Postgres Railway расширений не содержит. PGDATA — подкаталог: в корне тома лежит lost+found,
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

  // API: один инстанс (семафоры графа и presence WS в памяти процесса, R-M1) — replicas всегда 1.
  // Миграции при старте (MIGRATE_ON_START=true): с одним инстансом это безопасно, отдельного шага `run api migrate`
  // на Railway нет. Healthcheck ждёт до 300 с — первый старт прогоняет все миграции.
  const apiStorage = volume('api-storage', { sizeMB: 2048, region: 'europe-west4-drams3a' });
  const api = service('api', {
    source: github(REPO, { branch: 'main' }),
    healthcheck: '/api/v1/health',
    healthcheckTimeout: 300,
    replicas: REGION,
    volumeMounts: { '/app/apps/api/storage': apiStorage },
    env: {
      RAILWAY_DOCKERFILE_PATH: 'apps/api/Dockerfile',
      // Том монтируется root'ом, образ работает от пользователя node — без этого EACCES на записи кадров
      RAILWAY_RUN_UID: '0',
      PORT: '3000',
      // Внутренняя сеть, не публичный прокси: без счётчика трафика и без TLS-накладных
      DATABASE_URL:
        'postgresql://remarkround:${{postgres.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/remarkround?connection_limit=25&pool_timeout=20',
      JWT_SECRET: preserve(),
      JWT_EXPIRES_SECONDS: '86400',
      WEB_ORIGIN: preserve(), // https://<домен web> — известен после «Generate Domain» у web
      ADMIN_EMAILS: preserve(),
      OPENAI_API_KEY: preserve(),
      STORAGE_DIR: '/app/apps/api/storage',
      MIGRATE_ON_START: 'true',
      SEED_ON_START: 'false',
      // nginx (web) шлёт один адрес клиента после realip — один hop, как в compose
      TRUST_PROXY_HOPS: '1',
      IMPORT_MAX_ROWS: '100',
      IMPORT_MAX_BYTES: '5242880',
      // Первый запуск без трейсов; Langfuse Cloud (LANGFUSE_BASE_URL + ключи) и Sentry — отдельным шагом runbook'а
      LANGFUSE_TRACING_ENABLED: 'false',
      // Том 5 ГБ: порог «кончается место» ниже дефолтных 2 ГБ, квота проекта 1 ГБ (R-H4)
      STORAGE_MIN_FREE_MB: '512',
      STORAGE_QUOTA_MB_PER_PROJECT: '1024',
      // Суточная копия файлов тома в Backblaze B2 (A3; те же значения, что B2_* у сервиса backup). Все четыре или ни одной
      OFFSITE_B2_BUCKET: preserve(),
      OFFSITE_B2_ENDPOINT: preserve(),
      OFFSITE_B2_KEY_ID: preserve(),
      OFFSITE_B2_APP_KEY: preserve(),
      GIT_SHA: '${{RAILWAY_GIT_COMMIT_SHA}}',
    },
  });

  // SPA + nginx: публичный домен, /api и /api/v1/ws — в api по приватной сети (apps/web/nginx.conf.template)
  const web = service('web', {
    source: github(REPO, { branch: 'main' }),
    healthcheck: '/',
    replicas: REGION,
    env: {
      RAILWAY_DOCKERFILE_PATH: 'apps/web/Dockerfile',
      PORT: '80',
      API_UPSTREAM: '${{api.RAILWAY_PRIVATE_DOMAIN}}:3000',
      // Контейнер достижим только через edge-прокси Railway, а он сам стирает X-Forwarded-For клиента:
      // верить любому адресу безопасно, и лимит входа считается по настоящему IP (R-H5)
      REAL_IP_FROM: '0.0.0.0/0 ::/0',
      // Куда SPA шлёт ошибки: регион EU Sentry; без этого CSP connect-src 'self' блокирует отправку из браузера
      CSP_CONNECT_SRC: 'https://*.ingest.de.sentry.io',
      GIT_SHA: '${{RAILWAY_GIT_COMMIT_SHA}}',
    },
  });

  // Бэкап базы вне Railway (A3, R-M3; docs/PROD-RAILWAY.md, шаг 9): cron-сервис — контейнер стартует по расписанию,
  // apps/backup/backup.sh делает pg_dump → Backblaze B2 (s3:<бакет>/db/) и завершается; ненулевой код = failed-запуск.
  // Расписание в UTC: 21:00 UTC = 02:00 Asia/Almaty. Тома нет (том монтируется только в один сервис — файлы хранилища
  // копирует сам api, переменные OFFSITE_B2_* ниже по тем же значениям), healthcheck'а нет — сервис не слушает порт.
  const backup = service('backup', {
    source: github(REPO, { branch: 'main' }),
    replicas: REGION,
    // NEVER: упавший запуск не перезапускается по кругу — следующая попытка завтра по расписанию, а failed виден в Deployments
    deploy: { cronSchedule: '0 21 * * *', restartPolicyType: 'NEVER' },
    env: {
      RAILWAY_DOCKERFILE_PATH: 'apps/backup/Dockerfile',
      // Как у api, но без параметров пула Prisma: pg_dump (libpq) их не понимает
      DATABASE_URL: 'postgresql://remarkround:${{postgres.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/remarkround',
      B2_BUCKET: preserve(),
      B2_ENDPOINT: preserve(), // s3.<регион>.backblazeb2.com — со страницы бакета в Backblaze
      B2_KEY_ID: preserve(),
      B2_APP_KEY: preserve(),
      BACKUP_KEEP_DAYS: '30',
    },
  });

  return project('remark-round', { resources: [postgres, api, web, backup] });
});
