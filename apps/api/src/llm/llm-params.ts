import { config, type AppConfig } from '../config';
import type { LlmCallMeta } from './triage-llm';

/**
 * Гиперпараметры вызовов модели в одном месте (docs/EVALS.md, раздел 4). Значения по умолчанию — те, на которых сняты
 * цифры evals; переменные окружения из config.ts меняют их только для эксперимента (сессия замеров M1):
 *   LLM_TEMP_CLASSIFY, LLM_TEMP_DRAFT, LLM_TOP_P, LLM_MAX_TOKENS_DRAFT, LLM_IMAGE_DETAIL, SKILL_DISABLED, VISION_DISABLED.
 * Почему такие дефолты:
 * - temperature 0 там, где ответ — ярлык, JSON или факты кадра (повторяемость evals); 0.3 — только абзац для человека;
 * - max_tokens — потолок по формату ответа: одна строка запроса 60, одна-две фразы кадра 160, JSON 200–300,
 *   абзац до 60 слов по-русски ≈ 150–200 токенов → 220;
 * - top_p не шлём: OpenAI советует менять либо temperature, либо top_p, а не оба;
 * - detail 'auto': модель сама выбирает разрешение кадра (low дешевле, но мелкий текст на скриншоте теряется).
 */
export type ImageDetail = 'low' | 'high' | 'auto';

export interface LlmParams {
  temperature: { classify: number; draft: number };
  /** null — параметр top_p в запрос не попадает (дефолт OpenAI = 1). */
  topP: number | null;
  maxTokens: Record<LlmCallMeta['node'], number>;
  imageDetail: ImageDetail;
  /** SKILL.md не подмешивается в системные промпты. */
  skillDisabled: boolean;
  /** canSee=false: нода vision пропускается, будто модель не видит кадр. */
  visionDisabled: boolean;
}

export const DEFAULT_LLM_PARAMS: LlmParams = Object.freeze({
  temperature: Object.freeze({ classify: 0, draft: 0.3 }),
  topP: null,
  maxTokens: Object.freeze({ vision: 160, rewrite: 60, classify: 300, draft: 220, explain: 200, judge: 200 }),
  imageDetail: 'auto',
  skillDisabled: false,
  visionDisabled: false,
}) as LlmParams;

/** Имена переменных-переключателей: их значения (если заданы) идут в лог старта и в отчёт evals. */
export const LLM_SWITCHES = ['LLM_TEMP_CLASSIFY', 'LLM_TEMP_DRAFT', 'LLM_TOP_P', 'LLM_MAX_TOKENS_DRAFT', 'LLM_IMAGE_DETAIL', 'SKILL_DISABLED', 'VISION_DISABLED'] as const;

type SwitchConfig = Pick<AppConfig, (typeof LLM_SWITCHES)[number]>;

const on = (v: string | undefined): boolean => v === '1' || v === 'true';

/** Параметры из разобранного конфига: без заданного переключателя — дефолт. */
export function llmParamsFrom(c: SwitchConfig): LlmParams {
  return {
    temperature: { classify: c.LLM_TEMP_CLASSIFY ?? DEFAULT_LLM_PARAMS.temperature.classify, draft: c.LLM_TEMP_DRAFT ?? DEFAULT_LLM_PARAMS.temperature.draft },
    topP: c.LLM_TOP_P ?? DEFAULT_LLM_PARAMS.topP,
    maxTokens: { ...DEFAULT_LLM_PARAMS.maxTokens, draft: c.LLM_MAX_TOKENS_DRAFT ?? DEFAULT_LLM_PARAMS.maxTokens.draft },
    imageDetail: c.LLM_IMAGE_DETAIL ?? DEFAULT_LLM_PARAMS.imageDetail,
    skillDisabled: on(c.SKILL_DISABLED),
    visionDisabled: on(c.VISION_DISABLED),
  };
}

export function llmParams(): LlmParams {
  return llmParamsFrom(config());
}

/** Заданные переключатели как есть («LLM_TEMP_DRAFT=0.7»): пусто — поведение по умолчанию. */
export function activeSwitches(c: SwitchConfig = config()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of LLM_SWITCHES) {
    const v = c[name];
    if (v !== undefined && !(name.endsWith('_DISABLED') && !on(v as string))) out[name] = String(v);
  }
  return out;
}

/** Параметры, общие для chat-вызова шага: temperature, max_tokens и top_p (только если задан). */
export function sampling(p: LlmParams, node: LlmCallMeta['node']): { temperature: number; max_tokens: number; top_p?: number } {
  const temperature = node === 'classify' ? p.temperature.classify : node === 'draft' ? p.temperature.draft : 0;
  return { temperature, max_tokens: p.maxTokens[node], ...(p.topP !== null ? { top_p: p.topP } : {}) };
}
