/**
 * journal-export.spec — ADR 011, форма xlsx-журнала без базы: три листа с фильтром и закреплённой шапкой, даты —
 * настоящие даты Excel в поясе отчёта (сервер в UTC, Excel поясов не знает), «как закрыто» и подписи действий
 * — теми же словами, что на карточке.
 */
import ExcelJS from 'exceljs';
import { buildJournalXlsx, wallClock, zoneOffsetLabel, type JournalInput } from './journal-export';

const at = (iso: string) => new Date(iso);
const dana = { name: 'Дана', role: 'pm' as const };
const aigerim = { name: 'Айгерим', role: 'business' as const };
const timur = { name: 'Тимур', role: 'developer' as const };

function remark(number: number, patch: Partial<JournalInput['remarks'][number]> = {}): JournalInput['remarks'][number] {
  return {
    roundNumber: 2,
    number,
    externalId: null,
    pageOrScreen: 'Профиль',
    description: `Замечание ${number}`,
    expected: null,
    severity: null,
    status: 'closed',
    author: aigerim,
    createdAt: at('2026-09-01T04:00:00Z'),
    verdict: { code: 'defect', by: dana, at: at('2026-09-02T06:30:00Z'), comment: null },
    citations: ['ТЗ (§2.1): «Кнопка primary синяя»'],
    fixedBy: timur,
    fixedAt: at('2026-09-05T11:40:00Z'),
    closedBy: aigerim,
    closedAt: at('2026-09-10T10:05:00Z'),
    closedVia: 'business_check',
    closedWithDiff: false,
    closeComment: 'Проверила на стенде',
    retest: null,
    origin: null,
    reopenedBy: null,
    cardUrl: `https://rr.example/klientskiy-kabinet/round-2/${number}`,
    ...patch,
  };
}

const input: JournalInput = {
  projectName: 'Клиентский кабинет',
  timeZone: 'Asia/Almaty',
  rounds: [{ number: 2, openedAt: at('2026-09-01T03:00:00Z'), closedAt: at('2026-09-11T09:00:00Z'), closedBy: dana, total: 3, closed: 3, changeRequests: 0, duplicates: 0, pending: 0 }],
  remarks: [
    remark(13),
    remark(14, { closedVia: 'retest', closedWithDiff: true, closeComment: null, retest: { outcome: 'likely_addressed', explanation: 'Красное на диффе — кнопка' } }),
    remark(15, { closedVia: 'retest', closedWithDiff: false, closeComment: null }),
  ],
  events: [
    { roundNumber: 2, number: 13, at: at('2026-09-02T06:30:00Z'), by: dana, action: 'verdict', fromStatus: 'awaiting_pm', toStatus: 'defect', comment: null, detail: null },
    { roundNumber: 2, number: 13, at: at('2026-09-10T10:05:00Z'), by: aigerim, action: 'close', fromStatus: 'ready_for_retest', toStatus: 'closed', comment: 'Проверила на стенде', detail: null },
    { roundNumber: 2, number: 14, at: at('2026-09-10T10:06:00Z'), by: null, action: 'retest_result', fromStatus: 'ready_for_retest', toStatus: 'awaiting_business_close', comment: null, detail: 'Похоже, исправлено' },
    { roundNumber: 2, number: 14, at: at('2026-09-10T10:07:00Z'), by: aigerim, action: 'cancel', fromStatus: 'awaiting_business_close', toStatus: 'ready_for_retest', comment: null, detail: null },
    { roundNumber: 2, number: null, at: at('2026-09-11T09:00:00Z'), by: dana, action: 'close', fromStatus: null, toStatus: null, comment: null, detail: null },
  ],
};

async function load(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildJournalXlsx(input)) as unknown as ArrayBuffer);
  return wb;
}

function rows(sheet: ExcelJS.Worksheet): Array<Record<string, unknown>> {
  const header = (sheet.getRow(1).values as string[]).slice(1);
  const out: Array<Record<string, unknown>> = [];
  for (let i = 2; i <= sheet.rowCount; i++) {
    const v = sheet.getRow(i).values as unknown[];
    out.push(Object.fromEntries(header.map((h, j) => [h, v[j + 1] ?? ''])));
  }
  return out;
}

describe('journal xlsx (ADR 011)', () => {
  it('настенное время пояса: 10:05 UTC в Алматы — 15:05; смещение подписано', () => {
    const d = wallClock(at('2026-09-10T10:05:00Z'), 'Asia/Almaty');
    expect([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()]).toEqual([2026, 9, 10, 15, 5]);
    expect(zoneOffsetLabel('Asia/Almaty', at('2026-09-10T10:05:00Z'))).toBe('GMT+5');
  });

  it('три листа с фильтром и закреплённой шапкой', async () => {
    const wb = await load();
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Раунды', 'Замечания', 'История']);
    for (const sheet of wb.worksheets) {
      expect(sheet.autoFilter).toBeTruthy();
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    }
  });

  it('«Раунды»: даты — Date в поясе отчёта, кто закрыл — с ролью', async () => {
    const [round] = rows((await load()).getWorksheet('Раунды')!);
    expect(round).toMatchObject({ Раунд: 2, 'Кто закрыл': 'Дана (руководитель приёмки)', Всего: 3, Закрыто: 3, 'Не решено': 0 });
    const closed = round!['Закрыт (GMT+5)'] as Date;
    expect(closed).toBeInstanceOf(Date);
    expect(closed.getUTCHours()).toBe(14);
  });

  it('«Замечания»: кто и когда на каждом шаге, как закрыто, ссылка на карточку', async () => {
    const list = rows((await load()).getWorksheet('Замечания')!);
    expect(list.map((r) => r['№'])).toEqual([13, 14, 15]);
    expect(list[0]).toMatchObject({
      Автор: 'Айгерим (заказчик)',
      Решение: 'В работу разработчикам',
      'Кто решил': 'Дана (руководитель приёмки)',
      Исправил: 'Тимур (разработчик)',
      Закрыл: 'Айгерим (заказчик)',
      'Как закрыто': 'Проверено заказчиком без нового кадра',
      'Комментарий при закрытии': 'Проверила на стенде',
    });
    expect((list[0]!['Когда исправлено (GMT+5)'] as Date).getUTCHours()).toBe(16);
    expect(list[1]).toMatchObject({ 'Как закрыто': 'Ретест: новый кадр и дифф', 'Итог ретеста': 'Похоже, исправлено — Красное на диффе — кнопка' });
    expect(list[2]!['Как закрыто']).toBe('Ретест: новый кадр, без диффа');
    expect(list[0]!['Карточка']).toMatchObject({ text: 'Открыть', hyperlink: 'https://rr.example/klientskiy-kabinet/round-2/13' });
  });

  it('«История»: решение с подписью варианта, закрытие без кадра, отмена ретеста, действие системы и событие раунда', async () => {
    const events = rows((await load()).getWorksheet('История')!);
    expect(events.map((e) => [e['№'], e['Кто'], e['Роль'], e['Действие']])).toEqual([
      [13, 'Дана', 'руководитель приёмки', 'Решение: В работу разработчикам'],
      [13, 'Айгерим', 'заказчик', 'Закрыто без нового кадра: заказчик проверил сам'],
      [14, 'RemarkRound', '', 'Кадры сравнили'],
      [14, 'Айгерим', 'заказчик', 'Ретест отменён: кадр «Стало» снят'],
      ['', 'Дана', 'руководитель приёмки', 'Раунд закрыт'],
    ]);
    expect(events[1]).toMatchObject({ 'Из статуса': 'Можно смотреть снова', 'В статус': 'Закрыто', Комментарий: 'Проверила на стенде' });
    expect((events[1]!['Когда (GMT+5)'] as Date).getUTCHours()).toBe(15);
  });
});
