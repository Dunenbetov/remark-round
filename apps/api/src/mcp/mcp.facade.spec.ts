/**
 * mcp.facade.spec — DoD фазы 7: MCP можно дёрнуть не из Angular.
 * Настоящий процесс apps/mcp (stdio) поверх тестового API: проект берётся из токена,
 * чужой проект для такого токена не существует, вердикт — только роль pm, закрытия через MCP нет.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Role } from '@remarkround/db';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DocumentsService } from '../documents/documents.service';
import { hashPassword } from '../auth/password';
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

  /** Cursor / Claude Desktop делают то же самое: команда + env, дальше JSON-RPC по stdio. */
  async function connect(token: string): Promise<Client> {
    const transport = new StdioClientTransport({
      command: TSX,
      args: [MCP_MAIN],
      cwd: ROOT,
      env: { ...getDefaultEnvironment(), REMARKROUND_API_URL: apiUrl, REMARKROUND_TOKEN: token },
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

  it('search_spec находит спеку своего проекта с разделом и цитатой', async () => {
    const res = await call(pmMcp, 'search_spec', { query: 'какого цвета primary-кнопка', k: 3 });
    expect(res.isError).toBe(false);
    expect(res.text).toContain('§2.1 Primary');
    expect(res.text).toContain('#0B5FFF');
    expect(res.text).toContain('TZ.md');
  });

  it('search_spec не отдаёт чанки чужого проекта — фильтр в SQL, не в промпте', async () => {
    const res = await call(pmMcp, 'search_spec', { query: 'пурпурный единорог ZQX9', k: 10 });
    expect(res.isError).toBe(false);
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

    // Бизнес вердикт не ставит — роль режет API, MCP отдаёт это как текст, а не как падение процесса.
    const denied = await call(businessMcp, 'apply_human_verdict', { remarkId: id, verdict: 'defect' });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/Роль не позволяет/);

    const verdict = await call(pmMcp, 'apply_human_verdict', { remarkId: id, verdict: 'defect', comment: 'В работу' });
    expect(verdict.isError).toBe(false);
    expect(verdict.text).toContain('Статус: defect');
    const afterVerdict = await h.http.get(`/api/v1/projects/${h.projectId}/remarks/${id}`).set(h.auth('pm')).expect(200);
    expect(afterVerdict.body.status).toBe('defect');
    expect(afterVerdict.body.verdict.code).toBe('defect');

    // Второй вердикт по тому же замечанию: статус уже не awaiting_pm — MCP не пытается обойти машину состояний.
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
    const user = await h.prisma.user.create({ data: { email: `nobody-${Date.now()}@test.dev`, name: 'nobody', passwordHash: hashPassword(PASSWORD) } });
    try {
      const login = await h.http.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
      await expect(connect(login.body.accessToken)).rejects.toThrow();
    } finally {
      await h.prisma.user.delete({ where: { id: user.id } });
    }
  }, 30000);
});
