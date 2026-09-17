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
