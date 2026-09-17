import { HttpErrorResponse } from '@angular/common/http';
import { ERROR } from './copy';

/** Ошибка от HttpClient или от комнаты WS (`{ status, error: { message } }` из WsService.command). */
interface ApiErrorLike {
  status?: number;
  error?: { message?: string | string[]; requestId?: string } | null;
  message?: string;
}

export function errorStatus(err: unknown): number {
  if (err instanceof HttpErrorResponse) return err.status;
  const e = err as ApiErrorLike | null;
  return typeof e?.status === 'number' ? e.status : 0;
}

/** Сообщение сервера из тела ошибки (строка или список валидации), если оно есть. */
function serverMessage(err: unknown): string | null {
  const e = err as ApiErrorLike | null;
  const m = e?.error?.message;
  if (Array.isArray(m)) return m.join(', ');
  return typeof m === 'string' && m.trim() ? m : null;
}

/**
 * Текст ошибки для человека (аудит: no-error-tracking). До этого заказчик на планшете видел сырые английские
 * тексты Angular; теперь — по статусу и по-русски, а для 5xx — requestId, который называют в поддержку.
 */
export function errorMessage(err: unknown, fallback: string = ERROR.request): string {
  const status = errorStatus(err);
  const fromServer = serverMessage(err);
  const requestId = (err as ApiErrorLike | null)?.error?.requestId;
  if (status === 0) return typeof navigator !== 'undefined' && navigator.onLine === false ? ERROR.offline : ERROR.network;
  if (status === 401) return ERROR.unauthorized;
  if (status === 403) return fromServer ?? ERROR.forbidden;
  if (status === 404) return fromServer ?? ERROR.notFound;
  if (status === 409) return fromServer ?? ERROR.conflict;
  if (status === 413) return ERROR.tooLarge;
  if (status === 422) return fromServer ?? ERROR.invalid;
  if (status === 429) return ERROR.tooMany;
  if (status >= 500) return ERROR.server(requestId);
  return fromServer ?? fallback;
}
