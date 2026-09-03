import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { OpenAiTriageLlm } from './openai-triage-llm';
import type { ClassifyInput, ClassifyResult, DraftInput, LlmCallMeta, LlmUsage, RetestExplainInput, RetestExplainResult, RewriteInput, TriageLlm, VisionInput } from './triage-llm';
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

  constructor() {
    const apiKey = process.env['OPENAI_API_KEY'];
    this.impl = apiKey ? new OpenAiTriageLlm(new OpenAI({ apiKey })) : new RulesTriageLlm();
    this.log.log(`triage llm: ${this.impl.model}`);
  }

  get model(): string {
    return this.impl.model;
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

  takeUsage(runId: string): LlmUsage {
    return this.impl.takeUsage(runId);
  }
}
