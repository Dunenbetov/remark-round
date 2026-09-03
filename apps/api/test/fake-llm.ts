import type { DraftInput, LlmCallMeta, TriageLlm } from '../src/llm/triage-llm';
import { RulesTriageLlm } from '../src/llm/triage-llm';

/**
 * LLM для тестов: те же правила, что на стенде без ключа (офлайн, детерминированно),
 * плюс ручки, чтобы проверить ворота графа: `nextDraft` подсовывает черновик с выдуманным разделом.
 */
export class FakeLlmService extends RulesTriageLlm implements TriageLlm {
  override readonly model = 'fake/rules';
  /** Если задано — draft вернёт этот текст (каждый раз), чтобы faithfulness его ловил. */
  nextDraft: string | null = null;
  readonly calls: LlmCallMeta['node'][] = [];

  override async draft(meta: LlmCallMeta, input: DraftInput, onToken?: (delta: string) => void): Promise<string> {
    this.calls.push('draft');
    if (this.nextDraft !== null) {
      onToken?.(this.nextDraft);
      return this.nextDraft;
    }
    return super.draft(meta, input, onToken);
  }
}
