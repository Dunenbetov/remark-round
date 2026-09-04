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
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { FakeEmbeddingsService } from '../../test/fake-embeddings';
import { FakeLlmService } from '../../test/fake-llm';
import { AgentService } from '../agent/agent.service';
import type { RetestStrategy } from '../agent/graph-state';
import { AppModule } from '../app.module';
import { hashPassword } from '../auth/password';
import { DocumentsService } from '../documents/documents.service';
import { EmbeddingsService } from '../llm/embeddings.service';
import { LlmService } from '../llm/llm.service';
import { validationPipe } from '../main';
import { ObservabilityService } from '../observability/observability.service';
import { RagService } from '../rag/rag.service';
import { RemarksService } from '../remarks/remarks.service';
import { StorageService } from '../storage/storage.service';
import type { ProjectContext } from '../tenancy/project-context';
import { loadGolden, readShot, ROOT, type Golden, type GoldenCase, type LeakageCase, type RetestCase, type TriageCase } from './golden';
import { scoreBinding, scoreFaithfulness, scoreRetest, sectionMatches, type BindingScore, type FaithfulnessScore, type RetestScore } from './metrics';

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

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

export interface EvalReport {
  startedAt: string;
  finishedAt: string;
  mode: 'live' | 'offline';
  model: string;
  embeddings: string;
  golden: { path: string; version: number; cases: number };
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

  const tag = randomUUID().slice(0, 8);
  const passwordHash = hashPassword(PASSWORD);
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
        error,
      };
      report.triage.push(result);
      log(`  ${result.binding.ok ? '✓' : '✗'}${result.faithfulness.ok ? ' ' : '!'} ${c.id}: ${result.proposedClass ?? '—'} [${result.citedSections.join(', ')}] ${(latencyMs / 1000).toFixed(1)}s${error ? ` ОШИБКА ${error}` : ''}${result.binding.reasons.length ? ` — ${result.binding.reasons.join('; ')}` : ''}${result.faithfulness.issues.length ? ` — faithfulness: ${result.faithfulness.issues.join('; ')}` : ''}`);
    }

    // ---------- ретест: A/B на одном коде ----------
    const retestCases = pick<RetestCase>('retest');
    if (retestCases.length) {
      const chunkFor = async (section: string) => {
        const chunks = await prisma.documentChunk.findMany({ where: { projectId: project.id, documentId: spec.id }, select: { id: true, section: true } });
        const hit = chunks.find((ch) => sectionMatches(ch.section, section));
        if (!hit) throw new Error(`golden: раздел ${section} не найден среди чанков ТЗ`);
        return hit.id;
      };
      for (const c of retestCases) {
        const round = await newRound();
        const beforeKey = await storage.save(project.id, c.before, readShot(c.before));
        const chunkId = await chunkFor(c.cite);
        for (const strategy of strategies) {
          // Дело до ретеста: дефект с цитатой, исправлен разработчиком. Это фикстура состояния, как в seed, а не путь записи графа.
          const created = await remarks.create(ctx('business'), round.id, { ...c.remark, screenshotKey: beforeKey });
          await prisma.remark.update({
            where: { id: created.id },
            data: { status: 'defect', proposedClass: 'defect_candidate', rationale: 'Похоже, это поломка относительно ТЗ.', citations: { create: [{ chunkId }] } },
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
      const chunkIds = [...new Set(citations.map((x) => x.chunkId))];
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
    await observability.flush().catch(() => undefined);
    await cleanup(prisma, [project.id, foreign.id], Object.values(users).map((u) => u.id));
    await prisma.$disconnect();
    await app.close();
  }
  return report;
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
