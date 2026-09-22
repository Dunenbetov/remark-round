/**
 * graph.settle.spec — окно между propose и паузой графа. Нода propose переводит замечание в awaiting_pm раньше, чем граф
 * запишет чекпоинт interrupt; на медленном раннере CI человек (тест) успевал нажать кнопку в это окно. Здесь окно
 * растянуто нарочно: запись чекпоинта ждёт 300 мс. Решение PM должно дождаться паузы, а не застать граф на ходу.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, type Harness } from '../../test/harness';
import { PrismaCheckpointSaver } from './prisma-checkpointer';

const SLOW_WRITE_MS = 300;

describe('graph: решение человека в окне до паузы графа', () => {
  let h: Harness;
  let slowDump: jest.SpyInstance;

  beforeAll(async () => {
    h = await createHarness();
    // Медленная сериализация — внутри записи чекпоинта (put и putWrites), как медленный раннер CI
    type WithDump = { dump: (value: unknown) => Promise<unknown> };
    const proto = PrismaCheckpointSaver.prototype as unknown as WithDump;
    const original = proto.dump;
    slowDump = jest.spyOn(proto, 'dump').mockImplementation(async function (this: WithDump, value: unknown) {
      await new Promise((r) => setTimeout(r, SLOW_WRITE_MS));
      return original.call(this, value);
    });
  });

  afterAll(async () => {
    slowDump.mockRestore();
    await h.cleanup();
  });

  async function create(description: string): Promise<{ id: string; runId: string }> {
    const res = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description, pageOrScreen: 'Профиль', screenshotKey: `${h.projectId}/${randomUUID()}.svg` })
      .expect(201);
    return { id: res.body.id, runId: res.body.runId };
  }

  it('«Не та цитата» сразу после awaiting_pm продолжает тот же run с комментарием, а не повторяет старое предложение', async () => {
    const { id, runId } = await create('Главную кнопку сделайте серой как в разделе 5');
    const first = await h.waitFor(id, ['awaiting_pm']);
    expect(first.citations).toEqual([]);
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${id}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'rejected_binding', comment: 'Смотрите раздел 5 про серую кнопку', runId, idempotencyKey: randomUUID() })
      .expect(200);
    const rebound = await h.waitFor(id, ['awaiting_pm']);
    expect(rebound.runId).toBe(runId);
    expect(rebound.citations[0]?.chunkId).toBeTruthy();
    expect(await h.prisma.agentRun.count({ where: { remarkId: id } })).toBe(1);
  });

  it('отмена сразу после awaiting_pm: чекпоинты удалены после того, как граф дописал последний', async () => {
    const { id, runId } = await create('Логотип не по центру');
    await h.waitFor(id, ['awaiting_pm']);
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${id}/cancel`).set(h.auth('pm')).send({ runId, idempotencyKey: randomUUID() }).expect(200);
    expect(await h.prisma.graphCheckpoint.count({ where: { runId } })).toBe(0);
    // Запоздалая запись прерванного графа пришла бы в пределах одной медленной записи
    await new Promise((r) => setTimeout(r, SLOW_WRITE_MS * 2));
    expect(await h.prisma.graphCheckpoint.count({ where: { runId } })).toBe(0);
  });
});
