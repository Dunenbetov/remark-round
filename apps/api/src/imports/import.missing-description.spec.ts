/**
 * import.missing-description.spec — импорт только официального шаблона (docs/PHASES.md фаза 4).
 * sample-round.csv даёт смесь parsed + needs_human_parse; чужая шапка не маппится; картинка из xlsx
 * становится кадром; строка без описания не уходит в разбор, пока человек её не допишет.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHarness, Harness } from '../../test/harness';
import type { ImportJobView } from './import.dto';
import { JOURNAL_COLUMNS, JOURNAL_HEADER_LINE, TEMPLATE_CSV, newJournalWorkbook } from './journal-template';

const SAMPLE_CSV = readFileSync(resolve(__dirname, '../../../../fixtures/journal/sample-round.csv'));
const SAMPLE_XLSX = readFileSync(resolve(__dirname, '../../../../fixtures/journal/sample-round.xlsx'));
const SAMPLE_RU_CSV = readFileSync(resolve(__dirname, '../../../../fixtures/journal/sample-round.ru.csv'));
const PNG = readFileSync(resolve(__dirname, '../../../../fixtures/screenshots/before-save-gray.png'));

describe('import: официальный шаблон журнала', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(() => h.cleanup());

  const upload = (role: 'business' | 'pm' | 'developer', file: Buffer, name: string, projectId = h.projectId, roundId = h.roundId) =>
    h.http.post(`/api/v1/projects/${projectId}/imports`).set(h.auth(role)).field('roundId', roundId).attach('file', file, name);

  async function settled(jobId: string): Promise<ImportJobView> {
    for (let i = 0; i < 50; i++) {
      const res = await h.http.get(`/api/v1/projects/${h.projectId}/imports/${jobId}`).set(h.auth('pm')).expect(200);
      const job = res.body as ImportJobView;
      const busy = job.rows.some((r) => r.status === 'parsed' && (r.remarkStatus === 'imported' || r.remarkStatus === 'triaging'));
      if (!busy) return job;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('разбор импорта не закончился');
  }

  it('sample-round.csv: смесь parsed и needs_human_parse, J-04 без описания уходит человеку', async () => {
    const res = await upload('business', SAMPLE_CSV, 'sample-round.csv').expect(201);
    const job = res.body as ImportJobView;
    expect(job.rows).toHaveLength(10);
    expect(job.parsed).toBe(9);
    expect(job.needsHumanParse).toBe(1);

    const j04 = job.rows.find((r) => r.externalId === 'J-04')!;
    expect(j04.status).toBe('needs_human_parse');
    expect(j04.reason).toBe('пустое описание');
    expect(j04.remarkStatus).toBe('needs_human_parse');
    expect(j04.cells.page_or_screen).toBe('Профиль'); // ячейки не теряются

    const j01 = job.rows.find((r) => r.externalId === 'J-01')!;
    expect(j01.status).toBe('parsed');
    expect(j01.screenshotRef).toBe('screenshots/before-save-gray.svg'); // ссылку из CSV не тянем, скрин прикрепят на карточке
    expect(j01.hasScreenshot).toBe(false);

    // Разбор стартует только по распарсенным строкам; строка без описания ждёт человека.
    const done = await settled(job.id);
    for (const row of done.rows) {
      if (row.status === 'parsed') expect(['awaiting_pm', 'cannot_tell']).toContain(row.remarkStatus);
    }
    expect(done.rows.find((r) => r.externalId === 'J-04')!.remarkStatus).toBe('needs_human_parse');
    expect(await h.prisma.agentRun.count({ where: { remarkId: j04.remarkId! } })).toBe(0);

    // Журнал раунда показывает строку как «Допишите строку журнала», а не пустую.
    const list = await h.http.get(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`).set(h.auth('business')).expect(200);
    const imported = list.body.find((r: { id: string }) => r.id === j04.remarkId);
    expect(imported.status).toBe('needs_human_parse');
    expect(imported.title).toBe('Строка J-04 журнала без описания');
    expect(imported.externalId).toBe('J-04');
  });

  it('«Допишите строку журнала»: человек дописал → разбор → awaiting_pm или cannot_tell', async () => {
    const res = await upload('business', Buffer.from(`${JOURNAL_COLUMNS.join(',')}\nX-1,Профиль,,,high,\n`), 'one.csv').expect(201);
    const row = (res.body as ImportJobView).rows[0]!;
    expect(row.status).toBe('needs_human_parse');

    const fixed = await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${row.remarkId}/fix-row`)
      .set(h.auth('business'))
      .send({ description: 'Кнопка «Сохранить» серая при заполненных полях' })
      .expect(200);
    expect(fixed.body.status).toBe('triaging');
    expect(fixed.body.title).toBe('Кнопка «Сохранить» серая при заполненных полях');
    expect(fixed.body.runId).toBeDefined();
    await h.waitFor(row.remarkId!, ['awaiting_pm', 'cannot_tell']);

    // Дописать можно только строку, которая ждёт человека.
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${row.remarkId}/fix-row`)
      .set(h.auth('business'))
      .send({ description: 'ещё раз' })
      .expect(409);
  });

  it('чужая шапка не маппится «как получится»: 422 и ни одного замечания', async () => {
    const before = await h.prisma.remark.count({ where: { projectId: h.projectId } });
    const foreign = Buffer.from('№;Описание;Кто нашёл;Приоритет\n1;Кнопка серая;Айгерим;высокий\n', 'utf8');
    const res = await upload('business', foreign, 'chuzhoy.csv').expect(422);
    expect(res.body.message).toMatch(/не наш шаблон/);
    expect(res.body.message).toMatch(/Что не так/); // колонки в ошибке — русские, как в шаблоне
    expect(res.body.message).not.toMatch(/external_id/);
    expect(await h.prisma.remark.count({ where: { projectId: h.projectId } })).toBe(before);
    expect(await h.prisma.importJob.count({ where: { projectId: h.projectId } })).toBe(2);
  });

  it('xlsx: картинка из ячейки становится кадром замечания, пустое описание → needs_human_parse', async () => {
    const workbook = newJournalWorkbook();
    const sheet = workbook.getWorksheet(1)!;
    sheet.addRow({ external_id: 'X-1', page_or_screen: 'Профиль', description: 'Кнопка «Сохранить» серая', expected: 'Синяя', severity: 'high', screenshot: '' });
    sheet.addRow({ external_id: 'X-2', page_or_screen: 'Оплата', description: '', expected: '', severity: '', screenshot: '' });
    const imageId = workbook.addImage({ buffer: PNG as never, extension: 'png' });
    sheet.addImage(imageId, { tl: { col: 5, row: 1 }, ext: { width: 200, height: 100 } });
    const xlsx = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);

    const res = await upload('pm', xlsx, 'Журнал_раунд.xlsx').expect(201);
    const job = res.body as ImportJobView;
    expect(job.fileName).toBe('Журнал_раунд.xlsx');
    expect(job.rows).toHaveLength(2);
    const [x1, x2] = job.rows;
    expect(x1!.status).toBe('parsed');
    expect(x1!.hasScreenshot).toBe(true);
    expect(x2!.status).toBe('needs_human_parse');

    const shot = await h.prisma.remarkScreenshot.findFirst({ where: { remarkId: x1!.remarkId!, kind: 'original' } });
    expect(shot).not.toBeNull();
    expect(shot!.storageKey.startsWith(`${h.projectId}/`)).toBe(true); // кадр лежит внутри проекта
    expect(shot!.width).toBe(800);
    expect(shot!.height).toBe(400);

    const media = await h.http.get(`/api/v1/projects/${h.projectId}/media/${shot!.storageKey.slice(h.projectId.length + 1)}`).set(h.auth('developer')).expect(200);
    expect(media.headers['content-type']).toMatch(/image\/png/);
  });

  it('fixtures/journal/sample-round.xlsx: те же 10 строк, кадры у J-01, J-06, J-07, J-10', async () => {
    const res = await upload('business', SAMPLE_XLSX, 'sample-round.xlsx').expect(201);
    const job = res.body as ImportJobView;
    expect(job.rows.map((r) => r.externalId)).toEqual(['J-01', 'J-02', 'J-03', 'J-04', 'J-05', 'J-06', 'J-07', 'J-08', 'J-09', 'J-10']);
    expect(job.rows.filter((r) => r.hasScreenshot).map((r) => r.externalId)).toEqual(['J-01', 'J-06', 'J-07', 'J-10']);
    expect(job.needsHumanParse).toBe(1);
    await settled(job.id);
  });

  it('роли и тенанси: developer не импортирует, чужой проект — 404, чужой jobId — 404', async () => {
    await upload('developer', SAMPLE_CSV, 'sample-round.csv').expect(403);
    await upload('business', SAMPLE_CSV, 'sample-round.csv', randomUUID()).expect(404);
    await h.http.get(`/api/v1/projects/${h.projectId}/imports/${randomUUID()}`).set(h.auth('business')).expect(404);
    await upload('business', SAMPLE_CSV, 'sample-round.csv', h.projectId, randomUUID()).expect(404);
  });

  it('русская шапка шаблона разбирается: sample-round.ru.csv — те же 10 строк; регистр, пробелы и «ё» не важны', async () => {
    const res = await upload('business', SAMPLE_RU_CSV, 'журнал.csv').expect(201);
    const job = res.body as ImportJobView;
    expect(job.rows.map((r) => r.externalId)).toEqual(['J-01', 'J-02', 'J-03', 'J-04', 'J-05', 'J-06', 'J-07', 'J-08', 'J-09', 'J-10']);
    expect(job.parsed).toBe(9);
    expect(job.rows.find((r) => r.externalId === 'J-04')!.status).toBe('needs_human_parse');
    await settled(job.id);

    const sloppy = Buffer.from('\uFEFF№;где;ЧТО НЕ ТАК;Как  должно быть;важность;скрин\nR-1;Профиль;Кнопка серая;Синяя;высокая;\n', 'utf8');
    const res2 = await upload('business', sloppy, 'sloppy.csv').expect(201);
    const row = (res2.body as ImportJobView).rows[0]!;
    expect(row.status).toBe('parsed');
    expect(row.cells.description).toBe('Кнопка серая');
    expect(row.cells.expected).toBe('Синяя');
    await settled((res2.body as ImportJobView).id);
  });

  it('шаблон скачивается: xlsx с русской шапкой, csv — BOM + та же строка колонок через «;»', async () => {
    const xlsx = await h.http.get(`/api/v1/projects/${h.projectId}/imports/template.xlsx`).set(h.auth('business')).expect(200);
    expect(xlsx.headers['content-disposition']).toMatch(/journal-template\.xlsx/);
    const csv = await h.http.get(`/api/v1/projects/${h.projectId}/imports/template.csv`).set(h.auth('business')).expect(200);
    expect(csv.text).toBe(TEMPLATE_CSV);
    expect(csv.text).toBe(`\uFEFF${JOURNAL_HEADER_LINE}\n`);
    expect(JOURNAL_HEADER_LINE).toBe('№;Где;Что не так;Как должно быть;Важность;Скрин');
    // Статической копии шаблона у фронта больше нет (3.2): страница импорта качает эти же эндпоинты
  });
});
