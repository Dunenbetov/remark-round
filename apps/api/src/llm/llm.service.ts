import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { createOpenAi } from './openai-client';
import { ObservabilityService } from '../observability/observability.service';
import { OpenAiTriageLlm } from './openai-triage-llm';
import type { ClassifyInput, ClassifyResult, DraftInput, LlmCallMeta, LlmUsage, RetestExplainInput, RetestExplainResult, RetestJudgeInput, RewriteInput, TriageLlm, VisionInput } from './triage-llm';
import { RulesTriageLlm } from './triage-llm';

/**
 * Единственная точка LLM-вызовов графа (docs/ENGINEERING.md, паттерн 3). С OPENAI_API_KEY — официальный SDK,
 * без ключа — правила по retrieve: стенд и тесты работают офлайн, а не падают 500 на «модель недоступна».
 * В тестах провайдер подменяется на FakeLlm (test/fake-llm.ts), как EmbeddingsService.
 */
@Injectable()
export class LlmService implements TriageLlm {
  private readonly log = new Logger(LlmService.name);
  private readonly impl: TriageLlm;

  constructor(observability: ObservabilityService) {
    const apiKey = process.env['OPENAI_API_KEY'];
    // Режим — из config(): в production без ключа процесс не стартует, пока владелец не скажет LLM_MODE=rules явно (аудит: тихий fallback).
    // Каждый вызов OpenAI — generation-span Langfuse с именем ноды (фаза 8); без ключей Langfuse клиент отдаётся как есть.
    this.impl = config().llmMode === 'openai' && apiKey ? new OpenAiTriageLlm(createOpenAi(apiKey), undefined, (client, meta) => observability.openai(client, meta)) : new RulesTriageLlm();
    if (this.impl instanceof RulesTriageLlm) this.log.warn(`triage llm: ${this.impl.model} — черновики по правилам без модели (грубее; см. /health.llm)`);
    else this.log.log(`triage llm: ${this.impl.model}`);
  }

  get model(): string {
    return this.impl.model;
  }

  /** Что сейчас за черновиками: модель или правила. Отдаётся в /health и на карточке. */
  get mode(): 'openai' | 'rules' {
    return this.impl instanceof RulesTriageLlm ? 'rules' : 'openai';
  }

  get canSee(): boolean {
    return this.impl.canSee;
  }

  visionFacts(meta: LlmCallMeta, input: VisionInput): Promise<string | null> {
    return this.impl.visionFacts(meta, input);
  }

  rewriteQuery(meta: LlmCallMeta, input: RewriteInput): Promise<string> {
    return this.impl.rewriteQuery(meta, input);
  }

  classify(meta: LlmCallMeta, input: ClassifyInput): Promise<ClassifyResult> {
    return this.impl.classify(meta, input);
  }

  draft(meta: LlmCallMeta, input: DraftInput, onToken?: (delta: string) => void): Promise<string> {
    return this.impl.draft(meta, input, onToken);
  }

  retestExplain(meta: LlmCallMeta, input: RetestExplainInput): Promise<RetestExplainResult> {
    return this.impl.retestExplain(meta, input);
  }

  retestJudge(meta: LlmCallMeta, input: RetestJudgeInput): Promise<RetestExplainResult> {
    return this.impl.retestJudge(meta, input);
  }

  takeUsage(runId: string): LlmUsage {
    return this.impl.takeUsage(runId);
  }
}
