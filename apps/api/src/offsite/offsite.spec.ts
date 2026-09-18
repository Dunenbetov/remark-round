import { parseConfig } from '../config';
import { b2Region, offsiteMissing, offsiteSettings, parseRcloneStats, rcloneArgs, rcloneEnv } from './offsite';

const all = { OFFSITE_B2_BUCKET: 'rr-backup-x1', OFFSITE_B2_ENDPOINT: 's3.eu-central-003.backblazeb2.com', OFFSITE_B2_KEY_ID: '003abc', OFFSITE_B2_APP_KEY: 'K003-secret-value' };
const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 'x' };

describe('offsite: копия файлов вне сервера (A3) — чистая часть, rclone не зовётся', () => {
  it('всё или ничего: все четыре — включено, ни одной — выключено, часть — перечислены недостающие', () => {
    expect(offsiteSettings(all)).toEqual({ bucket: 'rr-backup-x1', endpoint: 's3.eu-central-003.backblazeb2.com', keyId: '003abc', appKey: 'K003-secret-value' });
    expect(offsiteSettings({})).toBeNull();
    expect(offsiteMissing({})).toEqual([]);
    expect(offsiteMissing(all)).toEqual([]);
    expect(offsiteMissing({ ...all, OFFSITE_B2_APP_KEY: undefined })).toEqual(['OFFSITE_B2_APP_KEY']);
    expect(offsiteSettings({ ...all, OFFSITE_B2_APP_KEY: undefined })).toBeNull();
  });

  it('config: половина настроек — ошибка старта с именами переменных; пустые строки compose = не задано', () => {
    expect(() => parseConfig({ ...base, OFFSITE_B2_BUCKET: 'b', OFFSITE_B2_ENDPOINT: 'e' })).toThrow(/OFFSITE_B2_KEY_ID: копия файлов вне сервера настроена наполовину[\s\S]*OFFSITE_B2_APP_KEY/);
    expect(() => parseConfig({ ...base, OFFSITE_B2_BUCKET: 'b', OFFSITE_B2_ENDPOINT: 'e' })).not.toThrow(/OFFSITE_B2_BUCKET:/);
    expect(offsiteSettings(parseConfig({ ...base, OFFSITE_B2_BUCKET: '', OFFSITE_B2_ENDPOINT: '', OFFSITE_B2_KEY_ID: '', OFFSITE_B2_APP_KEY: '' }))).toBeNull();
    expect(offsiteSettings(parseConfig({ ...base, ...all }))?.bucket).toBe('rr-backup-x1');
  });

  it('секреты — только в окружении rclone: в аргументах их нет, от родителя берутся лишь PATH и HOME', () => {
    const s = offsiteSettings(all)!;
    const args = rcloneArgs(s, '/app/apps/api/storage');
    expect(args.slice(0, 3)).toEqual(['copy', '/app/apps/api/storage', 'b2:rr-backup-x1/storage']);
    expect(args).toEqual(expect.arrayContaining(['--immutable', '--size-only']));
    expect(args.join(' ')).not.toContain(all.OFFSITE_B2_APP_KEY);
    expect(args.join(' ')).not.toContain(all.OFFSITE_B2_KEY_ID);
    // Копия, а не зеркало: удалённое на сервере в бакете остаётся
    expect(args).not.toContain('sync');

    const env = rcloneEnv(s, { PATH: '/bin', HOME: '/home/node', JWT_SECRET: 'must-not-leak', OPENAI_API_KEY: 'sk-must-not-leak' });
    expect(env).toMatchObject({
      PATH: '/bin',
      HOME: '/home/node',
      RCLONE_CONFIG_B2_TYPE: 's3',
      RCLONE_CONFIG_B2_PROVIDER: 'Other',
      RCLONE_CONFIG_B2_ENDPOINT: 's3.eu-central-003.backblazeb2.com',
      RCLONE_CONFIG_B2_ACCESS_KEY_ID: '003abc',
      RCLONE_CONFIG_B2_SECRET_ACCESS_KEY: 'K003-secret-value',
      RCLONE_CONFIG_B2_REGION: 'eu-central-003',
    });
    expect(Object.keys(env).filter((k) => !k.startsWith('RCLONE_')).sort()).toEqual(['HOME', 'PATH']);
  });

  it('регион берётся из адреса B2; у прочих S3 (MinIO на стенде) его нет', () => {
    expect(b2Region('https://s3.us-west-004.backblazeb2.com')).toBe('us-west-004');
    expect(b2Region('http://minio:9000')).toBeNull();
    expect(rcloneEnv({ ...offsiteSettings(all)!, endpoint: 'http://minio:9000' }, {})['RCLONE_CONFIG_B2_REGION']).toBeUndefined();
  });

  it('сводка rclone → числа для строки лога; строка объёма не путается со строкой файлов', () => {
    const out = ['Transferred:   \t  235.359 KiB / 235.359 KiB, 100%, 0 B/s, ETA -', 'Checks:                12 / 12, 100%', 'Transferred:            3 / 3, 100%', 'Elapsed time:         0.1s'].join('\n');
    expect(parseRcloneStats(out)).toEqual({ copied: 3, checked: 12, errors: 0 });
    expect(parseRcloneStats('Transferred:   \t          0 B / 0 B, -, 0 B/s, ETA -\nErrors:                 2 (retrying may help)\nElapsed time: 1s')).toEqual({ copied: 0, checked: 0, errors: 2 });
    expect(parseRcloneStats('')).toEqual({ copied: 0, checked: 0, errors: 0 });
  });
});
