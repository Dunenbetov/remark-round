/**
 * Копия файлов (документы, кадры) вне сервера — чистая часть: что включено и с какими аргументами зовётся rclone.
 * Задача A3, аудит R-M3. Том Railway монтируется только в один сервис, поэтому файлы копирует сам api, а не cron-сервис
 * `backup` (тот делает pg_dump, apps/backup). Секреты уходят в rclone только через окружение дочернего процесса
 * (RCLONE_CONFIG_B2_*): ни в аргументах (их видно в `ps`), ни на диске, ни в логах их нет.
 */

/** Четыре переменные: заданы все — копия включена, ни одной — выключена, часть — ошибка конфигурации (config.ts). */
export const OFFSITE_KEYS = ['OFFSITE_B2_BUCKET', 'OFFSITE_B2_ENDPOINT', 'OFFSITE_B2_KEY_ID', 'OFFSITE_B2_APP_KEY'] as const;
export type OffsiteKey = (typeof OFFSITE_KEYS)[number];
export type OffsiteEnv = Partial<Record<OffsiteKey, string | undefined>>;

export interface OffsiteSettings {
  bucket: string;
  endpoint: string;
  keyId: string;
  appKey: string;
}

/** Каких из четырёх переменных не хватает; пусто — заданы все либо ни одной. */
export function offsiteMissing(env: OffsiteEnv): OffsiteKey[] {
  const missing = OFFSITE_KEYS.filter((k) => !env[k]);
  return missing.length === OFFSITE_KEYS.length ? [] : missing;
}

export function offsiteSettings(env: OffsiteEnv): OffsiteSettings | null {
  if (OFFSITE_KEYS.some((k) => !env[k])) return null;
  return { bucket: env.OFFSITE_B2_BUCKET!, endpoint: env.OFFSITE_B2_ENDPOINT!, keyId: env.OFFSITE_B2_KEY_ID!, appKey: env.OFFSITE_B2_APP_KEY! };
}

/** `s3.eu-central-003.backblazeb2.com` → `eu-central-003`: регион для подписи запросов; у других хранилищ — по умолчанию. */
export function b2Region(endpoint: string): string | null {
  return /(?:^|\/\/)s3\.([a-z0-9-]+)\.backblazeb2\.com/i.exec(endpoint)?.[1] ?? null;
}

/**
 * Окружение дочернего rclone: remote `b2` описан целиком переменными. От родителя берём только PATH/HOME —
 * JWT_SECRET и ключ модели дочернему процессу ни к чему.
 */
export function rcloneEnv(s: OffsiteSettings, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const region = b2Region(s.endpoint);
  return {
    PATH: parent['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: parent['HOME'] ?? '/tmp',
    // Файла конфигурации нет: без этого rclone пишет NOTICE «Config file not found» на каждый запуск
    RCLONE_CONFIG: '/dev/null',
    RCLONE_CONFIG_B2_TYPE: 's3',
    RCLONE_CONFIG_B2_PROVIDER: 'Other',
    RCLONE_CONFIG_B2_ENDPOINT: s.endpoint,
    RCLONE_CONFIG_B2_ACCESS_KEY_ID: s.keyId,
    RCLONE_CONFIG_B2_SECRET_ACCESS_KEY: s.appKey,
    RCLONE_CONFIG_B2_FORCE_PATH_STYLE: 'true',
    // Ключ B2 ограничен одним бакетом: проверять или создавать бакет ему нельзя
    RCLONE_CONFIG_B2_NO_CHECK_BUCKET: 'true',
    ...(region ? { RCLONE_CONFIG_B2_REGION: region } : {}),
  };
}

/**
 * `rclone copy` — только дописывает: удалённое на сервере в копии остаётся (это бэкап, а не зеркало).
 * --immutable: файлы хранилища пишутся один раз (StorageService.save, имя — uuid); изменившийся файл — ошибка, а не тихая
 * перезапись копии. --size-only: «тот же файл» — по имени и размеру; время изменения в S3 лежит в метаданных, и его сверка
 * стоила бы отдельного запроса на каждый файл каждый день (у B2 они платные), а после восстановления тома время может сбиться.
 * --min-age: файл, который прямо сейчас пишется, подождёт следующих суток. Секретов в аргументах нет.
 */
export function rcloneArgs(s: Pick<OffsiteSettings, 'bucket'>, storageRoot: string): string[] {
  return [
    'copy',
    storageRoot,
    `b2:${s.bucket}/storage`,
    '--immutable',
    '--size-only',
    '--min-age',
    '1m',
    '--transfers',
    '8',
    '--retries',
    '3',
    '--contimeout',
    '30s',
    '--timeout',
    '5m',
    // Итоговая сводка (Transferred / Checks / Errors) — один раз в конце: интервал больше любого прохода
    // (при `--stats 0` rclone не печатает сводку успешного прохода вовсе)
    '--stats',
    '1000h',
    '--stats-log-level',
    'NOTICE',
  ];
}

export interface RcloneCounts {
  /** Сколько файлов загружено в этот проход. */
  copied: number;
  /** Сколько файлов уже были в копии (сверены и пропущены). */
  checked: number;
  errors: number;
}

/** Числа из итоговой сводки rclone; строка объёма («1.2 MiB / 1.2 MiB») под шаблон файлов не подходит. */
export function parseRcloneStats(output: string): RcloneCounts {
  const num = (re: RegExp) => Number(re.exec(output)?.[1] ?? 0);
  return { copied: num(/Transferred:\s+(\d+) \/ \d+, \d+%/), checked: num(/Checks:\s+(\d+) \/ \d+/), errors: num(/Errors:\s+(\d+)/) };
}
