/**
 * Точка входа apps/mcp.
 *  - stdio (по умолчанию): Cursor, Claude Code, Claude Desktop запускают процесс сами; токен или логин — из env.
 *  - http (docker compose): Streamable HTTP без сессий, токен MCP в заголовке Authorization каждого запроса.
 * Логи — только в stderr: stdout занят JSON-RPC.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ApiError, RemarkRoundApi } from './api-client';
import { readConfig, type McpConfig } from './config';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server';
import { readTokenScope, type TokenScope } from './token';

const log = (...args: unknown[]): void => console.error('[remarkround-mcp]', ...args);

/** Токен из env или логин + выпуск токена проекта через API (тот же membership). */
async function resolveToken(cfg: McpConfig, api: RemarkRoundApi): Promise<string> {
  if (cfg.token) return cfg.token;
  if (!cfg.email || !cfg.password) {
    const missing = [cfg.email ? null : 'REMARKROUND_EMAIL', cfg.password ? null : 'REMARKROUND_PASSWORD'].filter(Boolean).join(', ');
    throw new Error(
      `Не задано: ${missing}. Нужен REMARKROUND_TOKEN (токен проекта: POST /api/v1/projects/:projectId/mcp-token) ` +
        'или пара REMARKROUND_EMAIL + REMARKROUND_PASSWORD. Задайте переменные в терминале и запустите IDE из него — apps/mcp/README.md',
    );
  }
  const login = await api.login(cfg.email, cfg.password);
  api.useToken(login.accessToken);
  const memberships = login.memberships;
  const list = memberships.map((m) => `${m.projectId} — ${m.projectName} (${m.role})`).join('\n  ') || '— ни одного';
  const projectId = cfg.projectId ?? (memberships.length === 1 ? memberships[0]!.projectId : undefined);
  if (!projectId) throw new Error(`У пользователя несколько проектов, задайте REMARKROUND_PROJECT_ID:\n  ${list}`);
  if (!memberships.some((m) => m.projectId === projectId)) {
    throw new Error(`REMARKROUND_PROJECT_ID=${projectId}: у ${cfg.email} нет такого проекта. Проекты пользователя:\n  ${list}`);
  }
  return (await api.mcpToken(projectId)).token;
}

async function stdio(cfg: McpConfig): Promise<void> {
  const api = new RemarkRoundApi(cfg.apiUrl, undefined);
  const token = await resolveToken(cfg, api);
  const scope = readTokenScope(token);
  api.useToken(token);
  const project = await api.project(scope.projectId);
  const server = createServer(api, scope, { allowLocalFiles: true });
  await server.connect(new StdioServerTransport());
  log(`stdio: ${scope.email} → проект «${project.name}» (${scope.projectId}), API ${cfg.apiUrl}`);
}

function http(cfg: McpConfig): void {
  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') return json(res, 200, { ok: true, name: SERVER_NAME, version: SERVER_VERSION });
    if (url.pathname !== '/mcp') return json(res, 404, { message: 'MCP endpoint: /mcp' });

    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    let scope: TokenScope;
    try {
      if (!token) throw new Error('Нужен заголовок Authorization: Bearer <токен из POST /projects/:id/mcp-token>');
      scope = readTokenScope(token);
    } catch (e) {
      return json(res, 401, { message: (e as Error).message });
    }

    const api = new RemarkRoundApi(cfg.apiUrl, token);
    const server = createServer(api, scope, { allowLocalFiles: false });
    // Без сессий: каждый запрос — свой транспорт, любой токен проверяет API на каждом вызове.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, await readBody(req));
    } catch (e) {
      log('http error', e);
      if (!res.headersSent) json(res, 500, { message: 'Внутренняя ошибка MCP' });
    }
  });
  httpServer.listen(cfg.port, () => log(`http: POST /mcp на порту ${cfg.port}, API ${cfg.apiUrl}`));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method !== 'POST') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function main(): Promise<void> {
  const cfg = readConfig();
  if (cfg.transport === 'http') http(cfg);
  else await stdio(cfg);
}

main().catch((e) => {
  log(e instanceof ApiError ? `API: ${e.message}` : e instanceof Error ? e.message : e);
  process.exit(1);
});
