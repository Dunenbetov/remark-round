/**
 * Прайс OpenAI на 1M токенов (USD), для `AgentRun.costUsd` и колонки cost в docs/EVALS.md.
 * Langfuse считает стоимость сам по своему прайсу; здесь — та же цифра в БД без Langfuse.
 * Неизвестная модель — 0, а не выдуманная цифра.
 */
const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(PRICES_PER_MILLION).find((k) => model === k || model.startsWith(`${k}-`));
  const price = key ? PRICES_PER_MILLION[key]! : { input: 0, output: 0 };
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
