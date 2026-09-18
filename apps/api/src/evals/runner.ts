/**
 * Раннер evals фазы 9: golden set гоняется через те же сервисы, что REST и MCP (AgentService → граф →
 * RemarksService), а не через отдельный «оценочный» вызов модели. Поэтому цифры в docs/EVALS.md — про продукт.
 *
 * Режимы: live (OPENAI_API_KEY: настоящие эмбеддинги и модели, span'ы в Langfuse с environment `evals`)
 * и offline (фейковые эмбеддинги + правила без LLM — как CI без ключа). A/B ретеста переключает
 * `AgentService.retestStrategy` на одном и том же коде: H1 diff_explain против H0 llm_only.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, type Role } from '@remarkround/db';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import request from 'supertest';
import { FakeEmbeddingsService } from '../../test/fake-embeddings';
import { FakeLlmService } from '../../test/fake-llm';
import { AgentService } from '../agent/agent.service';
import type { RetestStrategy, TriageStateType } from '../agent/graph-state';
import { AppModule } from '../app.module';
import { hashPassword } from '../auth/password';
import { DocumentsService } from '../documents/documents.service';
import { llmCallLog, type LlmCallRecord } from '../llm/call-log';
import { EmbeddingsService } from '../llm/embeddings.service';
import { activeSwitches, llmParams, type LlmParams } from '../llm/llm-params';
import { LlmService } from '../llm/llm.service';
import { renderedTemplates, resolveModels, systemPrompts } from '../llm/openai-triage-llm';
import { skillPath } from '../llm/skill';
import { validationPipe } from '../main';
import { ObservabilityService } from '../observability/observability.service';
import { RagService } from '../rag/rag.service';
import { RemarksService } from '../remarks/remarks.service';
import { StorageService } from '../storage/storage.service';
import type { ProjectContext } from '../tenancy/project-context';
import { loadGolden, readShot, ROOT, type Golden, type GoldenCase, type LeakageCase, type RetestCase, type TriageCase } from './golden';
import { scoreBinding, scoreFaithfulness, scoreRetest, scoreRetrieval, sectionMatches, type BindingScore, type FaithfulnessScore, type RetestScore, type RetrievalScore } from './metrics';

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

/** Один вызов модели (журнал call-log.ts); в офлайне вызовов нет. */
export type LlmCall = Omit<LlmCallRecord, 'runId'>;

export interface TriageResult {
  id: string;
  type: string;
  proposedClass: string | null;
  status: string;
  citedSections: string[];
  draftShort: string | null;
  /** Факты кадра от vision-ноды — чтобы отличать ошибку классификации от ошибки зрения. */
  seen: string | null;
  binding: BindingScore;
  faithfulness: FaithfulnessScore;
  usage: RunUsage;
  /** Переписываний запроса (≤ 2) и циклов faithfulness → bind (≤ 2) из состояния графа; null — состояние не прочитано. */
  rewriteCount: number | null;
  bindLoops: number | null;
  /** Подписи разделов найденных фрагментов в порядке близости — то, что видел classify (после rewrite). */
  retrieved: Array<string | null>;
  /** hit@1/3/6 по gold.section; null — у кейса нет раздела-опоры. */
  retrieval: RetrievalScore | null;
  calls: LlmCall[];
  error?: string;
}

export interface RetestResult {
  id: string;
  type: string;
  strategy: RetestStrategy;
  outcome: string | null;
  explanation: string;
  status: string;
  score: RetestScore;
  usage: RunUsage;
  calls: LlmCall[];
  error?: string;
}

export interface LeakageResult {
  id: string;
  ok: boolean;
  foreignChunks: number;
  foreignHttp: number;
  citationsOutsideProject: number;
  detail: string;
}

/**
 * С чем сняты цифры (P4): коммит, модели, эффективные гиперпараметры, заданные переключатели и хеши промптов.
 * Без этого цифру в EVALS.md нельзя связать с версией кода и промпта (аудит 18.09, «Evals и A/B»).
 */
export interface RunMeta {
  /** `git rev-parse --short HEAD`; null — не git-checkout (Docker, архив). */
  gitSha: string | null;
  /** Есть незакоммиченные правки в отслеживаемых файлах: цифра относится не ровно к gitSha. */
  gitDirty: boolean | null;
  node: string;
  /** Модели, которые берёт OpenAI-реализация; в офлайне не вызываются. */
  models: { fast: string; strong: string; embeddings: string };
  llmParams: LlmParams;
  /** Заданные переменные эксперимента как есть: LLM_TEMP_*, LLM_TOP_P, …, LLM_MODEL_*, LLM_MODE, RETEST_STRATEGY. */
  switches: Record<string, string>;
  prompts: {
    /** SKILL.md целиком (с шапкой), как лежит в репозитории. */
    skillSha256: string | null;
    skillPath: string | null;
    /** Подмешан ли Skill в системные промпты (SKILL_DISABLED и наличие файла). */
    skillInjected: boolean;
    /** Системные промпты по шагам — ровно то, что уходит в модель при этих параметрах. */
    systemSha256: Record<string, string>;
    /** Пользовательские шаблоны шагов, отрисованные на фиксированном примере. */
    templateSha256: Record<string, string>;
  };
  langfuseEnvironment: string | null;
  modes: string[];
  strategies: RetestStrategy[];
  only: string[] | null;
}

export interface EvalReport {
  startedAt: string;
  finishedAt: string;
  mode: 'live' | 'offline';
  model: string;
  embeddings: string;
  golden: { path: string; version: number; cases: number };
  run: RunMeta;
  triage: TriageResult[];
  retest: RetestResult[];
  leakage: LeakageResult[];
}

export interface RunEvalsOptions {
  /** Фейковые эмбеддинги и правила без сети. По умолчанию — live, если есть OPENAI_API_KEY. */
  offline?: boolean;
  /** Подмножество кейсов по id или по режиму. */
  only?: string[];
  modes?: Array<'triage' | 'retest' | 'leakage'>;
  strategies?: RetestStrategy[];
  golden?: Golden;
  log?: (line: string) => void;
}

const TZ = readFileSync(resolve(ROOT, 'fixtures/spec/TZ.md'));
const PROTOCOL = readFileSync(resolve(ROOT, 'fixtures/protocol/PROTOCOL.md'));
const PASSWORD = 'evals-secret';

export async function runEvals(opts: RunEvalsOptions = {}): Promise<EvalReport> {
  const log = opts.log ?? (() => undefined);
  const offline = opts.offline ?? !process.env['OPENAI_API_KEY'];
  const golden = opts.golden ?? loadGolden();
  const modes = new Set(opts.modes ?? ['triage', 'retest', 'leakage']);
  const strategies = opts.strategies ?? ['diff_explain', 'llm_only'];
  const only = opts.only ? new Set(opts.only) : null;
  const pick = <T extends GoldenCase>(mode: T['mode']): T[] =>
    golden.cases.filter((c) => c.mode === mode && modes.has(mode) && (!only || only.has(c.id))) as T[];

  // Трейсы evals — в своём environment Langfuse, чтобы не смешивались с демо.
  process.env['LANGFUSE_TRACING_ENVIRONMENT'] ??= 'evals';
  // Шаг, finish_reason, токены и время каждого вызова модели — только на время прогона (в продукте журнал выключен)
  llmCallLog.enable();

  const fakeLlm = offline ? new FakeLlmService() : null;
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (offline) builder = builder.overrideProvider(EmbeddingsService).useValue(new FakeEmbeddingsService()).overrideProvider(LlmService).useValue(fakeLlm);
  const moduleRef = await builder.compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(validationPipe());
  await app.init();

  const prisma = new PrismaClient();
  const http = request(app.getHttpServer());
  const remarks = app.get(RemarksService);
  const agent = app.get(AgentService);
  const storage = app.get(StorageService);
  const rag = app.get(RagService);
  const documents = app.get(DocumentsService);
  const embeddings = app.get(EmbeddingsService) as { model: string };
  const observability = app.get(ObservabilityService);
  // Состояние графа после прогона (rewriteCount, bindLoops, найденные фрагменты) — из чекпоинта через getState.
  // Граф — приватное поле AgentService: публичного API «прочитать состояние» у продукта нет и для evals не заводим.
  const triageGraph = (agent as unknown as { triage?: { getState(c: { configurable: { thread_id: string } }): Promise<{ values?: Partial<TriageStateType> }> } }).triage;
  const graphState = async (runId: string | undefined): Promise<Partial<TriageStateType> | null> => {
    if (!runId || !triageGraph) return null;
    try {
      return (await triageGraph.getState({ configurable: { thread_id: runId } })).values ?? null;
    } catch {
      return null;
    }
  };
  const callsOf = (runId: string | undefined): LlmCall[] => (runId ? llmCallLog.take(runId).map(({ runId: _r, ...call }) => call) : []);

  const tag = randomUUID().slice(0, 8);
  const passwordHash = await hashPassword(PASSWORD);
  const project = await prisma.project.create({ data: { name: `Evals ${tag}` } });
  const foreign = await prisma.project.create({ data: { name: `Evals other-tenant ${tag}` } });
  const users: Record<Role | 'other', { id: string; token: string }> = {} as never;
  for (const role of ['pm', 'business', 'developer', 'admin'] as Role[]) {
    const user = await prisma.user.create({ data: { email: `evals-${role}-${tag}@test.dev`, name: role, passwordHash } });
    await prisma.membership.create({ data: { userId: user.id, projectId: project.id, role } });
    const login = await http.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
    users[role] = { id: user.id, token: login.body.accessToken };
  }
  {
    const user = await prisma.user.create({ data: { email: `evals-other-${tag}@test.dev`, name: 'other', passwordHash } });
    await prisma.membership.create({ data: { userId: user.id, projectId: foreign.id, role: 'pm' } });
    const login = await http.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
    users.other = { id: user.id, token: login.body.accessToken };
  }
  const ctx = (role: Role): ProjectContext => ({ userId: users[role].id, projectId: project.id, role });

  const report: EvalReport = {
    startedAt: new Date().toISOString(),
    finishedAt: '',
    mode: offline ? 'offline' : 'live',
    model: agent.model,
    embeddings: embeddings.model,
    golden: { path: 'evals/golden.json', version: golden.version, cases: golden.cases.length },
    run: runMeta({ embeddings: embeddings.model, modes: [...modes], strategies, only: opts.only ?? null }),
    triage: [],
    retest: [],
    leakage: [],
  };

  try {
    const spec = await documents.upload(ctx('pm'), { kind: 'spec', fileName: 'TZ.md', data: TZ, effectiveAt: new Date('2026-01-14') }, { indexInBackground: false });
    const protocol = await documents.upload(ctx('pm'), { kind: 'protocol', fileName: 'PROTOCOL.md', data: PROTOCOL, effectiveAt: new Date('2026-03-12') }, { indexInBackground: false });
    await rag.indexDocument(spec.id);
    await rag.indexDocument(protocol.id);
    log(`evals: ${report.mode}, llm ${report.model}, embeddings ${report.embeddings}, проект ${project.id}`);
    log(`  коммит ${report.run.gitSha ?? '—'}${report.run.gitDirty ? ' (+правки)' : ''}; переключатели: ${Object.entries(report.run.switches).map(([k, v]) => `${k}=${v}`).join(', ') || 'нет (поведение по умолчанию)'}`);

    let roundNumber = 1;
    const newRound = async () => prisma.round.create({ data: { projectId: project.id, number: roundNumber++ } });
    const runUsage = async (runId: string | undefined, latencyMs: number): Promise<RunUsage> => {
      const run = runId ? await prisma.agentRun.findUnique({ where: { id: runId } }) : null;
      return { inputTokens: run?.inputTokens ?? 0, outputTokens: run?.outputTokens ?? 0, costUsd: run?.costUsd ? Number(run.costUsd) : 0, latencyMs };
    };

    // ---------- триаж ----------
    for (const c of pick<TriageCase>('triage')) {
      const round = await newRound();
      const siblingNumbers: number[] = [];
      for (const s of c.siblings ?? []) {
        const sib = await remarks.create(ctx('business'), round.id, { description: s.description, expected: s.expected, pageOrScreen: s.pageOrScreen });
        siblingNumbers.push(sib.number);
      }
      const screenshotKey = c.screenshot ? await storage.save(project.id, c.screenshot, readShot(c.screenshot)) : undefined;
      const created = await remarks.create(ctx('business'), round.id, { ...c.remark, screenshotKey });
      const started = Date.now();
      let error: string | undefined;
      try {
        await agent.startTriage(ctx('business'), created.id, { wait: true });
      } catch (e) {
        error = (e as Error).message;
      }
      const latencyMs = Date.now() - started;
      const view = await remarks.get(ctx('pm'), created.id);
      const state = await graphState(view.runId);
      const retrieved = (state?.hits ?? []).map((h) => h.section);
      const obs = {
        proposedClass: view.proposedClass ?? null,
        remarkText: c.remark.description,
        citedSections: view.citations.map((x) => x.section),
        citationCount: view.citations.length,
        rationale: view.draft.join('\n\n'),
        hasScreenshot: Boolean(c.screenshot),
        duplicateOfNumber: view.duplicateOfNumber ?? null,
        status: view.status,
      };
      const result: TriageResult = {
        id: c.id,
        type: c.type,
        proposedClass: obs.proposedClass,
        status: view.status,
        citedSections: obs.citedSections.filter((s): s is string => Boolean(s)),
        draftShort: view.draft[1] ?? view.draft[0] ?? null,
        seen: view.seen ?? null,
        binding: scoreBinding(c.gold, obs, siblingNumbers),
        faithfulness: scoreFaithfulness(c.gold, obs),
        usage: await runUsage(view.runId, latencyMs),
        rewriteCount: state?.rewriteCount ?? null,
        bindLoops: state?.bindLoops ?? null,
        retrieved,
        retrieval: c.gold.section ? scoreRetrieval(c.gold.section, retrieved) : null,
        calls: callsOf(view.runId),
        error,
      };
      report.triage.push(result);
      const loops = `${result.rewriteCount ? ` rw${result.rewriteCount}` : ''}${result.bindLoops ? ` bl${result.bindLoops}` : ''}${result.retrieval ? ` поиск ${result.retrieval.rank ? `#${result.retrieval.rank}` : 'мимо'}` : ''}`;
      log(`  ${result.binding.ok ? '✓' : '✗'}${result.faithfulness.ok ? ' ' : '!'} ${c.id}: ${result.proposedClass ?? '—'} [${result.citedSections.join(', ')}] ${(latencyMs / 1000).toFixed(1)}s${loops}${error ? ` ОШИБКА ${error}` : ''}${result.binding.reasons.length ? ` — ${result.binding.reasons.join('; ')}` : ''}${result.faithfulness.issues.length ? ` — faithfulness: ${result.faithfulness.issues.join('; ')}` : ''}`);
    }

    // ---------- ретест: A/B на одном коде ----------
    const retestCases = pick<RetestCase>('retest');
    if (retestCases.length) {
      // Цитата-фикстура — снимок, как у applyProposal: ретест читает текст цитаты из снимка, а не из чанка
      const chunkFor = async (section: string) => {
        const chunks = await prisma.documentChunk.findMany({
          where: { projectId: project.id, documentId: spec.id },
          select: { id: true, section: true, content: true, document: { select: { title: true, kind: true, effectiveAt: true } } },
        });
        const hit = chunks.find((ch) => sectionMatches(ch.section, section));
        if (!hit) throw new Error(`golden: раздел ${section} не найден среди чанков ТЗ`);
        return { chunkId: hit.id, quoteText: hit.content, section: hit.section, documentTitle: hit.document.title, documentKind: hit.document.kind, effectiveAt: hit.document.effectiveAt };
      };
      for (const c of retestCases) {
        const round = await newRound();
        const beforeKey = await storage.save(project.id, c.before, readShot(c.before));
        const citation = await chunkFor(c.cite);
        for (const strategy of strategies) {
          // Дело до ретеста: дефект с цитатой, исправлен разработчиком. Это фикстура состояния, как в seed, а не путь записи графа.
          const created = await remarks.create(ctx('business'), round.id, { ...c.remark, screenshotKey: beforeKey });
          await prisma.remark.update({
            where: { id: created.id },
            data: { status: 'defect', proposedClass: 'defect_candidate', rationale: 'Похоже, это поломка относительно ТЗ.', citations: { create: [citation] } },
          });
          await remarks.readyForRetest(ctx('developer'), created.id);
          const afterKey = await storage.save(project.id, c.after, readShot(c.after));
          agent.retestStrategy = strategy;
          const started = Date.now();
          let error: string | undefined;
          try {
            await agent.retest(ctx('business'), created.id, afterKey, { wait: true });
          } catch (e) {
            error = (e as Error).message;
          }
          const latencyMs = Date.now() - started;
          const view = await remarks.get(ctx('business'), created.id);
          const obs = { outcome: view.retest?.outcome ?? null, explanation: view.retest?.explanation ?? '', status: view.status };
          const result: RetestResult = {
            id: c.id,
            type: c.type,
            strategy,
            outcome: obs.outcome,
            explanation: obs.explanation,
            status: view.status,
            score: scoreRetest(c, obs),
            usage: await runUsage(view.runId, latencyMs),
            calls: callsOf(view.runId),
            error,
          };
          report.retest.push(result);
          log(`  ${result.score.ok ? '✓' : '✗'} ${c.id} [${strategy}]: ${result.outcome ?? '—'} ${(latencyMs / 1000).toFixed(1)}s $${result.usage.costUsd.toFixed(4)}${error ? ` ОШИБКА ${error}` : ''}${result.score.issues.length ? ` — ${result.score.issues.join('; ')}` : ''}`);
        }
      }
      agent.retestStrategy = strategies[0] ?? 'diff_explain';
    }

    // ---------- leakage: SQL, не промпт ----------
    for (const c of pick<LeakageCase>('leakage')) {
      const foreignSearch = await http.get(`/api/v1/projects/${foreign.id}/search`).query({ q: c.query }).set({ Authorization: `Bearer ${users.other.token}` });
      const hitsOf = (res: { status: number; body: { hits?: unknown[] } }): number => (res.status === 200 ? (res.body.hits ?? []).length : -1);
      const foreignChunks = hitsOf(foreignSearch);
      const crossProject = await http.get(`/api/v1/projects/${foreign.id}/search`).query({ q: c.query }).set({ Authorization: `Bearer ${users.pm.token}` });
      const ownSearch = await http.get(`/api/v1/projects/${project.id}/search`).query({ q: c.query }).set({ Authorization: `Bearer ${users.pm.token}` });
      const citations = await prisma.evidenceCitation.findMany({ where: { remark: { projectId: project.id } }, select: { chunkId: true } });
      const chunkIds = [...new Set(citations.map((x) => x.chunkId).filter((id): id is string => Boolean(id)))];
      const outside = chunkIds.length ? await prisma.documentChunk.count({ where: { id: { in: chunkIds }, projectId: { not: project.id } } }) : 0;
      const ok = foreignChunks === c.gold.chunks && crossProject.status === c.gold.http && hitsOf(ownSearch) > 0 && outside === 0;
      const result: LeakageResult = {
        id: c.id,
        ok,
        foreignChunks,
        foreignHttp: crossProject.status,
        citationsOutsideProject: outside,
        detail: `чужой проект без документов: ${foreignChunks} чанков; свой токен на чужой проект: HTTP ${crossProject.status}; свой проект: ${hitsOf(ownSearch)} чанков; цитат из чужого проекта: ${outside}`,
      };
      report.leakage.push(result);
      log(`  ${ok ? '✓' : '✗'} ${c.id}: ${result.detail}`);
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    llmCallLog.disable();
    await observability.flush().catch(() => undefined);
    await cleanup(prisma, [project.id, foreign.id], Object.values(users).map((u) => u.id));
    await prisma.$disconnect();
    await app.close();
  }
  return report;
}

/** Переменные эксперимента, кроме P4-переключателей: их значения тоже меняют цифры. */
const EXTRA_SWITCHES = ['LLM_MODEL_FAST', 'LLM_MODEL_STRONG', 'LLM_MODE', 'RETEST_STRATEGY'] as const;

function runMeta(input: { embeddings: string; modes: string[]; strategies: RetestStrategy[]; only: string[] | null }): RunMeta {
  const params = llmParams();
  const switches = activeSwitches();
  for (const name of EXTRA_SWITCHES) if (process.env[name]) switches[name] = process.env[name]!;
  const skill = skillPath();
  return {
    gitSha: git('rev-parse', '--short', 'HEAD'),
    gitDirty: (() => {
      const status = git('status', '--porcelain', '--untracked-files=no');
      return status === null ? null : status.length > 0;
    })(),
    node: process.version,
    models: { ...resolveModels(), embeddings: input.embeddings },
    llmParams: params,
    switches,
    prompts: {
      skillSha256: skill ? sha256(readFileSync(skill)) : null,
      skillPath: skill ? relative(ROOT, skill) : null,
      skillInjected: Boolean(skill) && !params.skillDisabled,
      systemSha256: mapValues(systemPrompts(params), sha256),
      templateSha256: mapValues(renderedTemplates(), sha256),
    },
    langfuseEnvironment: process.env['LANGFUSE_TRACING_ENVIRONMENT'] ?? null,
    modes: input.modes,
    strategies: input.strategies,
    only: input.only,
  };
}

/** git без исключений: вне репозитория (Docker, архив) — null. */
function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function mapValues<T, U>(o: Record<string, T>, f: (v: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
}

async function cleanup(prisma: PrismaClient, projectIds: string[], userIds: string[]): Promise<void> {
  const remarkIds = (await prisma.remark.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } })).map((r) => r.id);
  const runIds = (await prisma.agentRun.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } })).map((r) => r.id);
  await prisma.humanVerdict.deleteMany({ where: { remarkId: { in: remarkIds } } });
  await prisma.graphCheckpoint.deleteMany({ where: { runId: { in: runIds } } }).catch(() => undefined);
  await prisma.agentRun.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.remark.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.importJob.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.round.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.documentChunk.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.document.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.membership.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
