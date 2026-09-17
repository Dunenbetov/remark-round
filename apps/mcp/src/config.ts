/**
 * Настройки процесса из окружения. Секретов в репозитории нет: токен или логин приходят из env
 * (Cursor / Claude Desktop кладут их в свой mcp.json).
 */
export type Transport = 'stdio' | 'http';

export interface McpConfig {
  apiUrl: string;
  transport: Transport;
  port: number;
  /** Готовый токен MCP (`POST /projects/:id/mcp-token`). */
  token?: string;
  /** Либо логин: процесс сам получит токен для проекта. */
  email?: string;
  password?: string;
  projectId?: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const transport = env['MCP_TRANSPORT'] === 'http' ? 'http' : 'stdio';
  return {
    apiUrl: (env['REMARKROUND_API_URL'] ?? 'http://localhost:3001/api/v1').replace(/\/+$/, ''),
    transport,
    port: Number(env['MCP_PORT'] ?? 3002),
    token: env['REMARKROUND_TOKEN'] || undefined,
    email: env['REMARKROUND_EMAIL'] || undefined,
    password: env['REMARKROUND_PASSWORD'] || undefined,
    projectId: env['REMARKROUND_PROJECT_ID'] || undefined,
  };
}
