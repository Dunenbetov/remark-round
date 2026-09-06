import ExcelJS from 'exceljs';
import { HEADER_ALIASES, JOURNAL_COLUMNS, JOURNAL_HEADERS, JournalColumn } from './journal-template';

export type JournalCells = Record<JournalColumn, string>;

export interface JournalImage {
  buffer: Buffer;
  /** png | jpeg | gif — как отдаёт exceljs */
  extension: string;
  width: number | null;
  height: number | null;
}

export interface ParsedJournalRow {
  /** Номер строки в файле (шапка — 1). */
  rowNumber: number;
  cells: JournalCells;
  /** Картинка из ячейки xlsx, привязанная к этой строке. */
  image?: JournalImage;
  status: 'parsed' | 'needs_human_parse';
  /** Почему строка ушла человеку. По-русски: показывается в UI как есть. */
  reason?: string;
}

/** Файл не по шаблону: не наша шапка, не тот формат. Наверху превращается в 422. */
export class JournalTemplateError extends Error {}

export const MAX_JOURNAL_ROWS = 500;

export const REASON_EMPTY_DESCRIPTION = 'пустое описание';
export const REASON_TOO_MANY_CELLS = 'в строке больше ячеек, чем колонок в шаблоне — проверьте кавычки';

/**
 * Парсер только официального шаблона. Другая шапка → JournalTemplateError, не «маппинг как получится».
 * Строка без description → needs_human_parse, ничего не выдумываем и не теряем: ячейки уходят как есть.
 */
export async function parseJournal(data: Buffer, fileName: string): Promise<ParsedJournalRow[]> {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  if (ext === '.xlsx') return parseXlsx(data);
  if (ext === '.csv') return parseCsv(data);
  throw new JournalTemplateError('Журнал принимается только в .xlsx или .csv по шаблону');
}

// ---------- CSV ----------

export function parseCsv(data: Buffer): ParsedJournalRow[] {
  const text = decode(data).replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const records = splitCsv(text, delimiter);
  const headerIndex = records.findIndex((r) => r.some((c) => c.trim()));
  if (headerIndex < 0) throw new JournalTemplateError(templateMessage([], []));
  const columns = matchHeader(records[headerIndex]!);
  const rows: ParsedJournalRow[] = [];
  for (let i = headerIndex + 1; i < records.length; i++) {
    const raw = records[i]!;
    if (raw.every((c) => !c.trim())) continue;
    rows.push(toRow(i + 1, columns, raw));
  }
  assertRowLimit(rows.length);
  return rows;
}

/** UTF-8 (с BOM или без), иначе windows-1251: так Excel на русской Windows сохраняет CSV. */
function decode(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('windows-1251').decode(data);
  }
}

/** Наш шаблон с запятой; Excel в русской локали пересохраняет его с «;». Оба — тот же шаблон. */
function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

/** RFC 4180: кавычки, удвоенные кавычки, переводы строк внутри кавычек. */
export function splitCsv(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    records.push(row);
  }
  return records;
}

// ---------- XLSX ----------

export async function parseXlsx(data: Buffer): Promise<ParsedJournalRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new JournalTemplateError('Файл не открывается как xlsx. Скачайте шаблон журнала и заполните его');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new JournalTemplateError(templateMessage([], []));

  const headerRow = sheet.getRow(1);
  const headerCells: string[] = [];
  for (let c = 1; c <= sheet.columnCount; c++) headerCells.push(cellText(headerRow.getCell(c)));
  const columns = matchHeader(headerCells);

  const images = new Map<number, JournalImage>();
  for (const img of sheet.getImages()) {
    const rowNumber = Math.floor(img.range.tl.nativeRow) + 1;
    if (images.has(rowNumber)) continue; // одна картинка на строку: первая по порядку
    const media = workbook.getImage(Number(img.imageId));
    if (!media?.buffer) continue;
    const buffer = Buffer.from(media.buffer as unknown as Uint8Array);
    const size = pngSize(buffer);
    images.set(rowNumber, { buffer, extension: media.extension, width: size?.width ?? null, height: size?.height ?? null });
  }

  const rows: ParsedJournalRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const raw: string[] = [];
    for (let c = 1; c <= headerCells.length; c++) raw.push(cellText(row.getCell(c)));
    const image = images.get(r);
    if (raw.every((c) => !c.trim()) && !image) continue;
    const parsed = toRow(r, columns, raw);
    if (image) parsed.image = image;
    rows.push(parsed);
  }
  assertRowLimit(rows.length);
  return rows;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text; // гиперссылка
    if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('error' in v) return '';
  }
  return String(v);
}

/** Размер PNG из IHDR — чтобы карточка знала пропорции кадра без декодирования. */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// ---------- общее ----------

/** Имя колонки для сравнения: без BOM, регистра, «ё» и лишних пробелов. */
function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

/** «что не так» → description, «external_id» / «external id» → external_id. */
const ALIAS_INDEX = new Map<string, JournalColumn>();
for (const column of JOURNAL_COLUMNS) {
  for (const alias of HEADER_ALIASES[column]) {
    const n = normalizeHeader(alias);
    ALIAS_INDEX.set(n, column);
    ALIAS_INDEX.set(n.replace(/_/g, ' '), column);
  }
}

/**
 * Шапка должна содержать ровно колонки шаблона — русские имена или прежние английские (регистр, «ё» и пробелы
 * не важны, порядок любой). Возвращает индекс каждой колонки в строке файла.
 */
function matchHeader(header: string[]): Map<JournalColumn, number> {
  const found = new Map<JournalColumn, number>();
  const extra: string[] = [];
  header.forEach((raw, i) => {
    const n = normalizeHeader(raw);
    if (!n) return;
    const column = ALIAS_INDEX.get(n);
    if (column && !found.has(column)) found.set(column, i);
    else extra.push(raw.trim());
  });
  const missing = JOURNAL_COLUMNS.filter((c) => !found.has(c));
  if (missing.length || extra.length) throw new JournalTemplateError(templateMessage(missing, extra));
  return found;
}

function templateMessage(missing: JournalColumn[], extra: string[]): string {
  const parts = [`Это не наш шаблон: ожидаются колонки ${JOURNAL_COLUMNS.map((c) => JOURNAL_HEADERS[c]).join(', ')}.`];
  if (missing.length) parts.push(`Нет колонок: ${missing.map((c) => JOURNAL_HEADERS[c]).join(', ')}.`);
  if (extra.length) parts.push(`Лишние колонки: ${extra.join(', ')}.`);
  parts.push('Скачайте шаблон журнала и заполните его.');
  return parts.join(' ');
}

function toRow(rowNumber: number, columns: Map<JournalColumn, number>, raw: string[]): ParsedJournalRow {
  const cells = Object.fromEntries(JOURNAL_COLUMNS.map((c) => [c, (raw[columns.get(c)!] ?? '').trim()])) as JournalCells;
  const usedCells = raw.length;
  if (usedCells > columns.size && raw.slice(columns.size).some((c) => c.trim())) {
    return { rowNumber, cells, status: 'needs_human_parse', reason: REASON_TOO_MANY_CELLS };
  }
  if (!cells.description) return { rowNumber, cells, status: 'needs_human_parse', reason: REASON_EMPTY_DESCRIPTION };
  return { rowNumber, cells, status: 'parsed' };
}

function assertRowLimit(count: number): void {
  if (count > MAX_JOURNAL_ROWS) throw new JournalTemplateError(`В журнале больше ${MAX_JOURNAL_ROWS} строк — разбейте файл`);
}
