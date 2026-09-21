/**
 * Переключатели экспериментов (docs/defense P4): без переменных запросы к модели те же, на которых сняты evals;
 * каждая переменная меняет ровно свой параметр. Клиент OpenAI — подделка, сеть не нужна.
 */
import type OpenAI from 'openai';
import { parseConfig } from '../config';
import { llmCallLog } from './call-log';
import { activeSwitches, DEFAULT_LLM_PARAMS, llmParamsFrom } from './llm-params';
import { OpenAiTriageLlm, renderedTemplates, systemPrompts } from './openai-triage-llm';
import type { ClassifyInput, EvidenceHit, Frame, LlmCallMeta } from './triage-llm';

type Params = Record<string, unknown> & { messages: Array<{ role: string; content: unknown }> };

function fakeClient(calls: Params[], finish = 'stop'): OpenAI {
  const create = async (params: Params) => {
    calls.push(params);
    const usage = { prompt_tokens: 100, completion_tokens: 20 };
    if (params['stream']) {
      return (async function* () {
        yield { choices: [{ delta: { content: 'Абзац. Решает человек.' }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: finish }] };
        yield { choices: [], usage };
      })();
    }
    const schema = (params['response_format'] as { json_schema?: { name?: string } } | undefined)?.json_schema?.name;
    const content = schema === 'triage_classification' ? JSON.stringify({ proposedClass: 'defect_candidate', hitIndexes: [0], duplicateOfNumber: null, reason: 'опора' }) : schema ? JSON.stringify({ outcome: 'cannot_tell', explanation: 'Не понятно.' }) : 'кнопка серая';
    return { choices: [{ message: { content }, finish_reason: finish }], usage };
  };
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const env = (extra: Record<string, string> = {}) => parseConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', JWT_SECRET: 'x', ...extra });
const hit: EvidenceHit = { chunkId: 'c0', section: '§2.1 Primary', documentKind: 'spec', documentTitle: 'TZ.md', content: 'Primary-кнопка — синяя.', score: 0.6 };
const frame: Frame = { data: Buffer.from('png'), mime: 'image/png' };
const meta = (node: LlmCallMeta['node']): LlmCallMeta => ({ node, runId: 'run-1', remarkId: 'r', projectId: 'p' });
const facts = { description: 'Кнопка серая', expected: 'Синяя', pageOrScreen: 'Профиль', hasScreenshot: true };
const classifyInput: ClassifyInput = { ...facts, visionFacts: 'кнопка серая', hits: [hit], bound: hit, siblings: [], humanComment: null, faithfulnessIssue: null };

async function driveAll(llm: OpenAiTriageLlm): Promise<void> {
  await llm.visionFacts(meta('vision'), { ...facts, image: frame });
  await llm.rewriteQuery(meta('rewrite'), { ...facts, previousQuery: 'q', visionFacts: null, humanComment: null, triedSections: [] });
  await llm.classify(meta('classify'), classifyInput);
  await llm.draft(meta('draft'), { ...classifyInput, proposedClass: 'defect_candidate', chunkIds: ['c0'], reason: 'опора' });
  await llm.retestExplain(meta('explain'), { description: 'd', expected: null, before: frame, after: frame, diff: frame, regionText: 'область', citations: [] });
  await llm.retestJudge(meta('judge'), { description: 'd', expected: null, before: frame, after: frame, citations: [] });
}

const detailsOf = (p: Params): string[] =>
  p.messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as Array<{ type: string; image_url?: { detail: string } }>).filter((c) => c.type === 'image_url').map((c) => c.image_url!.detail) : []));

describe('llm-params: переключатели экспериментов', () => {
  it('без переменных — дефолты, на которых сняты evals; активных переключателей нет', () => {
    expect(llmParamsFrom(env())).toEqual(DEFAULT_LLM_PARAMS);
    expect(activeSwitches(env())).toEqual({});
    expect(activeSwitches(env({ SKILL_DISABLED: '0' }))).toEqual({});
  });

  it('каждая переменная меняет свой параметр', () => {
    const p = llmParamsFrom(env({ LLM_TEMP_CLASSIFY: '0.7', LLM_TEMP_DRAFT: '0', LLM_TOP_P: '0.8', LLM_MAX_TOKENS_DRAFT: '120', LLM_IMAGE_DETAIL: 'low', SKILL_DISABLED: '1', VISION_DISABLED: 'true' }));
    expect(p).toEqual({
      temperature: { classify: 0.7, draft: 0 },
      topP: 0.8,
      maxTokens: { ...DEFAULT_LLM_PARAMS.maxTokens, draft: 120 },
      imageDetail: 'low',
      skillDisabled: true,
      visionDisabled: true,
    });
    expect(activeSwitches(env({ LLM_TEMP_DRAFT: '0.7', SKILL_DISABLED: '1' }))).toEqual({ LLM_TEMP_DRAFT: '0.7', SKILL_DISABLED: '1' });
  });

  it('неверные значения не проходят проверку конфига', () => {
    expect(() => env({ LLM_TOP_P: '0' })).toThrow(/LLM_TOP_P/);
    expect(() => env({ LLM_IMAGE_DETAIL: 'medium' })).toThrow(/LLM_IMAGE_DETAIL/);
    expect(() => env({ LLM_TEMP_DRAFT: '3' })).toThrow(/LLM_TEMP_DRAFT/);
  });
});

describe('OpenAiTriageLlm: параметры запросов', () => {
  it('по умолчанию: T classify 0 / draft 0.3 / остальные 0, max_tokens 160/60/300/220/200/200, top_p не шлём, detail auto', async () => {
    const calls: Params[] = [];
    const llm = new OpenAiTriageLlm(fakeClient(calls), undefined, undefined, DEFAULT_LLM_PARAMS);
    await driveAll(llm);
    expect(calls.map((c) => [c['temperature'], c['max_tokens']])).toEqual([
      [0, 160],
      [0, 60],
      [0, 300],
      [0.3, 220],
      [0, 200],
      [0, 200],
    ]);
    for (const c of calls) expect('top_p' in c).toBe(false);
    expect(calls.flatMap(detailsOf)).toEqual(Array(6).fill('auto'));
    expect(llm.canSee).toBe(true);
    // Skill подмешан в системный промпт classify
    expect(String(calls[2]!.messages[0]!.content)).toContain('# Skill uat-triage');
  });

  it('переключатели: температуры, top_p во всех вызовах, max_tokens draft, detail, без Skill, без vision', async () => {
    const calls: Params[] = [];
    const params = llmParamsFrom(env({ LLM_TEMP_CLASSIFY: '0.7', LLM_TEMP_DRAFT: '0', LLM_TOP_P: '0.8', LLM_MAX_TOKENS_DRAFT: '400', LLM_IMAGE_DETAIL: 'low', SKILL_DISABLED: '1', VISION_DISABLED: '1' }));
    const llm = new OpenAiTriageLlm(fakeClient(calls), undefined, undefined, params);
    await driveAll(llm);
    expect(calls[2]).toMatchObject({ temperature: 0.7, max_tokens: 300 });
    expect(calls[3]).toMatchObject({ temperature: 0, max_tokens: 400 });
    for (const c of calls) expect(c['top_p']).toBe(0.8);
    expect(calls.flatMap(detailsOf)).toEqual(Array(6).fill('low'));
    expect(llm.canSee).toBe(false);
    for (const c of calls) expect(String((c.messages[0] as { content: unknown }).content)).not.toContain('# Skill uat-triage');
  });

  it('промпт explain говорит, что красное на диффе — разметка, а не цвет интерфейса (P5)', () => {
    expect(systemPrompts(DEFAULT_LLM_PARAMS).explain).toMatch(/Красный на третьем кадре — разметка алгоритма, а не цвет интерфейса/);
    expect(systemPrompts(DEFAULT_LLM_PARAMS).judge).not.toMatch(/разметка алгоритма/);
  });

  it('classify видит чанк целиком (до 2000 символов), draft — короткую цитату', async () => {
    const calls: Params[] = [];
    const llm = new OpenAiTriageLlm(fakeClient(calls), undefined, undefined, DEFAULT_LLM_PARAMS);
    const long = { ...hit, content: `${'слово '.repeat(250)}КОНЕЦ` }; // ≈1500 символов — обычный чанк в 220+ слов
    await llm.classify(meta('classify'), { ...classifyInput, hits: [long] });
    await llm.draft(meta('draft'), { ...classifyInput, hits: [long], proposedClass: 'defect_candidate', chunkIds: ['c0'], reason: 'опора' });
    expect(String(calls[0]!.messages[1]!.content)).toContain('КОНЕЦ');
    expect(String(calls[1]!.messages[1]!.content)).not.toContain('КОНЕЦ');
  });

  it('журнал вызовов: шаг, модель, finish_reason=length, токены — только когда включён', async () => {
    const calls: Params[] = [];
    const llm = new OpenAiTriageLlm(fakeClient(calls, 'length'), { fast: 'gpt-4.1-mini', strong: 'gpt-4.1' }, undefined, DEFAULT_LLM_PARAMS);
    await llm.classify(meta('classify'), classifyInput);
    expect(llmCallLog.take('run-1')).toEqual([]);
    llmCallLog.enable();
    try {
      await llm.classify(meta('classify'), classifyInput);
      await llm.draft(meta('draft'), { ...classifyInput, proposedClass: 'defect_candidate', chunkIds: ['c0'], reason: 'опора' });
      const rows = llmCallLog.take('run-1');
      expect(rows.map((r) => [r.node, r.model, r.finishReason, r.inputTokens, r.outputTokens])).toEqual([
        ['classify', 'gpt-4.1-mini', 'length', 100, 20],
        ['draft', 'gpt-4.1', 'length', 100, 20],
      ]);
      expect(llmCallLog.take('run-1')).toEqual([]);
    } finally {
      llmCallLog.disable();
    }
    // Сумма прогона (AgentRun) — по-прежнему все три вызова
    expect(llm.takeUsage('run-1')).toMatchObject({ inputTokens: 300, outputTokens: 60 });
  });

  it('classify: рассуждение в схеме ответа идёт до класса (порядок полей = порядок генерации)', async () => {
    const calls: Params[] = [];
    await new OpenAiTriageLlm(fakeClient(calls), { fast: 'gpt-4.1-mini', strong: 'gpt-4.1' }).classify(meta('classify'), classifyInput);
    const schema = (calls[0]!['response_format'] as { json_schema: { schema: { required: string[]; properties: Record<string, unknown> } } }).json_schema.schema;
    expect(schema.required[0]).toBe('reason');
    expect(Object.keys(schema.properties)[0]).toBe('reason');
    expect(schema.required.indexOf('reason')).toBeLessThan(schema.required.indexOf('proposedClass'));
  });

  it('шаблоны для хешей отчёта рисуются без сети', () => {
    const t = renderedTemplates();
    expect(Object.keys(t).sort()).toEqual(['classify', 'draft', 'explain', 'judge', 'rewrite', 'vision']);
    expect(t.classify).toContain('Реши по шагам');
  });
});
