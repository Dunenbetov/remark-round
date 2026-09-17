/**
 * Генерирует файлы шаблона журнала из одного источника (journal-template.ts):
 *   fixtures/journal/template.xlsx + template.csv     — пустой шаблон с русской шапкой (xlsx — с подсказками в ячейках)
 *   apps/web/public/template.xlsx + template.csv      — те же файлы для ссылок «Скачать шаблон журнала»
 *   fixtures/journal/sample-round.ru.csv              — sample-round.csv с русской шапкой и «;» (как сохраняет Excel)
 *   fixtures/journal/sample-round.xlsx                — тот же журнал, кадры вставлены в ячейки
 * sample-round.csv с прежней английской шапкой остаётся: парсер принимает обе (тест алиаса).
 * Запуск: pnpm --filter @remarkround/api exec tsx src/imports/make-journal-fixtures.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JOURNAL_COLUMNS, JOURNAL_HEADER_LINE, TEMPLATE_CSV, buildTemplateXlsx, newJournalWorkbook } from './journal-template';
import { parseCsv } from './journal-parser';

const ROOT = resolve(__dirname, '../../../..');

/** Ячейка CSV с «;»: кавычки, если внутри разделитель, кавычка или перевод строки. */
function csvCell(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function main(): Promise<void> {
  const template = await buildTemplateXlsx();
  await writeFile(resolve(ROOT, 'fixtures/journal/template.xlsx'), template);
  await writeFile(resolve(ROOT, 'apps/web/public/template.xlsx'), template);
  await writeFile(resolve(ROOT, 'fixtures/journal/template.csv'), TEMPLATE_CSV, 'utf8');
  await writeFile(resolve(ROOT, 'apps/web/public/template.csv'), TEMPLATE_CSV, 'utf8');

  const csv = await readFile(resolve(ROOT, 'fixtures/journal/sample-round.csv'));
  const rows = parseCsv(csv);
  const ru = [JOURNAL_HEADER_LINE, ...rows.map((row) => JOURNAL_COLUMNS.map((c) => csvCell(row.cells[c])).join(';'))].join('\n');
  await writeFile(resolve(ROOT, 'fixtures/journal/sample-round.ru.csv'), `\uFEFF${ru}\n`, 'utf8');
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
  console.log(`journal fixtures: template.xlsx/csv, sample-round.ru.csv, sample-round.xlsx (${rows.length} строк)`);
}

type ExcelBuffer = Parameters<ReturnType<typeof newJournalWorkbook>['addImage']>[0]['buffer'];

void main();
