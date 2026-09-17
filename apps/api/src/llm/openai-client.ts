import OpenAI from 'openai';

/** Зависший вызов модели иначе держал бы прогон 10 минут (дефолт SDK); повторов два — сетевые сбои, не «дорогие» ретраи. */
export const OPENAI_TIMEOUT_MS = Number(process.env['OPENAI_TIMEOUT_MS'] ?? 60_000);

export function createOpenAi(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 2 });
}
