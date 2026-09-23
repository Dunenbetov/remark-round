/**
 * Даты и время для людей (ADR 011): API отдаёт ISO, читатель видит свой пояс и всегда год — через год по истории
 * должно быть понятно, какой это был сентябрь. «10 сент. 2026» и «10 сент. 2026, 15:10».
 */
const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** «10 сент. 2026 г.» → «10 сент. 2026»: суффикс года в строке с именем читается лишним. */
const dropYearSuffix = (s: string): string => s.replace(/\s?г\./, '');

export function dateRu(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dropYearSuffix(DATE.format(d));
}

/** «10 сентября» — срок ссылки приглашения: год лишний, ссылка живёт неделю. */
const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

export function dayMonthRu(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DAY_MONTH.format(d);
}

export function dateTimeRu(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dropYearSuffix(DATE_TIME.format(d));
}

const REL_SHORT = new Intl.RelativeTimeFormat('ru', { numeric: 'auto', style: 'short' });
const REL_LONG = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Давность события в колокольчике: «только что», «5 мин назад», «2 ч назад», «вчера», «3 дня назад»,
 * старше недели — «10 сентября». Дни — по календарю читателя, а не по 24 часам: вчерашний вечер — «вчера».
 */
export function relTimeRu(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  // Часы сервера и браузера расходятся на секунды — событие «из будущего» тоже только что
  if (diff < MINUTE) return 'только что';
  if (diff < HOUR) return REL_SHORT.format(-Math.floor(diff / MINUTE), 'minute').replace('мин.', 'мин');
  const today = new Date(now);
  const days = Math.round((startOfDay(today) - startOfDay(d)) / (24 * HOUR));
  if (days === 0) return REL_SHORT.format(-Math.floor(diff / HOUR), 'hour');
  if (days < 7) return REL_LONG.format(-days, 'day');
  return dayMonthRu(iso);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Тот же календарный день у читателя — группа «Сегодня» в колокольчике. */
export function isTodayRu(iso: string, now: number = Date.now()): boolean {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && startOfDay(d) === startOfDay(new Date(now));
}
