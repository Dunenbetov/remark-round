/**
 * Настройки процесса из окружения. Секретов в репозитории нет: токен или логин приходят из env
 * (Cursor, Claude Code, Claude Desktop передают их из своего mcp.json / .mcp.json).
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
    apiUrl: (envValue(env, 'REMARKROUND_API_URL') ?? 'http://localhost:3001/api/v1').replace(/\/+$/, ''),
    transport,
    port: Number(env['MCP_PORT'] ?? 3002),
    token: envValue(env, 'REMARKROUND_TOKEN'),
    email: envValue(env, 'REMARKROUND_EMAIL'),
    password: envValue(env, 'REMARKROUND_PASSWORD'),
    projectId: envValue(env, 'REMARKROUND_PROJECT_ID'),
  };
}

/**
 * Значение переменной или undefined. Пустая строка и неподставленный шаблон считаются «не задано»: Claude Code
 * оставляет `${VAR}` без значения как есть, у Cursor шаблон `${env:VAR}`. Иначе такой «пароль» ушёл бы в API
 * и вернулся бы отказом входа вместо понятного «задайте переменную».
 */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (!value || /^\$\{[^}]*\}$/.test(value.trim())) return undefined;
  return value;
}
