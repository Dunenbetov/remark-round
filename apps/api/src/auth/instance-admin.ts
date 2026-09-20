import { config } from '../config';

/**
 * Администратор инстанса (ADR 006): e-mail из ADMIN_EMAILS, не проектная роль. Отдельный модуль без сервисов,
 * чтобы members.service и invitations.service могли проверять его без круга auth ↔ tenancy.
 */
export function isInstanceAdmin(email: string): boolean {
  return config().adminEmails.has(email.trim().toLowerCase());
}
