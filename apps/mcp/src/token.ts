/**
 * Токен MCP — JWT из `POST /projects/:id/mcp-token` с полем `projectId`.
 * Здесь его только читаем (кому и какому проекту он выдан); подпись проверяет API на каждом вызове.
 * Проект берётся из токена, а не из аргумента tool'а: модель не может попросить чужой projectId.
 */
export interface TokenScope {
  userId: string;
  email: string;
  projectId: string;
  expiresAt?: Date;
}

export function readTokenScope(token: string): TokenScope {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Токен не похож на JWT RemarkRound');
  let payload: { sub?: unknown; email?: unknown; projectId?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Токен не похож на JWT RemarkRound');
  }
  if (typeof payload.sub !== 'string' || typeof payload.projectId !== 'string') {
    throw new Error('Это не токен MCP: нужен токен из POST /projects/:projectId/mcp-token (в нём есть projectId)');
  }
  return {
    userId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    projectId: payload.projectId,
    expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : undefined,
  };
}
