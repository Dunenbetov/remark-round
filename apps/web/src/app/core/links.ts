import { UrlSegment, type UrlMatchResult } from '@angular/router';

/**
 * Человеческие адреса SPA (владелец, 13.09.2026): вместо /p/<uuid>/r/2/remarks/<uuid>
 *   /klientskiy-kabinet                 — журнал последнего раунда (разработчику — очередь)
 *   /klientskiy-kabinet/round-2         — журнал раунда
 *   /klientskiy-kabinet/round-2/12      — карточка № 12 (номер уникален в раунде)
 *   /klientskiy-kabinet/round-2/new     — новое замечание
 *   /klientskiy-kabinet/round-2/import  — импорт журнала
 *   /klientskiy-kabinet/documents | team | dev | rounds
 * slug выдаёт сервер (Project.slug), первый сегмент — всегда он. Старые /p/<uuid>/… перенаправляет legacyUrlGuard.
 */

/** Номер раунда или `latest`; null — «ещё не знаем», то же, что latest. */
export type RoundRef = number | string | null | undefined;

const ROUND_SEGMENT = /^round-(\d+|latest)$/;
const REMARK_SEGMENT = /^\d+$/;

function roundSegment(round: RoundRef): string {
  return `round-${round ?? 'latest'}`;
}

export const links = {
  /** Корень проекта: журнал последнего раунда или очередь разработчика. */
  project: (slug: string): string[] => ['/', slug],
  journal: (slug: string, round: RoundRef): string[] => (round == null || round === 'latest' ? ['/', slug] : ['/', slug, roundSegment(round)]),
  remark: (slug: string, round: RoundRef, number: number): string[] => ['/', slug, roundSegment(round), String(number)],
  newRemark: (slug: string, round: RoundRef): string[] => ['/', slug, roundSegment(round), 'new'],
  import: (slug: string, round: RoundRef): string[] => ['/', slug, roundSegment(round), 'import'],
  documents: (slug: string): string[] => ['/', slug, 'documents'],
  team: (slug: string): string[] => ['/', slug, 'team'],
  dev: (slug: string): string[] => ['/', slug, 'dev'],
  /** Все раунды проекта: даты, кто закрыл, выгрузка журнала (ADR 011). */
  rounds: (slug: string): string[] => ['/', slug, 'rounds'],
};

/** Команды роутера → строка для navigateByUrl: ['/', 'a', 'b'] → '/a/b'. */
export function toUrl(commands: string[]): string {
  return '/' + commands.filter((c) => c !== '/').join('/');
}

export type Section = 'journal' | 'documents' | 'import' | 'team' | 'dev';

/** Раздел по адресу — по сегментам, а не по подстроке: у проекта `devops` адрес тоже содержит «/dev». */
export function sectionOf(url: string): Section {
  const [, second, third] = url.split(/[?#]/)[0]!.split('/').filter(Boolean);
  if (second === 'documents' || second === 'team' || second === 'dev') return second;
  if (third === 'import') return 'import';
  return 'journal';
}

/** Сегмент `round-2` / `round-latest` → параметр `round` ('2' / 'latest'). */
export function roundMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  const m = segments[0]?.path.match(ROUND_SEGMENT);
  return m ? { consumed: [segments[0]!], posParams: { round: new UrlSegment(m[1]!, {}) } } : null;
}

/** Сегмент `12` → параметр `remark` (номер замечания). */
export function remarkMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  const s = segments[0];
  return s && segments.length === 1 && REMARK_SEGMENT.test(s.path) ? { consumed: [s], posParams: { remark: s } } : null;
}

/** Старые ссылки /p/<uuid>/… (закладки, старые ссылки): съедаем весь адрес, legacyUrlGuard переписывает его на новый. */
export function legacyMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  return segments[0]?.path === 'p' && segments.length >= 2 ? { consumed: segments } : null;
}
