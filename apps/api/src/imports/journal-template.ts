import ExcelJS from 'exceljs';

/**
 * Официальный шаблон журнала (REMARKROUND.md §14, fixtures/journal/template.csv).
 * Колонки зафиксированы здесь и только здесь: парсер не принимает другие шапки.
 */
export const JOURNAL_COLUMNS = ['external_id', 'page_or_screen', 'description', 'expected', 'severity', 'screenshot'] as const;

export type JournalColumn = (typeof JOURNAL_COLUMNS)[number];

export const JOURNAL_SHEET = 'Журнал';

/** Подсказки в шапке xlsx — чтобы бизнес заполнял без инструкции. */
const HINTS: Record<JournalColumn, string> = {
  external_id: 'Ваш номер строки, например J-01',
  page_or_screen: 'Страница или экран',
  description: 'Что не так. Пустая строка уйдёт человеку на дописывание',
  expected: 'Как должно быть',
  severity: 'low / medium / high — необязательно',
  screenshot: 'Вставьте картинку в ячейку этой колонки или оставьте пустой',
};

const WIDTHS: Record<JournalColumn, number> = {
  external_id: 12,
  page_or_screen: 24,
  description: 48,
  expected: 36,
  severity: 10,
  screenshot: 18,
};

export const TEMPLATE_CSV = `${JOURNAL_COLUMNS.join(',')}\n`;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Пустой xlsx с шапкой: скачивается кнопкой «Скачать шаблон журнала». */
export async function buildTemplateXlsx(): Promise<Buffer> {
  const workbook = newJournalWorkbook();
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

/** Книга с листом «Журнал» и шапкой шаблона; строки добавляет вызывающий. */
export function newJournalWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RemarkRound';
  const sheet = workbook.addWorksheet(JOURNAL_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = JOURNAL_COLUMNS.map((key) => ({ header: key, key, width: WIDTHS[key] }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  JOURNAL_COLUMNS.forEach((key, i) => {
    header.getCell(i + 1).note = HINTS[key];
  });
  return workbook;
}
