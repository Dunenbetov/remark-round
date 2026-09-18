import type { LlmCallMeta } from './triage-llm';

/**
 * Журнал вызовов модели для отчёта evals (docs/defense P4): шаг графа, модель, finish_reason, токены, $ и время
 * каждого вызова. AgentRun хранит только сумму по прогону — по ней не видно, какой шаг сколько стоит и сколько
 * ответов обрезал max_tokens (finish_reason=length).
 *
 * По умолчанию выключен: в продукте ничего не копится. Включает раннер evals на время прогона.
 */
export interface LlmCallRecord {
  runId: string;
  node: LlmCallMeta['node'];
  model: string;
  /** stop | length | content_filter | …; null — SDK не вернул. */
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

class LlmCallLog {
  private enabled = false;
  private rows: LlmCallRecord[] = [];

  enable(): void {
    this.enabled = true;
  }

  /** Выключить и забыть накопленное. */
  disable(): void {
    this.enabled = false;
    this.rows = [];
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  record(row: LlmCallRecord): void {
    if (this.enabled) this.rows.push(row);
  }

  /** Вызовы прогона; после чтения они из журнала удаляются. */
  take(runId: string): LlmCallRecord[] {
    const mine = this.rows.filter((r) => r.runId === runId);
    if (mine.length) this.rows = this.rows.filter((r) => r.runId !== runId);
    return mine;
  }
}

export const llmCallLog = new LlmCallLog();
