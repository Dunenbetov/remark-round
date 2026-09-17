import { ErrorHandler, Injectable } from '@angular/core';
import * as Sentry from '@sentry/browser';

/**
 * Sentry для SPA (ревью беты R-L5): без него падения фронта у пользователей невидимы — глобальный ErrorHandler
 * ничего не репортил. DSN приходит с сервера (GET /auth/options → sentryDsn) и только когда там задан SENTRY_DSN_WEB:
 * в бандле адресов нет, без DSN ничего не инициализируется. Только ошибки: трейсинг, replay и хлебные крошки выключены —
 * это бета, а не аналитика поведения.
 */
let enabled = false;

export function initErrorReporting(options: { sentryDsn?: string; release: string }): void {
  if (!options.sentryDsn || enabled) return;
  Sentry.init({
    dsn: options.sentryDsn,
    release: options.release,
    environment: location.hostname,
    defaultIntegrations: false,
    integrations: [Sentry.globalHandlersIntegration(), Sentry.dedupeIntegration(), Sentry.linkedErrorsIntegration()],
    sendDefaultPii: false,
  });
  enabled = true;
}

/** Ошибки Angular (шаблоны, эффекты, необработанные промисы) — в Sentry и, как раньше, в консоль. */
@Injectable()
export class ReportingErrorHandler extends ErrorHandler {
  override handleError(error: unknown): void {
    if (enabled) Sentry.captureException(error);
    super.handleError(error);
  }
}
