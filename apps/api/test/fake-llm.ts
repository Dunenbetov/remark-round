import type { ClassifyInput, ClassifyResult, DraftInput, LlmCallMeta, TriageLlm } from '../src/llm/triage-llm';
import { RulesTriageLlm } from '../src/llm/triage-llm';

/**
 * LLM для тестов: те же правила, что на стенде без ключа (офлайн, детерминированно),
 * плюс ручки, чтобы проверить ворота графа: `nextDraft` подсовывает черновик с выдуманным разделом.
 */
export class FakeLlmService extends RulesTriageLlm implements TriageLlm {
  override readonly model = 'fake/rules';
  /** Если задано — draft вернёт этот текст (каждый раз), чтобы faithfulness его ловил. */
  nextDraft: string | null = null;
  /** Ошибки, которые classify бросит по очереди (по одной на вызов): так проверяют повторы очереди задач. */
  readonly failNext: Error[] = [];
  readonly calls: LlmCallMeta['node'][] = [];
  /** Задержка classify (мс): «медленная модель» для проверки дедлайна прогона (GRAPH_RUN_TIMEOUT_MS). */
  delayMs = 0;

  override async classify(meta: LlmCallMeta, input: ClassifyInput): Promise<ClassifyResult> {
    this.calls.push('classify');
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const err = this.failNext.shift();
    if (err) throw err;
    return super.classify(meta, input);
  }

  override async draft(meta: LlmCallMeta, input: DraftInput, onToken?: (delta: string) => void): Promise<string> {
    this.calls.push('draft');
    if (this.nextDraft !== null) {
      onToken?.(this.nextDraft);
      return this.nextDraft;
    }
    return super.draft(meta, input, onToken);
  }
}
