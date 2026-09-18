import { Logger } from '@nestjs/common';

/**
 * Прайс OpenAI на 1M токенов (USD), для `AgentRun.costUsd` и колонки cost в docs/EVALS.md.
 * Langfuse считает стоимость сам по своему прайсу; здесь — та же цифра в БД без Langfuse.
 * Неизвестная модель — 0, а не выдуманная цифра (и одно предупреждение в лог: суточный лимит её не видит).
 *
 * Источник: https://developers.openai.com/api/docs/pricing (бывш. platform.openai.com/docs/pricing), тариф Standard,
 * сверено 18.09.2026 (P3): все цифры ниже совпали со страницей. Скидку за cached input (у 4.1 — вчетверо дешевле)
 * не учитываем: `prompt_tokens_details.cached_tokens` не читается, при срабатывании кэша OpenAI цифра чуть завышена.
 */
const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  // Семейство gpt-5 — reasoning-модели: Chat Completions ждёт max_completion_tokens и температуру по умолчанию,
  // наш вызов с ними не проверялся. Цены здесь, чтобы при пробе стоимость не стала нулём
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-5.4': { input: 2.5, output: 15 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

/** Ключи от длинного к короткому: первый подходящий префикс — самый длинный. */
const KEYS_LONGEST_FIRST = Object.keys(PRICES_PER_MILLION).sort((a, b) => b.length - a.length);
const log = new Logger('pricing');
const warned = new Set<string>();

/**
 * Ключ прайса для имени модели: сначала точное совпадение, потом самый длинный префикс `<ключ>-`
 * (снимок с датой `gpt-4.1-mini-2025-04-14` → `gpt-4.1-mini`). Раньше брался первый префикс по порядку ключей,
 * и `gpt-4.1-mini` считался по цене `gpt-4.1` — в 5 раз дороже (аудит 18.09, раздел 3.4).
 */
export function priceKey(model: string): string | null {
  if (PRICES_PER_MILLION[model]) return model;
  return KEYS_LONGEST_FIRST.find((k) => model.startsWith(`${k}-`)) ?? null;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const key = priceKey(model);
  if (!key) {
    if (!warned.has(model)) {
      warned.add(model);
      log.warn(`модель ${model} без прайса — стоимость не считается, суточный лимит GRAPH_DAILY_USD_PER_PROJECT её не видит`);
    }
    return 0;
  }
  const price = PRICES_PER_MILLION[key]!;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
