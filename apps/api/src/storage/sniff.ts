/**
 * Тип файла по содержимому, не по расширению (аудит: uploads-validation-parsers). Документы и журналы приходят
 * «с той стороны» — это недоверенный ввод: PNG с расширением .jpg, exe как .pdf, zip-бомба как .docx.
 * Без зависимостей: сигнатур здесь ровно столько, сколько форматов принимает API.
 */
export type SniffedKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'pdf' | 'zip' | 'ole2' | 'text' | 'unknown';

/** OLE2 / Compound File Binary: контейнер старого Office (.doc, .xls, .ppt) и зашифрованного OOXML. */
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function sniff(data: Buffer): SniffedKind {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (data.length >= 6 && (data.toString('ascii', 0, 6) === 'GIF87a' || data.toString('ascii', 0, 6) === 'GIF89a')) return 'gif';
  if (data.length >= 5 && data.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07)) return 'zip';
  if (data.length >= 8 && data.subarray(0, 8).equals(OLE2)) return 'ole2';
  if (looksLikeText(data)) return 'text';
  return 'unknown';
}

/**
 * Что внутри OLE2: документ Word (поток WordDocument), DOCX под паролем (EncryptedPackage) или другое (xls, ppt, msg).
 * Имена потоков лежат в каталоге контейнера в UTF-16LE — полный разбор CFB для этой проверки не нужен.
 */
export function oleContent(data: Buffer): 'word' | 'encrypted' | 'other' {
  if (data.includes(Buffer.from('EncryptedPackage', 'utf16le'))) return 'encrypted';
  if (data.includes(Buffer.from('WordDocument', 'utf16le'))) return 'word';
  return 'other';
}

/** Текст: в первых 8 КБ нет NUL и почти нет управляющих байтов; BOM UTF-8/UTF-16 допускаем. */
function looksLikeText(data: Buffer): boolean {
  if (!data.length) return false;
  const head = data.subarray(0, 8192);
  if (head[0] === 0xff && head[1] === 0xfe) return true;
  if (head[0] === 0xfe && head[1] === 0xff) return true;
  let control = 0;
  for (const b of head) {
    if (b === 0) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c) control += 1;
  }
  return control / head.length < 0.01;
}

/** Расширение картинки → ожидаемая сигнатура (SVG API не принимает). */
export const IMAGE_KIND_BY_EXT: Record<string, SniffedKind> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
  '.gif': 'gif',
};
