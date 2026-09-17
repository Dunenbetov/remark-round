/**
 * Фаза 8: Langfuse на каждый LLM-вызов. Сеть не нужна: экспортёр OpenTelemetry в памяти, LLM — FakeLlm.
 * Проверяем не «что-то отправилось», а форму трейса, которую увидит ментор в UI:
 *  - один прогон = один trace: старт и продолжение после interrupt (вердикт PM) с одним traceId из runId;
 *  - в trace есть ноды графа и retriever-span поиска с projectId, у корня — metadata прогона и кто нажал;
 *  - каждый вызов OpenAI — generation с именем ноды, моделью и токенами (клиент подменён заглушкой).
 */
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import { createHarness, type Harness } from '../../test/harness';
import { OpenAiTriageLlm } from '../llm/openai-triage-llm';
import type { LlmCallMeta } from '../llm/triage-llm';
import { ObservabilityService } from './observability.service';

const exporter = new InMemorySpanExporter();
const processor = new LangfuseSpanProcessor({ exporter, publicKey: 'pk-test', secretKey: 'sk-test', baseUrl: 'http://langfuse.invalid', flushAt: 1, flushInterval: 0.05 });

function attr(span: ReadableSpan, key: string): unknown {
  return span.attributes[key];
}

/** Metadata SDK кладёт плоско: `langfuse.observation.metadata.<key>` (и `langfuse.trace.metadata.<key>` для trace). */
function metadata(span: ReadableSpan, prefix = 'langfuse.observation.metadata'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(span.attributes)) if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = String(v);
  return out;
}

async function flushed(): Promise<ReadableSpan[]> {
  await processor.forceFlush();
  return exporter.getFinishedSpans();
}

describe('observability: Langfuse на каждый вызов', () => {
  let h: Harness;
  let observability: ObservabilityService;

  beforeAll(async () => {
    // Провайдер один на процесс: регистрируем свой до старта приложения, ObservabilityService в тестах молчит.
    new NodeTracerProvider({ spanProcessors: [processor] }).register();
    process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-test';
    process.env['LANGFUSE_SECRET_KEY'] = 'sk-test';
    process.env['LANGFUSE_TRACING_ENABLED'] = 'true';
    process.env['LANGFUSE_PROJECT_ID'] = 'remarkround-test';
    process.env['LANGFUSE_PUBLIC_URL'] = 'http://langfuse.local:3000';
    h = await createHarness();
    observability = h.app.get(ObservabilityService);
  });

  afterAll(async () => {
    await h.cleanup();
    await processor.shutdown();
  });

  it('прогон и продолжение после interrupt — один trace с нодами графа, retrieve и metadata прогона', async () => {
    exporter.reset();
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
    // Прогон закрывается после ответа REST: ждём, пока корень trace закончится и уедет в экспортёр.
    let spans: ReadableSpan[] = [];
    for (let i = 0; i < 50 && !spans.some((s) => s.name === 'triage.resume'); i++) {
      await new Promise((r) => setTimeout(r, 100));
      spans = await flushed();
    }

    const traceId = ObservabilityService.traceIdOf(runId);
    const root = spans.find((s) => s.name === 'triage');
    const resume = spans.find((s) => s.name === 'triage.resume');
    expect(root).toBeDefined();
    expect(resume).toBeDefined();
    expect(root!.spanContext().traceId).toBe(traceId);
    expect(resume!.spanContext().traceId).toBe(traceId);

    // Кто нажал и какое замечание — на корне и на всех вложенных span'ах (propagateAttributes).
    expect(attr(root!, 'user.id')).toBe(h.users.business.id);
    expect(attr(root!, 'session.id')).toBe(remarkId);
    expect(attr(resume!, 'user.id')).toBe(h.users.pm.id);
    expect(attr(root!, 'langfuse.trace.name')).toBe('triage');
    expect(attr(root!, 'langfuse.internal.as_root')).toBe(true);
    expect(metadata(root!)).toMatchObject({ projectId: h.projectId, remarkId, runId, role: 'business' });
    expect(metadata(root!, 'langfuse.trace.metadata')).toMatchObject({ projectId: h.projectId, remarkId, runId });
    expect(JSON.parse(String(attr(root!, 'langfuse.observation.output'))).proposedClass).toBeTruthy();

    const inTrace = spans.filter((s) => s.spanContext().traceId === traceId);
    const names = new Set(inTrace.map((s) => s.name));
    for (const node of ['ingest', 'retrieve_docs', 'bind_to_clause', 'classify_evidence', 'draft_rationale', 'faithfulness_gate', 'propose', 'hitl']) expect(names).toContain(node);
    expect(names).toContain('persist');

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
    exporter.reset();
    const calls: Array<{ model: string; stream?: boolean }> = [];
    const stub = {
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
    } as unknown as OpenAI;
    const llm = new OpenAiTriageLlm(stub, { fast: 'gpt-4.1-mini', strong: 'gpt-4.1' }, (client, meta) => observability.openai(client, meta));
    const meta: LlmCallMeta = { node: 'rewrite', runId: 'run-1', remarkId: 'remark-1', projectId: h.projectId };

    const text = await observability.run(
      { mode: 'triage', runId: 'run-1', remarkId: 'remark-1', projectId: h.projectId, userId: 'u-1', role: 'pm', model: llm.model, resume: false, input: {} },
      () => llm.rewriteQuery(meta, { description: 'кнопка серая', expected: null, pageOrScreen: null, hasScreenshot: false, previousQuery: 'кнопка', visionFacts: null, humanComment: null, triedSections: [] }),
    );
    expect(text).toBe('кнопка primary серая');
    expect(calls).toHaveLength(1);
    expect(llm.takeUsage('run-1')).toEqual({ inputTokens: 42, outputTokens: 7, costUsd: expect.any(Number) });

    let spans: ReadableSpan[] = [];
    for (let i = 0; i < 30 && !spans.some((s) => s.name === 'rewrite'); i++) {
      await new Promise((r) => setTimeout(r, 100));
      spans = await flushed();
    }
    const generation = spans.find((s) => s.name === 'rewrite');
    expect(generation).toBeDefined();
    expect(attr(generation!, 'langfuse.observation.type')).toBe('generation');
    expect(attr(generation!, 'langfuse.observation.model.name')).toBe('gpt-4.1-mini');
    expect(generation!.spanContext().traceId).toBe(ObservabilityService.traceIdOf('run-1'));
    const usage = JSON.parse(String(attr(generation!, 'langfuse.observation.usage_details'))) as Record<string, number>;
    expect(usage['input'] ?? usage['prompt_tokens']).toBe(42);
    expect(usage['output'] ?? usage['completion_tokens']).toBe(7);
    expect(metadata(generation!)).toMatchObject({ node: 'rewrite', runId: 'run-1', projectId: h.projectId });
    expect(attr(generation!, 'user.id')).toBe('u-1');
  });
});
