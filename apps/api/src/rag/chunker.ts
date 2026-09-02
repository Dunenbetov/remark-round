/**
 * Чанкинг по заголовкам разделов ТЗ (REMARKROUND.md §10, обоснование — docs/ARCHITECTURE.md).
 *
 * Единица цитаты — раздел («§2.1 Primary»), а не окно в 512 токенов: PM видит на карточке
 * именно раздел ТЗ, и retrieve должен возвращать его целиком. Длинные разделы режутся
 * на окна по словам с перекрытием, но остаются подписаны своим разделом.
 */

export interface Chunk {
  /** Подпись раздела для цитаты: «§2.1 Primary», «Решения, которых нет в ТЗ v1.4». */
  section: string | null;
  /** Путь заголовков — уходит в эмбеддинг, чтобы «2.1 Primary» знал, что он про кнопки и цвет. */
  path: string[];
  /** Текст, который цитируем. */
  content: string;
  /** Текст, который эмбеддим: путь заголовков + содержимое. */
  embedText: string;
  order: number;
  page: number | null;
}

export interface ChunkOptions {
  /** Максимум слов в одном чанке; длиннее — окна с перекрытием. */
  maxWords?: number;
  overlapWords?: number;
}

const DEFAULTS: Required<ChunkOptions> = { maxWords: 220, overlapWords: 40 };

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
/** «2.1 Primary», «4.2. Ошибки», «§3 Вход» — короткая строка без точки в конце. */
const NUMBERED_HEADING = /^§?\s*(\d+(?:\.\d+)*)\.?\s+(\S.{0,90}?)\s*$/;
const SECTION_NUMBER = /^§?\s*(\d+(?:\.\d+)*)\.?\s+/;

interface Heading {
  level: number;
  title: string;
  number: string | null;
}

function parseHeading(line: string): Heading | null {
  const md = MD_HEADING.exec(line);
  if (md) {
    const title = md[2]!.trim();
    const num = SECTION_NUMBER.exec(title);
    return { level: md[1]!.length, title, number: num ? num[1]! : null };
  }
  const numbered = NUMBERED_HEADING.exec(line);
  if (numbered && !/[.:;,]$/.test(line.trim()) && line.trim().split(/\s+/).length <= 12) {
    const number = numbered[1]!;
    return { level: number.split('.').length + 1, title: line.trim().replace(/^§\s*/, ''), number };
  }
  return null;
}

function sectionLabel(path: Heading[]): string | null {
  const last = path[path.length - 1];
  if (!last) return null;
  if (last.number) {
    const rest = last.title.replace(SECTION_NUMBER, '').trim();
    return rest ? `§${last.number} ${rest}` : `§${last.number}`;
  }
  return last.title;
}

function windows(words: string[], maxWords: number, overlap: number): string[][] {
  if (words.length <= maxWords) return [words];
  const out: string[][] = [];
  const step = Math.max(1, maxWords - overlap);
  for (let start = 0; start < words.length; start += step) {
    out.push(words.slice(start, start + maxWords));
    if (start + maxWords >= words.length) break;
  }
  return out;
}

export function chunkByHeadings(text: string, options: ChunkOptions = {}): Chunk[] {
  const opts = { ...DEFAULTS, ...options };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chunks: Chunk[] = [];
  let path: Heading[] = [];
  let body: string[] = [];

  const flush = (): void => {
    const content = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    body = [];
    if (!content) return;
    const titles = path.map((h) => h.title);
    const section = sectionLabel(path);
    const words = content.split(/\s+/);
    for (const w of windows(words, opts.maxWords, opts.overlapWords)) {
      const part = w.join(' ');
      chunks.push({
        section,
        path: titles,
        content: words.length <= opts.maxWords ? content : part,
        embedText: titles.length ? `${titles.join(' › ')}\n\n${part}` : part,
        order: chunks.length,
        page: null,
      });
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = parseHeading(line.trim());
    if (heading) {
      flush();
      path = [...path.filter((h) => h.level < heading.level), heading];
      continue;
    }
    body.push(line);
  }
  flush();
  return chunks;
}

/** Слепые окна фиксированной длины — для сравнения в docs/ARCHITECTURE.md, в проде не используется. */
export function chunkFixed(text: string, maxWords = 120, overlapWords = 20): Chunk[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  return windows(words, maxWords, overlapWords).map((w, i) => ({
    section: null,
    path: [],
    content: w.join(' '),
    embedText: w.join(' '),
    order: i,
    page: null,
  }));
}
