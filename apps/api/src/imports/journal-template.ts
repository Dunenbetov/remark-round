import ExcelJS from 'exceljs';

/**
 * Официальный шаблон журнала (fixtures/journal/README.md, fixtures/journal/template.csv).
 * Ключи колонок зафиксированы здесь и только здесь — это же ключи ячеек в ImportRow.rawJson и ImportRowView.cells.
 * В файле шапка русская (JOURNAL_HEADERS): её видит заказчик и её же обещает карточка «Что в шаблоне» на странице импорта.
 * Парсер принимает русскую шапку и прежнюю английскую (HEADER_ALIASES); других шапок не угадывает.
 */
export const JOURNAL_COLUMNS = ['external_id', 'page_or_screen', 'description', 'expected', 'severity', 'screenshot'] as const;

export type JournalColumn = (typeof JOURNAL_COLUMNS)[number];

export const JOURNAL_SHEET = 'Журнал';

/** Русская шапка файла. Порядок — как в JOURNAL_COLUMNS. */
export const JOURNAL_HEADERS: Record<JournalColumn, string> = {
  external_id: '№',
  page_or_screen: 'Где',
  description: 'Что не так',
  expected: 'Как должно быть',
  severity: 'Важность',
  screenshot: 'Скрин',
};

/** Что принимаем в шапке: русское имя из шаблона и прежнее английское (журналы, скачанные до перевода шаблона). */
export const HEADER_ALIASES: Record<JournalColumn, readonly string[]> = {
  external_id: ['№', 'external_id'],
  page_or_screen: ['Где', 'page_or_screen'],
  description: ['Что не так', 'description'],
  expected: ['Как должно быть', 'expected'],
  severity: ['Важность', 'severity'],
  screenshot: ['Скрин', 'screenshot'],
};

/** Строка шапки CSV: русские имена через «;» — так Excel в русской локали открывает файл сразу по колонкам. */
export const JOURNAL_HEADER_LINE = JOURNAL_COLUMNS.map((key) => JOURNAL_HEADERS[key]).join(';');

/** Подсказки в шапке xlsx — чтобы бизнес заполнял без инструкции. */
const HINTS: Record<JournalColumn, string> = {
  external_id: 'Ваш номер строки, например J-01',
  page_or_screen: 'Страница или экран',
  description: 'Что не так. Пустая строка уйдёт человеку на дописывание',
  expected: 'Как должно быть',
  severity: 'высокая / средняя / низкая — необязательно',
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

/** CSV-шаблон: BOM + русская шапка + «;» (см. JOURNAL_HEADER_LINE). */
export const TEMPLATE_CSV = `\uFEFF${JOURNAL_HEADER_LINE}\n`;

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
  sheet.columns = JOURNAL_COLUMNS.map((key) => ({ header: JOURNAL_HEADERS[key], key, width: WIDTHS[key] }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  JOURNAL_COLUMNS.forEach((key, i) => {
    header.getCell(i + 1).note = HINTS[key];
  });
  return workbook;
}
