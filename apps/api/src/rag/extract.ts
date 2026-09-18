import { UnprocessableEntityException } from '@nestjs/common';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import WordExtractor from 'word-extractor';
import { oleContent, sniff } from '../storage/sniff';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC = 'application/msword';

export type SupportedMime = 'application/pdf' | typeof DOCX | typeof DOC | 'text/markdown' | 'text/plain';

const BY_EXT: Record<string, SupportedMime> = {
  '.pdf': 'application/pdf',
  '.docx': DOCX,
  '.doc': DOC,
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

/** Для текста 422: те же слова, что на полке документов во фронте. */
export const SUPPORTED_FORMATS = 'PDF, DOCX, DOC, Markdown и текст';

/** Нормализуем mime по расширению: браузеры и curl присылают что попало. */
export function detectMime(fileName: string, declared?: string): SupportedMime {
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.toLowerCase().slice(dot) : '';
  const byExt = BY_EXT[ext];
  if (byExt) return byExt;
  if (declared && (Object.values(BY_EXT) as string[]).includes(declared)) return declared as SupportedMime;
  throw new UnprocessableEntityException(`Поддерживаются ${SUPPORTED_FORMATS}`);
}

/**
 * Содержимое обязано совпасть с заявленным типом: PDF начинается с %PDF, markdown и текст — текст без NUL.
 * Word — любой из двух контейнеров: zip (DOCX) или OLE2 с потоком WordDocument (DOC). Переименованный файл
 * (.doc, который на деле DOCX, и наоборот) — частая история у заказчиков; extractText читает его по содержимому.
 */
export function assertContent(data: Buffer, mime: SupportedMime): void {
  const kind = sniff(data);
  if (mime === DOCX || mime === DOC) {
    if (kind === 'zip') return;
    if (kind === 'ole2') {
      const ole = oleContent(data);
      if (ole === 'word') return;
      if (ole === 'encrypted') throw new UnprocessableEntityException('Документ защищён паролем: снимите пароль в Word и загрузите снова');
    }
    if (kind === 'text' && data.subarray(0, 5).toString('latin1') === '{\\rtf') {
      throw new UnprocessableEntityException('Это RTF под именем Word-файла: сохраните его в Word как DOCX или PDF');
    }
  } else if (mime === 'application/pdf' ? kind === 'pdf' : kind === 'text') {
    return;
  }
  throw new UnprocessableEntityException(`Содержимое файла не совпадает с его типом: нужен настоящий ${SUPPORTED_FORMATS.replace(' и ', ' или ')}`);
}

/**
 * Текст документа в markdown-подобном виде для чанкера. Граница абзаца — пустая строка во всех форматах:
 * по ней чанкер отличает нумерованный заголовок «2.1 Primary» от строки, перенесённой внутри абзаца.
 * - PDF: строки собираются по координатам (номер «2.1» и текст заголовка — разные фрагменты через табуляцию),
 *   пустая строка — где интервал больше обычного, сменился кегль или шрифт всей строки; колонтитулы, повторённые
 *   на половине страниц, и номера страниц снимаются; ячейки таблицы в строке — через « | ».
 * - DOCX: заголовки Word становятся `#`, их автонумерация восстанавливается («2.1»), таблицы — строки «ячейка | ячейка».
 * - DOC (Word 97-2003): текст абзацев через word-extractor; заголовки ловит чанкер по нумерации в тексте.
 */
export async function extractText(data: Buffer, mime: SupportedMime): Promise<string> {
  let text: string;
  switch (mime) {
    case 'application/pdf':
      text = await pdfToText(data);
      break;
    case DOCX:
    case DOC:
      text = sniff(data) === 'zip' ? await docxToText(data) : await docToText(data);
      break;
    default:
      text = decodeText(data);
  }
  return normalizeText(text);
}

/**
 * Юникод как в исходном документе: NFKC сводит лигатуры PDF (ﬁ), неразрывные и «широкие» пробелы, собирает «й» из «и» + ˘.
 * «№» и степени NFKC превратил бы в «No» и «2» — их не трогаем. «ĸ» (U+0138) — артефакт PDF из Chrome
 * (аудит 18.09: все «к» в печати из браузера пришли как «ĸ»). Мягкий перенос в конце строки склеивает слово.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^№²³]+/g, (s) => s.normalize('NFKC'))
    .replace(/\u0138/g, 'к')
    .replace(/\u00AD[ \t]*\n[ \t]*/g, '')
    .replace(/[\u00AD\u200B\u2060\uFEFF]/g, '');
}

/** UTF-8 (BOM снимается), UTF-16 по BOM, иначе windows-1251 — так сохраняет «Блокнот» на русской Windows. */
function decodeText(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('windows-1251').decode(data);
  }
}

// ---------- PDF ----------

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
}

interface PdfLine {
  text: string;
  y: number;
  size: number;
  endX: number;
  /** Шрифт строки; `mixed` — в строке несколько шрифтов (жирное слово внутри абзаца). */
  font: string;
  mixed: boolean;
}

interface PdfPage {
  lines: PdfLine[];
  bottom: number;
  top: number;
}

/** Метка списка или заголовка перед табуляцией: «2.1», «1.», «•» — к тексту через пробел, а не « | ». */
const LIST_LABEL = /^\s*(§?\d{1,2}(\.\d{1,2}){0,3}\.?|\d{1,2}\)|[a-zа-я]\)|[•·▪◦‣○■□►–—-])\s*$/i;
/** «3», «- 3 -», «Стр. 3», «Страница 3 из 10», «3 / 10». */
const PAGE_NUMBER = /^(стр\.?|страница|page)?\s*[-–—]?\s*\d{1,4}\s*[-–—]?\s*((из|of|\/)\s*\d{1,4})?$/i;
/** Колонтитул ищем в верхних и нижних 10% страницы. */
const MARGIN_ZONE = 0.1;

async function pdfToText(data: Buffer): Promise<string> {
  const pages: PdfPage[] = [];
  try {
    const parsed = await pdfParse(data, {
      pagerender: async (page: PdfPageProxy) => {
        pages[page.pageIndex] = await readPage(page);
        return '';
      },
    });
    // pdf-parse глотает ошибку страницы и идёт дальше: пропуск в массиве — повод взять текст целиком по-старому
    if (Array.from({ length: parsed.numpages }, (_, i) => pages[i]).some((p) => !p)) throw new Error('страница не прочитана');
    return layoutPdf(pages);
  } catch {
    // Раскладка по координатам — улучшение, а не условие: на странном PDF отдаём текст как pdf-parse по умолчанию
    return (await pdfParse(data)).text;
  }
}

interface PdfPageProxy {
  pageIndex: number;
  view: number[];
  getTextContent(options: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{ items: PdfTextItem[] }>;
}

/** Фрагменты страницы в порядке потока (колонки и ячейки таблиц идут подряд), склеенные в строки по базовой линии. */
async function readPage(page: PdfPageProxy): Promise<PdfPage> {
  const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  const [, bottom = 0, , top = 842] = page.view ?? [];
  const lines: PdfLine[] = [];
  let cur: PdfLine | null = null;
  for (const item of content.items) {
    if (!item.str) continue;
    const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || item.height || 10;
    if (cur && Math.abs(y - cur.y) <= Math.max(cur.size, size) * 0.4) {
      const gap = x - cur.endX;
      const em = Math.max(cur.size, size);
      // Номер заголовка или списка отделён от текста табуляцией (до ~2 em); дальше — уже соседняя ячейка или колонка
      const label = LIST_LABEL.test(cur.text) && gap < 3 * em;
      if (gap > 1.5 * em && !label) cur.text += ' | ';
      else if ((gap > 0.15 * em || label) && !/\s$/.test(cur.text) && !/^\s/.test(item.str)) cur.text += ' ';
      cur.text += item.str;
      cur.endX = x + item.width;
      cur.size = Math.max(cur.size, size);
      if (item.str.trim() && (item.fontName ?? '') !== cur.font) cur.mixed = true;
    } else {
      cur = { text: item.str, y, size, endX: x + item.width, font: item.fontName ?? '', mixed: false };
      lines.push(cur);
    }
  }
  for (const line of lines) line.text = line.text.replace(/[ \t]+/g, ' ').trim();
  return { lines: lines.filter((l) => l.text), bottom, top };
}

function layoutPdf(pages: PdfPage[]): string {
  const marginKey = (text: string): string => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const inMargin = (page: PdfPage, line: PdfLine): boolean => {
    const zone = (page.top - page.bottom) * MARGIN_ZONE;
    return line.y > page.top - zone || line.y < page.bottom + zone;
  };
  // Колонтитулы: строка из поля страницы, которая (с точностью до цифр) повторяется на половине страниц и больше
  const seen = new Map<string, number>();
  for (const page of pages) {
    const keys = new Set(page.lines.filter((l) => inMargin(page, l)).map((l) => marginKey(l.text)));
    for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const repeated = (text: string): boolean => pages.length >= 2 && (seen.get(marginKey(text)) ?? 0) >= Math.max(2, Math.ceil(pages.length / 2));

  // Обычный межстрочный интервал документа (в кеглях): всё заметно больше — граница абзаца
  const ratios = new Map<number, number>();
  for (const page of pages) {
    for (let i = 1; i < page.lines.length; i++) {
      const prev = page.lines[i - 1]!;
      const next = page.lines[i]!;
      if (next.y >= prev.y || Math.abs(prev.size - next.size) > 0.5) continue;
      const r = Math.round(((prev.y - next.y) / prev.size) * 20) / 20;
      ratios.set(r, (ratios.get(r) ?? 0) + 1);
    }
  }
  const lineRatio = [...ratios.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1.2;

  const out: string[] = [];
  for (const page of pages) {
    const lines = page.lines.filter((l) => !(inMargin(page, l) && (repeated(l.text) || PAGE_NUMBER.test(l.text))));
    const parts: string[] = [];
    lines.forEach((line, i) => {
      const prev = lines[i - 1];
      if (prev) {
        const size = Math.max(prev.size, line.size);
        // Граница абзаца: шаг вверх (новая колонка, ячейка), смена кегля, интервал больше обычного или смена шрифта
        // целой строки — жирный заголовок в документе по ГОСТ без интервалов между абзацами
        const fontChange = prev.font !== line.font && !prev.mixed && !line.mixed;
        const newBlock = line.y > prev.y + 1 || Math.abs(prev.size - line.size) / size > 0.12 || (prev.y - line.y) / size > lineRatio * 1.3 || fontChange;
        parts.push(newBlock ? '\n\n' : '\n');
      }
      parts.push(line.text);
    });
    out.push(parts.join(''));
  }
  return out.join('\n\n');
}

// ---------- DOCX ----------

async function docxToText(data: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml(
    { buffer: data },
    {
      transformDocument: numberHeadings,
      // Картинки чанкеру не нужны, а data:-URI скриншотов раздувал бы HTML на десятки мегабайт
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
    },
  );
  return htmlToMarkdown(result.value);
}

interface DocxElement {
  type: string;
  children?: DocxElement[];
  styleName?: string | null;
  numbering?: { level: string; isOrdered: boolean } | null;
  value?: string;
}

const HEADING_STYLE = /^(heading|заголовок)\s*(\d)$/i;

/**
 * Автонумерация заголовков Word («1», «2.1») не входит в текст абзаца: mammoth её не выводит, и подпись «§2.1»
 * терялась. Восстанавливаем номер счётчиком по уровню списка (десятичная многоуровневая нумерация — как у Word
 * и Google Docs по умолчанию). Номер, набранный руками, остаётся как есть.
 */
function numberHeadings(doc: DocxElement): DocxElement {
  const counters: number[] = [];
  const visit = (el: DocxElement): DocxElement => {
    const children = el.children?.map(visit);
    const node = children ? { ...el, children } : el;
    if (node.type !== 'paragraph' || !node.numbering?.isOrdered || !HEADING_STYLE.test(node.styleName ?? '')) return node;
    const level = Number(node.numbering.level) || 0;
    counters.length = level + 1;
    counters[level] = (counters[level] ?? 0) + 1;
    if (/^\s*\d+(\.\d+)*\.?\s/.test(plainText(node))) return node;
    const label = Array.from(counters, (n) => n ?? 1).join('.');
    return { ...node, children: [docxRun(`${label} `), ...(node.children ?? [])] };
  };
  // Порядок обхода — порядок документа: счётчик идёт так же, как номера на странице
  return visit(doc);
}

function plainText(el: DocxElement): string {
  if (el.type === 'text') return el.value ?? '';
  return (el.children ?? []).map(plainText).join('');
}

function docxRun(text: string): DocxElement {
  const props = { styleId: null, styleName: null, isBold: false, isUnderline: false, isItalic: false, isStrikethrough: false, isAllCaps: false, isSmallCaps: false, verticalAlignment: 'baseline', font: null, fontSize: null, highlight: null };
  return { type: 'run', children: [{ type: 'text', value: text }], ...props } as DocxElement;
}

/** Достаточно для чанкера: заголовки, абзацы (через пустую строку), списки, таблицы строками «ячейка | ячейка». */
export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => `\n\n${tableRows(inner)}\n\n`)
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_m, level: string, text: string) => `\n\n${'#'.repeat(Number(level))} ${stripTags(text)}\n\n`)
    .replace(/<li[^>]*>(.*?)<\/li>/gis, (_m, text: string) => `- ${stripTags(text)}\n`)
    .replace(/<\/(p|div)>/gi, '\n\n')
    .replace(/<\/(ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Строка таблицы — одна строка текста: требование из ячейки ищется вместе со своей строкой. */
function tableRows(inner: string): string {
  const rows: string[] = [];
  for (const tr of inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) => stripTags(td[1]!.replace(/<\/p>|<br\s*\/?>/gi, ' ')).replace(/\s+/g, ' ').trim());
    if (cells.some(Boolean)) rows.push(cells.join(' | '));
  }
  return rows.join('\n');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

// ---------- DOC (Word 97-2003) ----------

/**
 * Старый Word: word-extractor (MIT, чистый JS) читает текстовый поток OLE2 — абзацы, ячейки таблиц (через \t).
 * Автонумерация и стили в текст не попадают: заголовок «2.1 Primary» найдётся, только если номер набран текстом.
 */
async function docToText(data: Buffer): Promise<string> {
  const doc = await new WordExtractor().extract(data);
  return doc
    .getBody()
    .split('\n')
    .map((line) => {
      const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
      return cells.join(line.includes('\t') ? ' | ' : ' ');
    })
    .filter(Boolean)
    .join('\n\n');
}
