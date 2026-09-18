/**
 * mcp.facade.spec — DoD фазы 7: MCP можно дёрнуть не из Angular.
 * Настоящий процесс apps/mcp (stdio) поверх тестового API: проект берётся из токена,
 * чужой проект для такого токена не существует, решение — только роль pm, закрытия через MCP нет.
 * search_spec (D3, 18.09): опора — только фрагмент не ниже порога графа BOUND_SCORE, который API отдаёт в boundScore;
 * если выше порога ничего нет — «Опоры нет» без фрагментов.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Role } from '@remarkround/db';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DocumentsService } from '../documents/documents.service';
import { hashPassword } from '../auth/password';
import { BOUND_SCORE } from '../llm/triage-llm';
import { RagService } from '../rag/rag.service';
import { createHarness, Harness, PASSWORD } from '../../test/harness';

const ROOT = resolve(__dirname, '../../../..');
const MCP_MAIN = resolve(ROOT, 'apps/mcp/src/main.ts');
const TSX = resolve(ROOT, 'apps/mcp/node_modules/.bin/tsx');
const SHOTS = resolve(ROOT, 'fixtures/screenshots');
const GRAY = readFileSync(resolve(SHOTS, 'before-save-gray.png'));
const AFTER = resolve(SHOTS, 'after-save-blue.png');

interface ToolText {
  text: string;
  isError: boolean;
}

describe('MCP-фасад (apps/mcp по stdio)', () => {
  let h: Harness;
  let apiUrl: string;
  let projectB: { id: string; docId: string };
  let pmMcp: Client;
  let businessMcp: Client;
  const clients: Client[] = [];

  async function mcpToken(role: Role, projectId = h.projectId): Promise<string> {
    const res = await h.http.post(`/api/v1/projects/${projectId}/mcp-token`).set(h.auth(role)).expect(200);
    return res.body.token as string;
  }

  /** Cursor / Claude Code / Claude Desktop делают то же самое: команда + env, дальше JSON-RPC по stdio. */
  async function connect(token: string, api = apiUrl): Promise<Client> {
    const transport = new StdioClientTransport({
      command: TSX,
      args: [MCP_MAIN],
      cwd: ROOT,
      env: { ...getDefaultEnvironment(), REMARKROUND_API_URL: api, REMARKROUND_TOKEN: token },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'mcp.facade.spec', version: '0' });
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolText> {
    const res = await client.callTool({ name, arguments: args });
    const content = res.content as Array<{ type: string; text?: string }>;
    return { text: content.map((c) => c.text ?? '').join('\n'), isError: Boolean(res.isError) };
  }

  beforeAll(async () => {
    expect(existsSync(TSX)).toBe(true);
    h = await createHarness();
    await h.app.listen(0);
    apiUrl = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}/api/v1`;

    // Проект B с приметным документом: pm состоит и там, но токен MCP выдан проекту A.
    const other = await h.prisma.project.create({ data: { name: `H-other-${Date.now()}` } });
    await h.prisma.membership.create({ data: { userId: h.users.pm.id, projectId: other.id, role: 'pm' } });
    const documents = h.app.get(DocumentsService);
    const rag = h.app.get(RagService);
    const ctxB = { userId: h.users.pm.id, projectId: other.id, role: 'pm' as Role };
    const doc = await documents.upload(
      ctxB,
      { kind: 'spec', fileName: 'B.md', data: Buffer.from('# ТЗ B\n\n## §9.9 Единорог\n\nПурпурный единорог ZQX9 на главной странице проекта B.\n'), effectiveAt: null },
      { indexInBackground: false },
    );
    await rag.indexDocument(doc.id);
    projectB = { id: other.id, docId: doc.id };

    pmMcp = await connect(await mcpToken('pm'));
    businessMcp = await connect(await mcpToken('business'));
  }, 60000);

  afterAll(async () => {
    for (const c of clients) await c.close().catch(() => undefined);
    await h.prisma.documentChunk.deleteMany({ where: { projectId: projectB.id } });
    await h.prisma.document.deleteMany({ where: { projectId: projectB.id } });
    await h.prisma.membership.deleteMany({ where: { projectId: projectB.id } });
    await h.prisma.project.delete({ where: { id: projectB.id } });
    await h.cleanup();
  });

  it('токен MCP выдаётся только участнику и привязан к проекту', async () => {
    const res = await h.http.post(`/api/v1/projects/${h.projectId}/mcp-token`).set(h.auth('pm')).expect(200);
    expect(res.body.projectId).toBe(h.projectId);
    expect(res.body.role).toBe('pm');
    const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.projectId).toBe(h.projectId);
    expect(payload.sub).toBe(h.users.pm.id);

    // developer не состоит в проекте B — чужой проект выглядит как 404, не 403.
    await h.http.post(`/api/v1/projects/${projectB.id}/mcp-token`).set(h.auth('developer')).expect(404);
  });

  it('токен проекта A не видит проект B даже при membership; обычный токен видит', async () => {
    const scoped = await mcpToken('pm');
    await h.http.get(`/api/v1/projects/${projectB.id}`).set({ Authorization: `Bearer ${scoped}` }).expect(404);
    await h.http.get(`/api/v1/projects/${projectB.id}/search`).query({ q: 'единорог' }).set({ Authorization: `Bearer ${scoped}` }).expect(404);
    await h.http.get(`/api/v1/projects/${h.projectId}`).set({ Authorization: `Bearer ${scoped}` }).expect(200);
    await h.http.get(`/api/v1/projects/${projectB.id}`).set(h.auth('pm')).expect(200);
  });

  it('четыре содержательных tool, ни один не принимает projectId', async () => {
    const { tools } = await pmMcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['apply_human_verdict', 'get_round_remarks', 'search_spec', 'submit_retest_evidence']);
    for (const tool of tools) {
      const props = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
      expect(props).not.toContain('projectId');
    }
    const { prompts } = await pmMcp.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['uat-triage']);
  });

  /** Строка фрагмента в ответе search_spec: «[ТЗ · TZ.md · §2.1 Primary] близость 0.65 — опора, chunkId …». */
  const hitLine = (text: string, marker: string): string => text.split('\n').find((l) => l.startsWith('[') && l.includes(marker)) ?? '';

  // Эмбеддинги в тестах — «мешок слов» (test/fake-embeddings.ts): близость здесь лексическая, запросы подобраны под неё.
  it('search_spec: §2.1 своего проекта выше порога графа — опора, соседи ниже порога помечены', async () => {
    const res = await call(pmMcp, 'search_spec', { query: 'какого цвета primary-кнопка «Сохранить» на форме профиля', k: 3 });
    expect(res.isError).toBe(false);
    expect(res.text).toContain('§2.1 Primary');
    expect(res.text).toContain('#0B5FFF');
    expect(res.text).toContain('TZ.md');
    expect(res.text).toMatch(/^Опора — 1 фрагмент из 3 /);
    expect(hitLine(res.text, '§2.1 Primary')).toMatch(/— опора, chunkId/);
    const below = res.text.split('\n').filter((l) => l.startsWith('[') && !l.includes('§2.1 Primary'));
    expect(below).toHaveLength(2);
    for (const line of below) expect(line).toContain(`ниже порога ${BOUND_SCORE}, опорой считать нельзя`);

    // Все фрагменты выше порога — пометок «ниже порога» нет.
    const top = await call(pmMcp, 'search_spec', { query: 'какого цвета primary-кнопка «Сохранить» на форме профиля', k: 1 });
    expect(top.text).toMatch(/^Опора — 1 фрагмент с близостью не ниже порога/);
    expect(top.text).not.toContain('опорой считать нельзя');
  });

  it('search_spec: вопрос не по теме на своём проекте — «Опоры нет», посторонних фрагментов модель не видит', async () => {
    const query = 'сколько стоит доставка пиццы на Марс';
    const res = await call(pmMcp, 'search_spec', { query, k: 5 });
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/^Опоры нет/);
    expect(res.text).toContain(`порога близости ${BOUND_SCORE}`);
    expect(res.text).not.toContain('chunkId');
    expect(res.text).not.toContain('#0B5FFF');

    // Не пустой индекс: REST отдаёт top-k, как и раньше, но ближайший фрагмент ниже порога, который API сообщает в boundScore.
    const direct = await h.http.get(`/api/v1/projects/${h.projectId}/search`).query({ q: query, k: 5 }).set(h.auth('pm')).expect(200);
    expect(direct.body.boundScore).toBe(BOUND_SCORE);
    expect(direct.body.hits.length).toBeGreaterThan(0);
    expect(direct.body.hits[0].score).toBeGreaterThan(0);
    expect(direct.body.hits[0].score).toBeLessThan(BOUND_SCORE);
  });

  it('API без поля boundScore (старый образ API): фасад берёт запасной порог, равный BOUND_SCORE графа', async () => {
    const projectId = '22222222-2222-4222-8222-222222222222';
    const hit = (chunkId: string, score: number) => ({ chunkId, documentId: 'doc', documentTitle: 'TZ.md', documentKind: 'spec', section: '§1', page: null, content: chunkId, score });
    const oldApi = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://old-api').pathname;
      const body =
        path === `/api/v1/projects/${projectId}`
          ? { id: projectId, name: 'Старый API' }
          : path === `/api/v1/projects/${projectId}/search`
            ? { query: 'primary', hits: [hit('chunk-above', BOUND_SCORE + 0.01), hit('chunk-below', BOUND_SCORE - 0.01)] }
            : null;
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' }).end(JSON.stringify(body ?? { message: 'нет такого маршрута' }));
    });
    await new Promise<void>((done) => oldApi.listen(0, '127.0.0.1', done));
    try {
      // Подпись токена проверяет API; фасад только читает projectId — заглушке этого достаточно.
      const payload = Buffer.from(JSON.stringify({ sub: 'old-api-user', email: 'old@test.dev', projectId })).toString('base64url');
      const client = await connect(`e30.${payload}.unsigned`, `http://127.0.0.1:${(oldApi.address() as AddressInfo).port}/api/v1`);
      const res = await call(client, 'search_spec', { query: 'primary' });
      expect(res.isError).toBe(false);
      expect(res.text).toMatch(/^Опора — 1 фрагмент из 2 /);
      expect(hitLine(res.text, 'chunkId chunk-above')).toMatch(/— опора, chunkId/);
      expect(hitLine(res.text, 'chunkId chunk-below')).toContain(`ниже порога ${BOUND_SCORE}, опорой считать нельзя`);
    } finally {
      oldApi.closeAllConnections();
      oldApi.close();
    }
  }, 30000);

  it('search_spec не отдаёт чанки чужого проекта — фильтр в SQL, не в промпте', async () => {
    const res = await call(pmMcp, 'search_spec', { query: 'пурпурный единорог ZQX9', k: 10 });
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/^Опоры нет/);
    expect(res.text).not.toContain('ZQX9');
    expect(res.text).not.toContain('B.md');
    // Через REST тот же документ в B действительно есть — значит, пусто не потому, что не проиндексирован.
    const direct = await h.http.get(`/api/v1/projects/${projectB.id}/search`).query({ q: 'пурпурный единорог ZQX9' }).set(h.auth('pm')).expect(200);
    expect(direct.body.hits.some((x: { documentId: string }) => x.documentId === projectB.docId)).toBe(true);
  });

  it('get_round_remarks → apply_human_verdict (pm) → submit_retest_evidence (business); закрыть через MCP нельзя', async () => {
    const upload = await h.http.post(`/api/v1/projects/${h.projectId}/media`).set(h.auth('business')).attach('file', GRAY, 'before.png').expect(201);
    const created = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'Кнопка «Сохранить» серая, а не синяя', expected: 'Синяя primary', pageOrScreen: 'Профиль', screenshotKey: upload.body.storageKey })
      .expect(201);
    const id = created.body.id as string;
    await h.waitFor(id, ['awaiting_pm']);

    const queue = await call(pmMcp, 'get_round_remarks', { status: 'awaiting_pm' });
    expect(queue.isError).toBe(false);
    expect(queue.text).toContain(id);
    expect(queue.text).toContain('awaiting_pm');
    expect(queue.text).toContain('Сохранить');

    // Бизнес решение не ставит — роль режет API, MCP отдаёт это как текст, а не как падение процесса.
    const denied = await call(businessMcp, 'apply_human_verdict', { remarkId: id, verdict: 'defect' });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/Роль не позволяет/);

    const verdict = await call(pmMcp, 'apply_human_verdict', { remarkId: id, verdict: 'defect', comment: 'В работу' });
    expect(verdict.isError).toBe(false);
    expect(verdict.text).toContain('Статус: defect');
    const afterVerdict = await h.http.get(`/api/v1/projects/${h.projectId}/remarks/${id}`).set(h.auth('pm')).expect(200);
    expect(afterVerdict.body.status).toBe('defect');
    expect(afterVerdict.body.verdict.code).toBe('defect');

    // Второе решение по тому же замечанию: статус уже не awaiting_pm — MCP не пытается обойти машину состояний.
    const again = await call(pmMcp, 'apply_human_verdict', { remarkId: id, verdict: 'change_request' });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/только в awaiting_pm/);

    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${id}/ready-for-retest`).set(h.auth('developer')).expect(200);
    const retest = await call(businessMcp, 'submit_retest_evidence', { remarkId: id, screenshotPath: AFTER });
    expect(retest.isError).toBe(false);
    expect(retest.text).toMatch(/Кадр принят/);
    const closing = await h.waitFor(id, ['awaiting_business_close'], 'business');
    expect(closing.screenshots.map((s: { kind: string }) => s.kind)).toEqual(['original', 'retest', 'diff']);
    expect(['cannot_tell', 'likely_addressed', 'likely_unchanged']).toContain(closing.retest.outcome);

    // Закрытия среди tool'ов нет: статус остаётся awaiting_business_close, пока бизнес не нажмёт кнопку.
    const { tools } = await businessMcp.listTools();
    expect(tools.some((t) => /close/i.test(t.name))).toBe(false);
    const still = await h.http.get(`/api/v1/projects/${h.projectId}/remarks/${id}`).set(h.auth('business')).expect(200);
    expect(still.body.status).toBe('awaiting_business_close');
  }, 60000);

  it('prompt uat-triage отдаёт тот же Skill, что подмешан в ноды графа', async () => {
    const res = await pmMcp.getPrompt({ name: 'uat-triage', arguments: { remark: 'Кнопка не синяя' } });
    const text = (res.messages[0]!.content as { text: string }).text;
    expect(text).toContain('Человек ставит точку');
    expect(text).toContain('Никогда не переводи в `closed`');
    expect(text).toContain('Кнопка не синяя');
    expect(text.startsWith('---')).toBe(false);
  });

  it('незнакомый пользователь: чужой токен (не MCP) не запускает фасад', async () => {
    const user = await h.prisma.user.create({ data: { email: `nobody-${Date.now()}@test.dev`, name: 'nobody', passwordHash: await hashPassword(PASSWORD) } });
    try {
      const login = await h.http.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
      await expect(connect(login.body.accessToken)).rejects.toThrow();
    } finally {
      await h.prisma.user.delete({ where: { id: user.id } });
    }
  }, 30000);
});
