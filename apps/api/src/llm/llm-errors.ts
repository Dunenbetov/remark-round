/**
 * Класс ошибки прогона (аудит: no-error-tracking, llm-outage-retry): код для логов, статистики и очереди задач
 * (временные ошибки модели повторяются с паузой), текст — для карточки. Ошибки OpenAI SDK несут status и name
 * (APIConnectionTimeoutError, RateLimitError, AuthenticationError…); всё остальное — unknown с честным текстом.
 */
export interface RunFailure {
  code: string;
  message: string;
}

const RETRYABLE: ReadonlySet<string> = new Set(['llm_timeout', 'llm_rate_limit', 'llm_unavailable']);

export function classifyRunError(e: unknown): RunFailure {
  const err = e as { name?: string; status?: number; code?: string; type?: string; error?: { code?: string; type?: string } | null; message?: string } | null;
  const name = err?.name ?? '';
  const status = typeof err?.status === 'number' ? err.status : 0;
  const text = err?.message ?? '';
  if (name === 'APIConnectionTimeoutError' || err?.code === 'ETIMEDOUT' || /timed out/i.test(text)) return { code: 'llm_timeout', message: 'Модель не ответила вовремя — запустите снова' };
  // Тот же 429, но на счёте OpenAI кончились деньги (P2): повтор через 30 с / 2 мин / 8 мин не поможет — чинит администратор
  if (isQuotaExhausted(err, text)) return { code: 'llm_quota', message: 'Закончился баланс OpenAI — разбор не повторяется, сообщите администратору' };
  if (status === 429 || name === 'RateLimitError') return { code: 'llm_rate_limit', message: 'Модель перегружена (лимит запросов) — подождите минуту и запустите снова' };
  if (status === 401 || status === 403 || name === 'AuthenticationError' || name === 'PermissionDeniedError') return { code: 'llm_auth', message: 'Ключ модели не принят — сообщите администратору' };
  if (status === 400 || status === 404 || status === 422 || name === 'BadRequestError' || name === 'NotFoundError') return { code: 'llm_bad_request', message: 'Модель отклонила запрос — сообщите администратору' };
  if (status >= 500 || name === 'APIConnectionError' || name === 'InternalServerError') return { code: 'llm_unavailable', message: 'Сервис модели недоступен — повторите позже' };
  if (err?.code === 'ENOENT' || /^storage:/.test(text)) return { code: 'storage', message: 'Файл кадра или документа не найден — прикрепите заново' };
  return { code: 'unknown', message: 'Не получилось разобрать. Можно запустить снова' };
}

/** 429 `insufficient_quota` OpenAI SDK: код в `code`/`type` ошибки (APIError копирует их из тела), текст — «exceeded your current quota». */
function isQuotaExhausted(err: { code?: string; type?: string; error?: { code?: string; type?: string } | null } | null, text: string): boolean {
  const codes = [err?.code, err?.type, err?.error?.code, err?.error?.type];
  return codes.includes('insufficient_quota') || /insufficient_quota|exceeded your current quota/i.test(text);
}

/** Временная ошибка модели: очередь повторит задачу с паузой, а не покажет человеку «не получилось». */
export function isRetryable(failure: RunFailure): boolean {
  return RETRYABLE.has(failure.code);
}
