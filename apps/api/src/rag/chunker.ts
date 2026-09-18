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
/** «2.1 Primary», «4.2. Ошибки», «§3 Вход»: номер до 99, не глубже четырёх уровней, дальше заголовок до 90 знаков. */
const NUMBERED_HEADING = /^§?\s*(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(\S.{0,90}?)\s*$/u;
const SECTION_NUMBER = /^§?\s*(\d+(?:\.\d+)*)\.?\s+/;
/** Любая нумерованная строка, в том числе пункт списка «1)» — для проверки «соседей по списку». */
const NUMBERED_LINE = /^§?\s*(\d{1,4}(?:\.\d{1,3})*)[.)]?\s+\S/;
/**
 * Слово сразу после числа, с которым строка — величина, а не заголовок: «5 МБ», «14 Января», «3 Рабочих дня».
 * Строчные слова отсекает правило заглавной буквы; здесь — то, что пишут и с заглавной, и символами.
 */
const UNIT_WORDS = new Set(
  (
    'дней дня день рабочих календарных недель недели месяцев месяца лет года год гг г ' +
    'рублей рубля рубль руб р ₸ тенге тг usd eur $ € % шт штук мм см м км кг px пикс пикселей ' +
    'мин минут сек секунд ч час часа часов мб гб кб тб mb gb kb раз раза ' +
    'января февраля марта апреля мая июня июля августа сентября октября ноября декабря'
  ).split(' '),
);

interface Heading {
  level: number;
  title: string;
  number: string | null;
}

function parseMdHeading(line: string): Heading | null {
  const md = MD_HEADING.exec(line);
  if (!md) return null;
  const title = md[2]!.trim();
  const num = SECTION_NUMBER.exec(title);
  return { level: md[1]!.length, title, number: num ? num[1]! : null };
}

/**
 * Строка без `#` — заголовок, только если похожа на заголовок сама и стоит на месте заголовка (аудит 18.09:
 * «14 января 2026 года», «10 рабочих дней», «1. Открыть форму оплаты» становились разделами «§14», «§10», «§1»).
 * Сама строка: номер ≤ 99 (с уровнями «.N»), затем слово с заглавной буквы, не единица измерения и не месяц,
 * нет `%`, нет « | » (строка таблицы) и отточия оглавления, скобки закрыты, в конце нет `.,;:`, тире или открытой
 * скобки, не длиннее 12 слов. Место: перед ней пустая строка (граница абзаца — extractText ставит её во всех
 * форматах), начало текста, другой заголовок или конец предложения; следующая строка не продолжает её со
 * строчной буквы; соседние непустые строки — не пункты того же списка («1.» → «2.»).
 */
function parseNumberedHeading(lines: string[], i: number, ctx: { prevIsHeading: boolean; atStart: boolean }): Heading | null {
  const line = lines[i]!.trim();
  const m = NUMBERED_HEADING.exec(line);
  if (!m) return null;
  const number = m[1]!;
  const title = m[2]!;
  if (!/^[«"„“(]?\p{Lu}/u.test(title)) return null;
  const firstWord = title.split(/\s+/)[0]!.toLowerCase().replace(/[.,;:]+$/, '');
  if (UNIT_WORDS.has(firstWord)) return null;
  if (line.includes('%') || line.includes(' | ') || /\.{4,}|…{2,}|_{4,}/.test(line)) return null;
  if (/[.,;:(\-–—→/\\]$/.test(line)) return null;
  if ((line.match(/\(/g) ?? []).length !== (line.match(/\)/g) ?? []).length) return null;
  if (line.split(/\s+/).length > 12) return null;

  const prev = i > 0 ? lines[i - 1]!.trim() : '';
  if (!(ctx.atStart || !prev || ctx.prevIsHeading || /[.!?…]$/.test(prev))) return null;
  const next = lines[i + 1]?.trim() ?? '';
  if (/^\p{Ll}/u.test(next)) return null;
  if (isListNeighbour(number, nearestText(lines, i, -1)) || isListNeighbour(number, nearestText(lines, i, 1))) return null;

  return { level: number.split('.').length + 1, title: line.replace(/^§\s*/, ''), number };
}

function nearestText(lines: string[], i: number, step: 1 | -1): string {
  for (let j = i + step; j >= 0 && j < lines.length; j += step) {
    const t = lines[j]!.trim();
    if (t) return t;
  }
  return '';
}

/** «1. Открыть» рядом с «2. Ввести» — пункты одного списка, а не два раздела подряд без текста. */
function isListNeighbour(number: string, other: string): boolean {
  const m = NUMBERED_LINE.exec(other);
  if (!m) return false;
  const a = number.split('.').map(Number);
  const b = m[1]!.split('.').map(Number);
  if (a.length !== b.length || a.slice(0, -1).some((n, k) => n !== b[k])) return false;
  return Math.abs(a[a.length - 1]! - b[b.length - 1]!) === 1;
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

  const ctx = { prevIsHeading: false, atStart: true };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const heading = parseMdHeading(line.trim()) ?? parseNumberedHeading(lines, i, ctx);
    ctx.prevIsHeading = heading !== null;
    if (line.trim()) ctx.atStart = false;
    if (heading) {
      flush();
      path = [...path.filter((h) => h.level < heading.level), heading];
      return;
    }
    body.push(line);
  });
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
