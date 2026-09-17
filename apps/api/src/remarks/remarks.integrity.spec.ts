/**
 * remarks.integrity.spec — аудит: concurrent-verdict-races и evidence-citation-dangling.
 * 1) Два одновременных решения по одной карточке дают одну запись и один 409 — статус пишется условно.
 * 2) Цитата — снимок: переиндексация ТЗ (новые id чанков) не отнимает обоснование у решения.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, type Harness } from '../../test/harness';
import { RagService } from '../rag/rag.service';

describe('remark integrity', () => {
  let h: Harness;
  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  async function awaitingPm(number: number): Promise<{ remarkId: string; runId: string }> {
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number, description: `Гонка ${number}`, status: 'awaiting_pm', rationale: 'Черновик.' } });
    const run = await h.prisma.agentRun.create({ data: { remarkId: remark.id, projectId: h.projectId, status: 'awaiting_human', mode: 'triage' } });
    return { remarkId: remark.id, runId: run.id };
  }

  it('два одновременных вердикта с разными ключами: один HumanVerdict, второй — 409, статус не «произвольный»', async () => {
    const { remarkId, runId } = await awaitingPm(960);
    const fire = (verdict: string) => h.http.post(url(`/remarks/${remarkId}/verdict`)).set(h.auth('pm')).send({ runId, verdict, idempotencyKey: randomUUID() });
    const results = await Promise.all([fire('defect'), fire('change_request'), fire('defect')]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    const verdicts = await h.prisma.humanVerdict.findMany({ where: { remarkId } });
    expect(verdicts).toHaveLength(1);
    const row = await h.prisma.remark.findUniqueOrThrow({ where: { id: remarkId } });
    expect(row.status).toBe(verdicts[0]!.code);
    const lost = results.find((r) => r.status === 409)!;
    expect(lost.body.message).toMatch(/обновите/);
  });

  it('отмена прогона не перезаписывает вердикт, записанный параллельно', async () => {
    const { remarkId, runId } = await awaitingPm(961);
    const [verdict, cancel] = await Promise.all([
      h.http.post(url(`/remarks/${remarkId}/verdict`)).set(h.auth('pm')).send({ runId, verdict: 'defect', idempotencyKey: randomUUID() }),
      h.http.post(url(`/remarks/${remarkId}/cancel`)).set(h.auth('pm')).send({ runId, idempotencyKey: randomUUID() }),
    ]);
    expect([verdict.status, cancel.status].every((s) => s === 200 || s === 409)).toBe(true);
    const row = await h.prisma.remark.findUniqueOrThrow({ where: { id: remarkId } });
    // Либо вердикт успел первым и статус defect, либо отмена — imported; но не «defect, а прогон cancelled поверх вердикта»
    const run = await h.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    if (row.status === 'defect') expect(run.status).toBe('persisted');
    else expect(row.status).toBe('imported');
  });

  it('переиндексация ТЗ после решения: цитата остаётся с тем же текстом, chunkId обнуляется', async () => {
    const spec = await h.prisma.document.findFirstOrThrow({ where: { projectId: h.projectId, kind: 'spec' } });
    const chunk = await h.prisma.documentChunk.findFirstOrThrow({ where: { documentId: spec.id, section: { not: null } } });
    const remark = await h.prisma.remark.create({
      data: {
        projectId: h.projectId,
        roundId: h.roundId,
        number: 962,
        description: 'Кнопка серая',
        status: 'defect',
        rationale: 'Поломка относительно ТЗ.',
        citations: { create: [{ chunkId: chunk.id, quoteText: chunk.content, section: chunk.section, documentTitle: spec.title, documentKind: spec.kind, effectiveAt: spec.effectiveAt }] },
      },
    });
    const before = (await h.http.get(url(`/remarks/${remark.id}`)).set(h.auth('pm')).expect(200)).body;
    expect(before.citations).toHaveLength(1);
    expect(before.citations[0].chunkId).toBe(chunk.id);

    await h.app.get(RagService).indexDocument(spec.id);
    expect(await h.prisma.documentChunk.findUnique({ where: { id: chunk.id } })).toBeNull();

    const after = (await h.http.get(url(`/remarks/${remark.id}`)).set(h.auth('pm')).expect(200)).body;
    expect(after.citations).toHaveLength(1);
    expect(after.citations[0].text).toBe(before.citations[0].text);
    expect(after.citations[0].section).toBe(before.citations[0].section);
    expect(after.citations[0].chunkId).toBeNull();
    // И для заказчика (после решения он видит цитаты)
    const biz = (await h.http.get(url(`/remarks/${remark.id}`)).set(h.auth('business')).expect(200)).body;
    expect(biz.citations[0].text).toBe(before.citations[0].text);
  });
});
