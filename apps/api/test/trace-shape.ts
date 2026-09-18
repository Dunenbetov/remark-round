/**
 * Форма трейса Langfuse, которую увидит ментор в UI, — одни и те же проверки без Sentry (observability.spec) и с ним
 * (observability-sentry.spec, P1 18.09): на бою включены оба, и именно эту связку раньше не проверял никто.
 *  - один прогон = один trace: старт и продолжение после interrupt (вердикт PM) с одним traceId из runId;
 *  - в trace есть ноды графа и retriever-span поиска с projectId, у корня — metadata прогона и кто нажал;
 *  - каждый вызов OpenAI — generation с именем ноды, моделью и токенами (клиент подменён заглушкой).
 *
 * Сети нет, а путь инициализации боевой: процессор Langfuse создаёт сам ObservabilityService, спека перехватывает
 * `onEnd` его процессора — span'ы, дошедшие до Langfuse, копятся в памяти и не уходят в OTLP-экспортёр.
 */
import { LangfuseSpanProcessor } from '@langfuse/otel';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import { OpenAiTriageLlm } from '../src/llm/openai-triage-llm';
import type { LlmCallMeta } from '../src/llm/triage-llm';
import { ObservabilityService } from '../src/observability/observability.service';
import { createHarness, type Harness } from './harness';

export interface LangfuseCapture {
  /** Все span'ы, дошедшие до процессора Langfuse, в порядке завершения. */
  spans: ReadableSpan[];
  /** Экземпляры процессора, до которых дошли span'ы: должен быть ровно один — процессор ObservabilityService. */
  processors: Set<LangfuseSpanProcessor>;
}

/** Перехват до экспорта: вызывать до создания приложения, снимается `jest.restoreAllMocks()`. */
export function captureLangfuseSpans(): LangfuseCapture {
  const capture: LangfuseCapture = { spans: [], processors: new Set() };
  jest.spyOn(LangfuseSpanProcessor.prototype, 'onEnd').mockImplementation(function (this: LangfuseSpanProcessor, span: ReadableSpan) {
    capture.processors.add(this);
    capture.spans.push(span);
  });
  return capture;
}

/** Процессор, который создал сервис (поле приватное — спеке можно). */
export function processorOf(observability: ObservabilityService): LangfuseSpanProcessor | null {
  return observability['processor'];
}

export function attr(span: ReadableSpan, key: string): unknown {
  return span.attributes[key];
}

/** Metadata SDK кладёт плоско: `langfuse.observation.metadata.<key>` (и `langfuse.trace.metadata.<key>` для trace). */
export function metadata(span: ReadableSpan, prefix = 'langfuse.observation.metadata'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(span.attributes)) if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = String(v);
  return out;
}

/** Ждёт span с именем: корень прогона закрывается уже после ответа REST. */
export async function waitForSpan(capture: LangfuseCapture, name: string, tries = 50): Promise<ReadableSpan> {
  for (let i = 0; i < tries; i++) {
    const found = capture.spans.find((s) => s.name === name);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`span ${name} не дошёл до процессора Langfuse; есть: ${[...new Set(capture.spans.map((s) => s.name))].join(', ')}`);
}

export interface TraceShapeContext {
  h: Harness;
  observability: ObservabilityService;
  capture: LangfuseCapture;
}

/**
 * Стенд с включённым Langfuse (ключи фиктивные) и перехватом span'ов. `before` — что поднять до приложения
 * (Sentry.init — как instrument.ts до Nest в main.ts); `extra` — дополнительные проверки на том же стенде.
 */
export function describeTraceShape(title: string, opts: { before?: () => void; after?: () => Promise<void>; extra?: (ctx: () => TraceShapeContext) => void } = {}): void {
  describe(title, () => {
    let ctx: TraceShapeContext;

    beforeAll(async () => {
      opts.before?.();
      const capture = captureLangfuseSpans();
      process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-test';
      process.env['LANGFUSE_SECRET_KEY'] = 'sk-test';
      process.env['LANGFUSE_TRACING_ENABLED'] = 'true';
      process.env['LANGFUSE_PROJECT_ID'] = 'remarkround-test';
      process.env['LANGFUSE_PUBLIC_URL'] = 'http://langfuse.local:3000';
      const h = await createHarness();
      ctx = { h, observability: h.app.get(ObservabilityService), capture };
    });

    afterAll(async () => {
      await ctx?.h.cleanup();
      await opts.after?.();
      jest.restoreAllMocks();
    });

    it('span\'ы идут в процессор сервиса, /health → tracing: on', async () => {
      const { h, observability, capture } = ctx;
      expect(observability.tracingStatus()).toBe('on');
      // Индексация ТЗ в createHarness — свой trace без родителя: он тоже должен дойти
      await waitForSpan(capture, 'index_document');
      expect([...capture.processors]).toEqual([processorOf(observability)]);
      const health = await h.http.get('/api/v1/health').expect(200);
      expect(health.body.tracing).toBe('on');
    });

    it('прогон и продолжение после interrupt — один trace с нодами графа, retrieve и metadata прогона', async () => {
      const { h, capture } = ctx;
      capture.spans.length = 0;
      const created = await h.http
        .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
        .set(h.auth('business'))
        .send({ description: 'Кнопка «Сохранить» серая, а в ТЗ primary синяя', pageOrScreen: 'Профиль' })
        .expect(201);
      const remarkId: string = created.body.id;
      const awaiting = await h.waitFor(remarkId, ['awaiting_pm']);
      const runId: string = awaiting.runId;
      expect(awaiting.traceUrl).toBe(`http://langfuse.local:3000/project/remarkround-test/traces/${ObservabilityService.traceIdOf(runId)}`);

      await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/verdict`).set(h.auth('pm')).send({ runId, verdict: 'defect', idempotencyKey: randomUUID() }).expect(200);
      await h.waitFor(remarkId, ['defect']);
      const resume = await waitForSpan(capture, 'triage.resume');
      const spans = capture.spans;

      const traceId = ObservabilityService.traceIdOf(runId);
      const root = spans.find((s) => s.name === 'triage');
      expect(root).toBeDefined();
      expect(root!.spanContext().traceId).toBe(traceId);
      expect(resume.spanContext().traceId).toBe(traceId);

      // Кто нажал и какое замечание — на корне и на всех вложенных span'ах (propagateAttributes).
      expect(attr(root!, 'user.id')).toBe(h.users.business.id);
      expect(attr(root!, 'session.id')).toBe(remarkId);
      expect(attr(resume, 'user.id')).toBe(h.users.pm.id);
      expect(attr(root!, 'langfuse.trace.name')).toBe('triage');
      expect(attr(root!, 'langfuse.internal.as_root')).toBe(true);
      expect(metadata(root!)).toMatchObject({ projectId: h.projectId, remarkId, runId, role: 'business' });
      expect(metadata(root!, 'langfuse.trace.metadata')).toMatchObject({ projectId: h.projectId, remarkId, runId });
      expect(JSON.parse(String(attr(root!, 'langfuse.observation.output'))).proposedClass).toBeTruthy();

      const inTrace = spans.filter((s) => s.spanContext().traceId === traceId);
      const names = new Set(inTrace.map((s) => s.name));
      for (const node of ['ingest', 'retrieve_docs', 'bind_to_clause', 'classify_evidence', 'draft_rationale', 'faithfulness_gate', 'propose', 'hitl']) expect(names).toContain(node);
      expect(names).toContain('persist');
      // Ноды — под корнем прогона, а не отдельными трейсами: контекст OpenTelemetry передаётся
      const ids = new Set(inTrace.map((s) => s.spanContext().spanId));
      expect(inTrace.filter((s) => s !== root && s !== resume).every((s) => ids.has(s.parentSpanContext?.spanId ?? ''))).toBe(true);

      const retrieve = inTrace.find((s) => s.name === 'retrieve');
      expect(retrieve).toBeDefined();
      expect(attr(retrieve!, 'langfuse.observation.type')).toBe('retriever');
      expect(metadata(retrieve!)).toMatchObject({ projectId: h.projectId });
      expect(attr(retrieve!, 'session.id')).toBe(remarkId);
      // В выдаче только документы этого проекта: чужого projectId в trace нет.
      const hits = JSON.parse(String(attr(retrieve!, 'langfuse.observation.output'))) as Array<{ document: string }>;
      expect(hits.length).toBeGreaterThan(0);
      expect(inTrace.every((s) => !JSON.stringify(s.attributes).includes('other-tenant'))).toBe(true);
    });

    it('каждый вызов OpenAI — generation с именем ноды, моделью и токенами', async () => {
      const { h, observability, capture } = ctx;
      capture.spans.length = 0;
      const calls: Array<{ model: string; stream?: boolean }> = [];
      const llm = new OpenAiTriageLlm(stubOpenAi(calls), { fast: 'gpt-4.1-mini', strong: 'gpt-4.1' }, (client, meta) => observability.openai(client, meta));
      const meta: LlmCallMeta = { node: 'rewrite', runId: 'run-1', remarkId: 'remark-1', projectId: h.projectId };

      const text = await observability.run(
        { mode: 'triage', runId: 'run-1', remarkId: 'remark-1', projectId: h.projectId, userId: 'u-1', role: 'pm', model: llm.model, resume: false, input: {} },
        () => llm.rewriteQuery(meta, { description: 'кнопка серая', expected: null, pageOrScreen: null, hasScreenshot: false, previousQuery: 'кнопка', visionFacts: null, humanComment: null, triedSections: [] }),
      );
      expect(text).toBe('кнопка primary серая');
      expect(calls).toHaveLength(1);
      expect(llm.takeUsage('run-1')).toEqual({ inputTokens: 42, outputTokens: 7, costUsd: expect.any(Number) });

      const generation = await waitForSpan(capture, 'rewrite');
      expect(attr(generation, 'langfuse.observation.type')).toBe('generation');
      expect(attr(generation, 'langfuse.observation.model.name')).toBe('gpt-4.1-mini');
      expect(generation.spanContext().traceId).toBe(ObservabilityService.traceIdOf('run-1'));
      const usage = JSON.parse(String(attr(generation, 'langfuse.observation.usage_details'))) as Record<string, number>;
      expect(usage['input'] ?? usage['prompt_tokens']).toBe(42);
      expect(usage['output'] ?? usage['completion_tokens']).toBe(7);
      expect(metadata(generation)).toMatchObject({ node: 'rewrite', runId: 'run-1', projectId: h.projectId });
      expect(attr(generation, 'user.id')).toBe('u-1');
    });

    opts.extra?.(() => ctx);
  });
}

/** Клиент OpenAI без сети: chat.completions отвечает фиксированным текстом и токенами 42/7, embeddings — нулями. */
export function stubOpenAi(calls: Array<{ model: string; stream?: boolean }> = []): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: { model: string; stream?: boolean }) => {
          calls.push(params);
          return {
            id: 'cmpl-1',
            object: 'chat.completion',
            model: params.model,
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'кнопка primary серая' } }],
            usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
          };
        },
      },
    },
    embeddings: {
      create: async (params: { input: string[]; dimensions: number }) => ({
        data: params.input.map((_, index) => ({ index, embedding: new Array<number>(params.dimensions).fill(0) })),
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }),
    },
  } as unknown as OpenAI;
}
