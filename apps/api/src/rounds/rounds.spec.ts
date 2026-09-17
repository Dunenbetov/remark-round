/**
 * rounds.spec — аудит: no-round-export-close, reopened-status-unreachable. Раунд закрывается, только когда всё решено;
 * в закрытый нельзя ни добавить, ни импортировать; итог раунда выгружается в xlsx тем же видом, что на экране
 * (заказчик — без комментариев PM); закрытую претензию заказчик открывает снова в новом раунде со ссылкой на оригинал.
 */
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { createHarness, type Harness } from '../../test/harness';

describe('rounds: close, export, reopen', () => {
  let h: Harness;
  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;
  let roundId = '';
  let defectId = '';

  beforeAll(async () => {
    h = await createHarness();
    roundId = h.roundId;
    const defect = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId, number: 970, description: 'Кнопка серая', pageOrScreen: 'Главная', status: 'defect', rationale: 'Поломка.' } });
    defectId = defect.id;
    await h.prisma.remark.create({ data: { projectId: h.projectId, roundId, number: 971, description: 'Хотим тёмную тему', status: 'change_request' } });
  });

  afterAll(async () => {
    await h.cleanup();
  });

  it('закрыть нельзя, пока есть нерешённые: 409 с перечнем; разработчик — 403', async () => {
    await h.http.post(url(`/rounds/${roundId}/close`)).set(h.auth('developer')).expect(403);
    const res = await h.http.post(url(`/rounds/${roundId}/close`)).set(h.auth('business')).expect(409);
    expect(res.body.message).toMatch(/В работе — 1/);
  });

  it('карточка по адресу SPA: номер раунда + номер замечания; чужой номер — 404', async () => {
    const at = await h.http.get(url('/remarks/at/1/970')).set(h.auth('pm')).expect(200);
    expect(at.body).toMatchObject({ id: defectId, number: 970, roundNumber: 1 });
    await h.http.get(url('/remarks/at/1/999')).set(h.auth('pm')).expect(404);
    await h.http.get(url('/remarks/at/2/970')).set(h.auth('pm')).expect(404);
    await h.http.get(url('/remarks/at/one/970')).set(h.auth('pm')).expect(400);
  });

  it('новый раунд не открыть, пока есть нерешённые: 409; список раундов отдаёт pending', async () => {
    const res = await h.http.post(url('/rounds')).set(h.auth('pm')).send({}).expect(409);
    expect(res.body.message).toBe('Новый раунд можно открыть, когда в раунде 1 не останется нерешённых замечаний (ещё 1)');
    const list = await h.http.get(url('/rounds')).set(h.auth('pm')).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: roundId, remarks: 2, pending: 1 });
  });

  it('когда всё решено — закрывается; повтор — тот же ответ; в закрытый нельзя добавить и импортировать', async () => {
    const run = await h.prisma.agentRun.create({ data: { remarkId: defectId, projectId: h.projectId, status: 'persisted', mode: 'triage' } });
    await h.prisma.$transaction([
      h.prisma.humanVerdict.create({ data: { remarkId: defectId, runId: run.id, userId: h.users.pm.id, code: 'defect', comment: 'Внутренняя пометка', idempotencyKey: randomUUID() } }),
      h.prisma.remark.update({ where: { id: defectId }, data: { status: 'closed', closedByUserId: h.users.business.id, closedAt: new Date() } }),
    ]);
    const closed = await h.http.post(url(`/rounds/${roundId}/close`)).set(h.auth('business')).expect(200);
    expect(closed.body).toMatchObject({ id: roundId, status: 'closed' });
    expect(closed.body.closedAt).toBeTruthy();
    await h.http.post(url(`/rounds/${roundId}/close`)).set(h.auth('pm')).expect(200);
    // Событие раунда — одно на действие: повтор по закрытому ничего не дописывает (ADR 011)
    expect(await h.prisma.roundEvent.findMany({ where: { roundId }, select: { action: true, userId: true, actorName: true, role: true } })).toEqual([
      { action: 'close', userId: h.users.business.id, actorName: 'business', role: 'business' },
    ]);

    const add = await h.http.post(url(`/rounds/${roundId}/remarks`)).set(h.auth('business')).send({ description: 'Ещё одно' }).expect(409);
    expect(add.body.message).toMatch(/закрыт/);
    const csv = 'external_id,page_or_screen,description,expected,severity,screenshot\n1,Главная,Строка,,,\n';
    await h.http.post(url('/imports')).set(h.auth('pm')).field('roundId', roundId).attach('file', Buffer.from(csv), 'j.csv').expect(409);

    const list = await h.http.get(url('/rounds')).set(h.auth('pm')).expect(200);
    const summary = list.body.find((r: { id: string }) => r.id === roundId);
    // Сводка для страницы «Раунды»: когда открыт, кто и когда закрыл, из чего состоит (ADR 011)
    expect(summary).toMatchObject({ status: 'closed', remarks: 2, pending: 0, closed: 1, changeRequests: 1, duplicates: 0, closedByName: 'business', closedByRole: 'business' });
    expect(new Date(summary.createdAt).getTime()).toBeLessThanOrEqual(new Date(summary.closedAt).getTime());
  });

  /** Скачать xlsx и прочитать лист строками «шапка → значение». */
  const download = async (path: string, role: 'pm' | 'business') => {
    const res = await h.http.get(url(path)).set(h.auth(role)).expect(200).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const sheet = (name: string) => {
      const ws = wb.getWorksheet(name)!;
      const header = (ws.getRow(1).values as string[]).slice(1);
      const rows = [];
      for (let i = 2; i <= ws.rowCount; i++) {
        const v = ws.getRow(i).values as unknown[];
        rows.push(Object.fromEntries(header.map((hd, j) => [hd, v[j + 1] ?? ''])));
      }
      return rows as Array<Record<string, unknown>>;
    };
    return { disposition: String(res.headers['content-disposition']), names: wb.worksheets.map((w) => w.name), sheet };
  };

  it('выгрузка раунда — тот же журнал на один раунд: PM видит комментарий решения, заказчик — нет; строки в порядке номеров', async () => {
    const pmFile = await download(`/rounds/${roundId}/export.xlsx`, 'pm');
    expect(pmFile.disposition).toMatch(/round-1\.xlsx/);
    expect(pmFile.names).toEqual(['Раунды', 'Замечания', 'История']);
    const pm = pmFile.sheet('Замечания');
    expect(pm.map((r) => r['№'])).toEqual([970, 971]);
    expect(pm[0]).toMatchObject({ Раунд: 1, 'Что не так': 'Кнопка серая', Статус: 'Закрыто', Решение: 'В работу разработчикам', 'Комментарий к решению': 'Внутренняя пометка' });
    expect(pm[1]).toMatchObject({ Статус: 'Новое желание' });
    const biz = (await download(`/rounds/${roundId}/export.xlsx`, 'business')).sheet('Замечания');
    expect(biz[0]).toMatchObject({ Статус: 'Закрыто', Решение: 'В работу разработчикам', 'Комментарий к решению': '' });
  });

  it('журнал проекта: раунды с тем, кто закрыл, история с датами в поясе отчёта; разработчику — 403', async () => {
    await h.http.get(url('/rounds/export.xlsx')).set(h.auth('developer')).expect(403);
    await h.http.get(url(`/rounds/${roundId}/export.xlsx`)).set(h.auth('developer')).expect(403);

    const file = await download('/rounds/export.xlsx', 'pm');
    expect(file.disposition).toMatch(/-journal\.xlsx/);
    expect(file.names).toEqual(['Раунды', 'Замечания', 'История']);
    const [round] = file.sheet('Раунды');
    expect(round).toMatchObject({ Раунд: 1, 'Кто закрыл': 'business (заказчик)', Всего: 2, Закрыто: 1, 'Новые желания': 1, 'Не решено': 0 });

    const closeEvent = await h.prisma.roundEvent.findFirstOrThrow({ where: { roundId, action: 'close' } });
    const history = file.sheet('История');
    const roundRow = history.find((e) => e['Действие'] === 'Раунд закрыт')!;
    expect(roundRow).toMatchObject({ Раунд: 1, '№': '', Кто: 'business', Роль: 'заказчик' });
    // Настенное время Алматы (UTC+5): Excel хранит дату без пояса
    const shown = roundRow['Когда (GMT+5)'] as Date;
    expect(Math.round((shown.getTime() - closeEvent.createdAt.getTime()) / 60000)).toBe(5 * 60);
  });

  it('открыть снова: только business, только закрытое, только в открытый раунд; новое замечание помнит оригинал', async () => {
    const next = await h.http.post(url('/rounds')).set(h.auth('pm')).send({}).expect(201);
    await h.http.post(url(`/remarks/${defectId}/reopen`)).set(h.auth('pm')).send({ roundId: next.body.id }).expect(403);
    await h.http.post(url(`/remarks/${defectId}/reopen`)).set(h.auth('business')).send({ roundId }).expect(409);
    const cr = await h.prisma.remark.findFirstOrThrow({ where: { roundId, number: 971 } });
    await h.http.post(url(`/remarks/${cr.id}/reopen`)).set(h.auth('business')).send({ roundId: next.body.id }).expect(409);

    const reopened = await h.http.post(url(`/remarks/${defectId}/reopen`)).set(h.auth('business')).send({ roundId: next.body.id }).expect(201);
    expect(reopened.body).toMatchObject({ status: 'reopened', roundId: next.body.id, description: 'Кнопка серая', pageOrScreen: 'Главная', origin: { remarkId: defectId, number: 970, roundNumber: 1 } });
    expect(reopened.body.number).toBe(1);
    const original = await h.http.get(url(`/remarks/${defectId}`)).set(h.auth('business')).expect(200);
    expect(original.body.status).toBe('closed');
    expect(original.body.reopenedBy).toMatchObject({ remarkId: reopened.body.id, number: 1, roundNumber: 2 });
    // reopened → triaging: обычный старт разбора
    const triaged = await h.http.post(url(`/remarks/${reopened.body.id}/triage`)).set(h.auth('business')).expect(200);
    expect(['triaging', 'awaiting_pm']).toContain(triaged.body.status);
    await h.waitFor(reopened.body.id, ['awaiting_pm', 'imported'], 'pm');

    await h.http.post(url(`/rounds/${roundId}/reopen`)).set(h.auth('business')).expect(200);
    await h.http.post(url(`/rounds/${roundId}/reopen`)).set(h.auth('business')).expect(200);
    const list = await h.http.get(url('/rounds')).set(h.auth('pm')).expect(200);
    expect(list.body.find((r: { id: string }) => r.id === roundId)).toMatchObject({ status: 'open', closedAt: null });
    // closedAt у раунда обнулился, но закрытие осталось в событиях; открытие нового раунда — тоже событие
    const events = await h.prisma.roundEvent.findMany({ where: { projectId: h.projectId }, orderBy: { createdAt: 'asc' }, select: { roundId: true, action: true, role: true } });
    expect(events).toEqual([
      { roundId, action: 'close', role: 'business' },
      { roundId: next.body.id, action: 'open', role: 'pm' },
      { roundId, action: 'reopen', role: 'business' },
    ]);
  });

  it('закрытый раунд — только для чтения: связать повтор нельзя (409)', async () => {
    const closedRound = await h.prisma.round.create({ data: { projectId: h.projectId, number: 7, status: 'closed', closedAt: new Date() } });
    await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: closedRound.id, number: 1, description: 'Оригинал', status: 'closed' } });
    const dup = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: closedRound.id, number: 2, description: 'Повтор', status: 'duplicate' } });
    const res = await h.http.post(url(`/remarks/${dup.id}/link-duplicate`)).set(h.auth('pm')).send({ duplicateOfNumber: 1 }).expect(409);
    expect(res.body.message).toMatch(/закрыт/);
  });
});
