/**
 * Генерирует xlsx-двойники CSV-фикстур журнала (fixtures/journal/README.md: «продублировать в .xlsx»):
 *   fixtures/journal/template.xlsx      — пустой шаблон с шапкой и подсказками
 *   fixtures/journal/sample-round.xlsx  — sample-round.csv тем же составом колонок, кадры вставлены в ячейки
 *   apps/web/public/template.xlsx       — тот же шаблон для кнопки «Скачать шаблон журнала»
 * Запуск: pnpm --filter @remarkround/api exec tsx src/imports/make-journal-fixtures.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JOURNAL_COLUMNS, buildTemplateXlsx, newJournalWorkbook } from './journal-template';
import { parseCsv } from './journal-parser';

const ROOT = resolve(__dirname, '../../../..');

async function main(): Promise<void> {
  const template = await buildTemplateXlsx();
  await writeFile(resolve(ROOT, 'fixtures/journal/template.xlsx'), template);
  await writeFile(resolve(ROOT, 'apps/web/public/template.xlsx'), template);

  const csv = await readFile(resolve(ROOT, 'fixtures/journal/sample-round.csv'));
  const rows = parseCsv(csv);
  const workbook = newJournalWorkbook();
  const sheet = workbook.getWorksheet(1)!;
  const screenshotCol = JOURNAL_COLUMNS.indexOf('screenshot');
  for (const row of rows) {
    const ref = row.cells.screenshot;
    // В xlsx кадр живёт в ячейке, а не ссылкой: колонку screenshot оставляем пустой и вставляем картинку.
    const excelRow = sheet.addRow({ ...row.cells, screenshot: '' });
    if (ref) {
      const png = await readFile(resolve(ROOT, 'fixtures', ref.replace(/\.svg$/, '.png')));
      const imageId = workbook.addImage({ buffer: png as unknown as ExcelBuffer, extension: 'png' });
      excelRow.height = 84;
      sheet.addImage(imageId, { tl: { col: screenshotCol, row: excelRow.number - 1 }, ext: { width: 220, height: 110 } });
    }
  }
  const out = await workbook.xlsx.writeBuffer();
  await writeFile(resolve(ROOT, 'fixtures/journal/sample-round.xlsx'), Buffer.from(out as ArrayBuffer));
  console.log(`journal fixtures: template.xlsx, sample-round.xlsx (${rows.length} строк)`);
}

type ExcelBuffer = Parameters<ReturnType<typeof newJournalWorkbook>['addImage']>[0]['buffer'];

void main();
