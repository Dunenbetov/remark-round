import type { RemarkStatus, RetestOutcome, Role, VerdictCode } from '@remarkround/db';
import ExcelJS from 'exceljs';
import { CLOSE_CHECKED_RU, HISTORY_ACTION_RU, RETEST_OUTCOME_RU, ROLE_LABEL_RU, ROUND_EVENT_RU, STATUS_LABEL_RU, VERDICT_LABEL_RU } from '../remarks/labels';
import type { ClosedVia } from '../remarks/remark.dto';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Человек в строке: имя на момент действия и роль в проекте. */
export interface JournalPerson {
  name: string;
  role: Role | null;
}

export interface JournalRound {
  number: number;
  openedAt: Date;
  closedAt: Date | null;
  closedBy: JournalPerson | null;
  total: number;
  closed: number;
  changeRequests: number;
  duplicates: number;
  pending: number;
}

export interface JournalRemark {
  roundNumber: number;
  number: number;
  externalId: string | null;
  pageOrScreen: string | null;
  description: string;
  expected: string | null;
  severity: string | null;
  status: RemarkStatus;
  author: JournalPerson | null;
  createdAt: Date;
  verdict: { code: VerdictCode; by: JournalPerson | null; at: Date; comment: string | null } | null;
  citations: string[];
  fixedBy: JournalPerson | null;
  fixedAt: Date | null;
  closedBy: JournalPerson | null;
  closedAt: Date | null;
  closedVia: ClosedVia | null;
  /** Закрыли после ретеста, и у сравнения есть картинка диффа. */
  closedWithDiff: boolean;
  closeComment: string | null;
  retest: { outcome: RetestOutcome; explanation: string | null } | null;
  origin: { number: number; roundNumber: number } | null;
  reopenedBy: { number: number; roundNumber: number } | null;
  cardUrl: string;
}

/** Строка листа «История»: действие с замечанием или событие раунда (`number` пуст). Видимость уже применена. */
export interface JournalEvent {
  roundNumber: number;
  number: number | null;
  at: Date;
  by: JournalPerson | null;
  /** Код действия истории или события раунда (`round:open`). */
  action: string;
  fromStatus: RemarkStatus | null;
  toStatus: RemarkStatus | null;
  comment: string | null;
  detail: string | null;
}

export interface JournalInput {
  projectName: string;
  /** IANA-пояс отчёта (REPORT_TIMEZONE): Excel поясов не знает, поэтому в ячейку идёт «настенное» время этого пояса. */
  timeZone: string;
  rounds: JournalRound[];
  remarks: JournalRemark[];
  events: JournalEvent[];
}

interface Column {
  header: string;
  key: string;
  width: number;
  date?: boolean;
}

const DATE_FORMAT = 'dd.mm.yyyy hh:mm';

/**
 * Журнал приёмки (ADR 011): три листа — «Раунды», «Замечания», «История». Через год по нему видно, кто создал
 * замечание, кто отдал в работу, кто и когда исправил, кто, когда и как закрыл. Чистая функция: данные и видимость
 * готовит RoundsService, здесь только форма файла. Даты — настоящие даты Excel с годом, смещение пояса — в шапке.
 */
export async function buildJournalXlsx(input: JournalInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RemarkRound';
  workbook.title = `Журнал приёмки — ${input.projectName}`;
  const offset = zoneOffsetLabel(input.timeZone, new Date());
  const when = (label: string) => `${label} (${offset})`;
  const at = (d: Date | null) => (d ? wallClock(d, input.timeZone) : null);

  const rounds = addSheet(workbook, 'Раунды', [
    { header: 'Раунд', key: 'round', width: 8 },
    { header: when('Открыт'), key: 'openedAt', width: 20, date: true },
    { header: when('Закрыт'), key: 'closedAt', width: 20, date: true },
    { header: 'Кто закрыл', key: 'closedBy', width: 30 },
    { header: 'Всего', key: 'total', width: 8 },
    { header: 'Закрыто', key: 'closed', width: 10 },
    { header: 'Новые желания', key: 'changeRequests', width: 15 },
    { header: 'Повторы', key: 'duplicates', width: 10 },
    { header: 'Не решено', key: 'pending', width: 12 },
  ]);
  for (const r of input.rounds) {
    addRow(rounds, {
      round: r.number,
      openedAt: at(r.openedAt),
      closedAt: at(r.closedAt),
      closedBy: person(r.closedBy),
      total: r.total,
      closed: r.closed,
      changeRequests: r.changeRequests,
      duplicates: r.duplicates,
      pending: r.pending,
    });
  }

  const remarks = addSheet(workbook, 'Замечания', [
    { header: 'Раунд', key: 'round', width: 8 },
    { header: '№', key: 'number', width: 6 },
    { header: '№ у заказчика', key: 'externalId', width: 14 },
    { header: 'Где', key: 'where', width: 22 },
    { header: 'Что не так', key: 'description', width: 48 },
    { header: 'Как должно быть', key: 'expected', width: 32 },
    { header: 'Важность', key: 'severity', width: 12 },
    { header: 'Статус', key: 'status', width: 22 },
    { header: 'Автор', key: 'author', width: 26 },
    { header: when('Создано'), key: 'createdAt', width: 20, date: true },
    { header: 'Решение', key: 'verdict', width: 30 },
    { header: 'Кто решил', key: 'verdictBy', width: 26 },
    { header: when('Когда решено'), key: 'verdictAt', width: 20, date: true },
    { header: 'Комментарий к решению', key: 'verdictComment', width: 32 },
    { header: 'Опора в документах', key: 'citations', width: 60 },
    { header: 'Исправил', key: 'fixedBy', width: 26 },
    { header: when('Когда исправлено'), key: 'fixedAt', width: 20, date: true },
    { header: 'Закрыл', key: 'closedBy', width: 26 },
    { header: when('Когда закрыто'), key: 'closedAt', width: 20, date: true },
    { header: 'Как закрыто', key: 'closedVia', width: 34 },
    { header: 'Комментарий при закрытии', key: 'closeComment', width: 36 },
    { header: 'Итог ретеста', key: 'retest', width: 36 },
    { header: 'Повтор претензии', key: 'reopen', width: 30 },
    { header: 'Карточка', key: 'card', width: 12 },
  ]);
  for (const r of [...input.remarks].sort((a, b) => a.roundNumber - b.roundNumber || a.number - b.number)) {
    addRow(remarks, {
      round: r.roundNumber,
      number: r.number,
      externalId: r.externalId ?? '',
      where: r.pageOrScreen && r.pageOrScreen !== '—' ? r.pageOrScreen : '',
      description: r.description,
      expected: r.expected ?? '',
      severity: r.severity ?? '',
      status: STATUS_LABEL_RU[r.status],
      author: person(r.author),
      createdAt: at(r.createdAt),
      verdict: r.verdict ? VERDICT_LABEL_RU[r.verdict.code] : '',
      verdictBy: person(r.verdict?.by ?? null),
      verdictAt: at(r.verdict?.at ?? null),
      verdictComment: r.verdict?.comment ?? '',
      citations: r.citations.join('\n'),
      fixedBy: person(r.fixedBy),
      fixedAt: at(r.fixedAt),
      closedBy: person(r.closedBy),
      closedAt: at(r.closedAt),
      closedVia: closedViaLabel(r),
      closeComment: r.closeComment ?? '',
      retest: r.retest ? [RETEST_OUTCOME_RU[r.retest.outcome], r.retest.explanation].filter(Boolean).join(' — ') : '',
      reopen: [
        r.origin ? `Повтор № ${r.origin.number} из раунда ${r.origin.roundNumber}` : '',
        r.reopenedBy ? `Предъявлена снова: раунд ${r.reopenedBy.roundNumber}, № ${r.reopenedBy.number}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      card: { text: 'Открыть', hyperlink: r.cardUrl },
    });
  }

  const history = addSheet(workbook, 'История', [
    { header: 'Раунд', key: 'round', width: 8 },
    { header: '№', key: 'number', width: 6 },
    { header: when('Когда'), key: 'at', width: 20, date: true },
    { header: 'Кто', key: 'who', width: 24 },
    { header: 'Роль', key: 'role', width: 22 },
    { header: 'Действие', key: 'action', width: 44 },
    { header: 'Из статуса', key: 'from', width: 24 },
    { header: 'В статус', key: 'to', width: 24 },
    { header: 'Комментарий', key: 'comment', width: 40 },
    { header: 'Пометка', key: 'detail', width: 60 },
  ]);
  for (const e of input.events) {
    const roundEvent = e.number === null;
    addRow(history, {
      round: e.roundNumber,
      number: e.number ?? '',
      at: at(e.at),
      who: e.by?.name ?? (roundEvent ? '' : 'RemarkRound'),
      role: e.by?.role ? ROLE_LABEL_RU[e.by.role] : '',
      action: actionLabel(e),
      from: e.fromStatus && e.fromStatus !== e.toStatus ? STATUS_LABEL_RU[e.fromStatus] : '',
      to: e.toStatus && e.fromStatus !== e.toStatus ? STATUS_LABEL_RU[e.toStatus] : '',
      comment: e.comment ?? '',
      detail: e.detail ?? '',
    });
  }

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Column[]): ExcelJS.Worksheet & { dateKeys: string[] } {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(({ header, key, width }) => ({ header, key, width }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'top', wrapText: true };
  // Фильтр по шапке: «Раунд = 2, № = 13» — и видно всё, что было с замечанием
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return Object.assign(sheet, { dateKeys: columns.filter((c) => c.date).map((c) => c.key) });
}

function addRow(sheet: ExcelJS.Worksheet & { dateKeys: string[] }, values: Record<string, unknown>): void {
  const row = sheet.addRow(values);
  row.alignment = { vertical: 'top', wrapText: true };
  for (const key of sheet.dateKeys) row.getCell(key).numFmt = DATE_FORMAT;
}

function person(p: JournalPerson | null): string {
  if (!p?.name) return '';
  return p.role ? `${p.name} (${ROLE_LABEL_RU[p.role]})` : p.name;
}

function closedViaLabel(r: JournalRemark): string {
  if (r.closedVia === 'business_check') return 'Проверено заказчиком без нового кадра';
  if (r.closedVia === 'retest') return r.closedWithDiff ? 'Ретест: новый кадр и дифф' : 'Ретест: новый кадр, без диффа';
  return '';
}

function actionLabel(e: JournalEvent): string {
  if (e.number === null) return ROUND_EVENT_RU[e.action] ?? e.action;
  if (e.action === 'close' && e.fromStatus === 'ready_for_retest') return CLOSE_CHECKED_RU;
  if (e.action === 'verdict' && e.toStatus && e.toStatus in VERDICT_LABEL_RU) return `${HISTORY_ACTION_RU['verdict']}: ${VERDICT_LABEL_RU[e.toStatus as VerdictCode]}`;
  return HISTORY_ACTION_RU[e.action] ?? e.action;
}

/**
 * ExcelJS пишет Date как серийный номер в UTC, а Excel показывает его без пояса. Чтобы в ячейке стояло «16:09»
 * по Алматы, подставляем дату, у которой UTC-часы равны настенным часам пояса отчёта.
 */
export function wallClock(date: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']), Number(parts['hour']), Number(parts['minute']), Number(parts['second'])));
}

/** «GMT+5» — смещение пояса на момент выгрузки, для подписи колонок с датами. */
export function zoneOffsetLabel(timeZone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}
