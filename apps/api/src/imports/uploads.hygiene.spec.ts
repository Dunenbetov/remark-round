/**
 * uploads.hygiene.spec — аудит: uploads-validation-parsers, empty-index-scanned-pdf, unbounded-text-into-prompt.
 * Файлы «с той стороны» проверяются по содержимому, а не по расширению; документ без текста — failed, не indexed;
 * слишком длинная ячейка журнала уходит человеку, а не в промпт.
 */
import { createHarness, type Harness } from '../../test/harness';
import { REASON_TOO_LONG } from './journal-parser';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);

describe('uploads hygiene', () => {
  let h: Harness;
  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  it('кадр: содержимое должно совпасть с расширением — PNG под именем .jpg и exe под .png отвергаются', async () => {
    await h.http.post(url('/media')).set(h.auth('business')).attach('file', PNG, 'shot.png').expect(201);
    await h.http.post(url('/media')).set(h.auth('business')).attach('file', JPEG, 'shot.jpg').expect(201);
    const wrong = await h.http.post(url('/media')).set(h.auth('business')).attach('file', PNG, 'shot.jpg').expect(422);
    expect(wrong.body.message).toMatch(/не похож/);
    await h.http.post(url('/media')).set(h.auth('business')).attach('file', EXE, 'shot.png').expect(422);
  });

  it('документ: текст под именем .pdf и exe под .docx — 422; настоящий markdown — 201', async () => {
    await h.http.post(url('/documents')).set(h.auth('pm')).field('kind', 'spec').attach('file', Buffer.from('# Не PDF\nтекст'), 'tz.pdf').expect(422);
    await h.http.post(url('/documents')).set(h.auth('pm')).field('kind', 'spec').attach('file', EXE, 'tz.docx').expect(422);
    const ok = await h.http.post(url('/documents')).set(h.auth('pm')).field('kind', 'addendum').attach('file', Buffer.from('# Доп\n\n## 1. Пункт\nТекст пункта.'), 'add.md').expect(201);
    expect(ok.body.status).toBe('uploaded');
  });

  it('документ без извлекаемого текста получает статус failed, а не indexed с нулём фрагментов', async () => {
    const res = await h.http.post(url('/documents')).set(h.auth('pm')).field('kind', 'protocol').attach('file', Buffer.from('   \n\n  \n'), 'empty.txt').expect(201);
    let status = '';
    for (let i = 0; i < 50 && status !== 'failed' && status !== 'indexed'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = (await h.http.get(url(`/documents/${res.body.id}`)).set(h.auth('pm')).expect(200)).body.status;
    }
    expect(status).toBe('failed');
  });

  it('журнал: csv с бинарным содержимым — 422; ячейка длиннее лимита → needs_human_parse с причиной, текст сохранён в строке импорта', async () => {
    await h.http.post(url('/imports')).set(h.auth('pm')).field('roundId', h.roundId).attach('file', EXE, 'journal.csv').expect(422);
    await h.http.post(url('/imports')).set(h.auth('pm')).field('roundId', h.roundId).attach('file', Buffer.from('not a zip'), 'journal.xlsx').expect(422);

    const long = 'очень длинное описание '.repeat(120);
    const csv = `external_id,page_or_screen,description,expected,severity,screenshot\n1,Главная,${long},,,\n2,Главная,Обычное замечание,,,\n`;
    const job = await h.http.post(url('/imports')).set(h.auth('pm')).field('roundId', h.roundId).attach('file', Buffer.from(csv, 'utf8'), 'journal.csv').expect(201);
    const rows = job.body.rows as Array<{ rowNumber: number; status: string; reason?: string; remarkId?: string }>;
    const first = rows.find((r) => r.rowNumber === 2)!;
    expect(first.status).toBe('needs_human_parse');
    expect(first.reason).toBe(REASON_TOO_LONG);
    const remark = await h.prisma.remark.findUniqueOrThrow({ where: { id: first.remarkId! } });
    expect(remark.description.length).toBeLessThanOrEqual(2000);
    const stored = await h.prisma.importRow.findFirstOrThrow({ where: { jobId: job.body.id, rowNumber: 2 } });
    expect((stored.rawJson as { description: string }).description.length).toBe(long.trim().length);
    const parsed = rows.find((r) => r.rowNumber === 3)!;
    expect(parsed.status).toBe('parsed');
    // Импорт запускает разбор в фоне: дождаться, чтобы cleanup не догнал бегущий прогон
    await h.waitFor(parsed.remarkId!, ['awaiting_pm', 'cannot_tell'], 'pm');
  });
});
