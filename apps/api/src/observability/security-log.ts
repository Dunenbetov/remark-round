import { Logger } from '@nestjs/common';

/**
 * События безопасности (аудит: no-security-audit-log, минимальный шаг) — одна структурная строка на действие
 * с доступами: вход, регистрация, смена пароля, выпуск MCP-токена, приглашения, участники, администратор.
 * Логгер один на процесс, контекст `security`: `docker compose logs api | grep security.` — уже след для разбора.
 * Таблица AuditEvent с экраном — следующий этап (before_scale).
 */
const log = new Logger('security');

export type SecurityEvent =
  | 'login.ok'
  | 'login.fail'
  | 'login.disabled'
  | 'register'
  | 'password.change'
  | 'password.reset'
  | 'password.reset_link'
  | 'mcp_token.issue'
  | 'invitation.create'
  | 'invitation.link'
  | 'invitation.accept'
  | 'invitation.decline'
  | 'invitation.revoke'
  | 'member.add'
  | 'member.role'
  | 'member.remove'
  | 'admin.user.update'
  | 'admin.user.revoke_sessions';

export function securityEvent(event: SecurityEvent, fields: Record<string, unknown>): void {
  log.log({ event: `security.${event}`, ...fields });
}
