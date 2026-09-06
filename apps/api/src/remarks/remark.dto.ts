import type { AgentRunStatus, DocumentKind, ProposedClass, RemarkStatus, RetestOutcome, Role, ScreenshotKind, VerdictCode } from '@remarkround/db';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { mediaUrl } from '../media/media.controller';

// ---------- входные DTO ----------

export class CreateRemarkDto {
  /** «Что не так» — суть замечания, первая строка идёт в заголовок карточки. */
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  pageOrScreen?: string;

  /** «Как должно быть» */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  expected?: string;

  /** Ключ из POST /media */
  @IsOptional()
  @IsString()
  screenshotKey?: string;
}

const VERDICTS: VerdictCode[] = ['defect', 'change_request', 'unspecified', 'duplicate', 'cannot_tell', 'rejected_binding'];

/** Совет разработчика — те же пять кнопок, что у PM («Повтор» ставится связью, кнопки нет). */
export const ADVICE_CODES: VerdictCode[] = ['defect', 'change_request', 'unspecified', 'cannot_tell', 'rejected_binding'];

export class AdviceDto {
  @IsIn(ADVICE_CODES)
  code!: VerdictCode;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class VerdictDto {
  @IsIn(VERDICTS)
  verdict!: VerdictCode;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsUUID()
  runId!: string;

  @IsUUID()
  idempotencyKey!: string;

  /** Для `duplicate`: номер оригинала в раунде. */
  @IsOptional()
  @IsInt()
  @Min(1)
  duplicateOfNumber?: number;
}

export class ScreenshotDto {
  @IsString()
  @MinLength(1)
  screenshotKey!: string;
}

/** run.cancel по REST (дубль WS): вердикта нет, run = cancelled. */
export class CancelRunDto {
  @IsUUID()
  runId!: string;

  @IsUUID()
  idempotencyKey!: string;
}

export class LinkDuplicateDto {
  @IsInt()
  @Min(1)
  duplicateOfNumber!: number;
}

/** «Допишите строку журнала»: человек дописывает то, чего парсер не выдумывает. */
/** Повтор претензии: в какой открытый раунд и, если есть, новый кадр (ключ POST /media этого проекта). */
export class ReopenDto {
  @IsString()
  @MinLength(1)
  roundId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  screenshotKey?: string;
}

export class FixRowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  pageOrScreen?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  expected?: string;
}

/** Строка журнала после парсера шаблона (ImportService). Разбор не стартует: это делает импорт отдельно. */
export interface ImportedRemarkInput {
  externalId: string | null;
  pageOrScreen: string | null;
  description: string;
  expected: string | null;
  severity: string | null;
  screenshot: { storageKey: string; width: number | null; height: number | null } | null;
  status: 'imported' | 'needs_human_parse';
}

// ---------- ответ: та же форма, что модель Remark на фронте ----------

export interface ScreenshotView {
  id: string;
  kind: ScreenshotKind;
  url: string;
  width: number | null;
  height: number | null;
}

export interface CitationView {
  id: string;
  /** Живой чанк, пока документ не переиндексирован; после — null, текст цитаты остаётся снимком. */
  chunkId: string | null;
  source: 'spec' | 'protocol';
  heading: string;
  section: string | null;
  text: string;
  soft: boolean;
}

export interface VerdictView {
  code: VerdictCode;
  userId: string;
  userName?: string;
  userRole?: Role;
  at: string;
  comment?: string;
}

/** Совет разработчика по замечанию в awaiting_pm — подсказка PM, не решение. */
export interface AdviceView {
  code: VerdictCode;
  userId: string;
  userName?: string;
  role: Role;
  at: string;
  comment?: string;
}

export interface RemarkView {
  id: string;
  projectId: string;
  roundId: string;
  roundNumber: number;
  number: number;
  title: string;
  pageOrScreen: string;
  description: string;
  expected?: string;
  status: RemarkStatus;
  /** Номер строки заказчика из журнала («J-01»), если замечание пришло импортом. */
  externalId?: string;
  severity?: string;
  authorId: string | null;
  authorName?: string;
  /** Роль автора в проекте — рядом с именем, когда людей на стороне несколько. */
  authorRole?: Role;
  fixedByName?: string;
  fixedByRole?: Role;
  closedByName?: string;
  closedByRole?: Role;
  screenshots: ScreenshotView[];
  citations: CitationView[];
  seen?: string;
  draft: string[];
  draftShort?: string;
  proposedClass?: ProposedClass;
  verdict?: VerdictView;
  /** Советы разработчиков (несколько человек — несколько советов); пусто, если никто не советовал. */
  advice: AdviceView[];
  retest?: { outcome: RetestOutcome; explanation: string };
  duplicateOfNumber?: number;
  devNote?: string;
  fixedByUserId?: string;
  closedByUserId?: string;
  closedAt?: string;
  /** Текущий AgentRun — нужен для идемпотентного вердикта. */
  runId?: string;
  /** Состояние текущего прогона: `running` — фазы идут по WS, `awaiting_human` — ждёт кнопки. */
  runStatus?: AgentRunStatus;
  runMode?: 'triage' | 'retest';
  /** Почему последний прогон failed — по-русски, для карточки («модель перегружена», «ключ не принят»). */
  runFailure?: string;
  /** Чем шёл прогон: `openai/…` или `rules/retrieve-only` — фронт показывает «по правилам, без модели». */
  runModel?: string;
  /** Повтор претензии (docs/STATUS.md): какое закрытое замечание из какого раунда это повторяет. */
  origin?: { remarkId: string; number: number; roundNumber: number };
  /** Это замечание открыли снова в другом раунде: ссылка на новую претензию. */
  reopenedBy?: { remarkId: string; number: number; roundNumber: number };
  /** Trace этого прогона в Langfuse (фаза 8): есть только когда Langfuse настроен. */
  traceUrl?: string;
  createdAt: string;
}

// ---------- сборка ответа из строк Prisma ----------

export interface RemarkRow {
  id: string;
  projectId: string;
  roundId: string;
  number: number;
  pageOrScreen: string | null;
  description: string;
  expected: string | null;
  status: RemarkStatus;
  externalId: string | null;
  severity: string | null;
  authorId: string | null;
  proposedClass: ProposedClass | null;
  rationale: string | null;
  visionFacts: string | null;
  retestOutcome: RetestOutcome | null;
  retestExplanation: string | null;
  fixedByUserId: string | null;
  closedByUserId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  duplicateOfId: string | null;
  round: { number: number };
  screenshots: Array<{ id: string; kind: ScreenshotKind; storageKey: string; width: number | null; height: number | null; createdAt: Date }>;
  citations: Array<{ id: string; chunkId: string | null; quoteText: string | null; section: string | null; documentTitle: string | null; documentKind: DocumentKind | null; effectiveAt: Date | null }>;
  verdicts: Array<{ code: VerdictCode; userId: string; comment: string | null; createdAt: Date }>;
  advices: Array<{ code: VerdictCode; userId: string; comment: string | null; updatedAt: Date }>;
  runs: Array<{ id: string; createdAt: Date; status: AgentRunStatus; mode: string; failureMessage?: string | null; model?: string | null }>;
  origin?: { id: string; number: number; round: { number: number } } | null;
  reopenedBy?: Array<{ id: string; number: number; round: { number: number } }>;
}

/** Чанк с документом — форма выдачи retrieve; в карточке цитаты теперь снимок (см. RemarkRow.citations). */
export interface ChunkInfo {
  id: string;
  section: string | null;
  content: string;
  document: { kind: DocumentKind; title: string; effectiveAt: Date | null };
}

export interface ViewExtra {
  duplicateOfNumber?: number;
  /** userId → имя, для «Автор: Business», «Исправлено: Developer», «PM · 14:02». */
  names: Map<string, string>;
  /** userId → роль в проекте (membership); нет — роль не показываем. */
  roles?: Map<string, Role>;
  /** runId → ссылка на trace Langfuse; undefined, когда Langfuse не настроен. */
  traceUrl?: (runId: string) => string | undefined;
}

/**
 * Кому собираем карточку (ADR 007). `customer` — роль business, заказчик на том же проекте, что и подрядчик:
 * он не видит советы разработчиков, комментарий вердикта PM, ссылку на трейс и предложение модели, а черновик
 * разбора и факты кадра — только после решения человека. Фильтр стоит здесь, а не в UI: REST, WS и MCP собирают
 * карточку одной функцией.
 */
export type Audience = 'internal' | 'customer';

export function audienceFor(role: Role): Audience {
  return role === 'business' ? 'customer' : 'internal';
}

/** События комнаты, которые заказчику не отдаются: сырьё черновика и совет разработчика (ADR 007). */
export const INTERNAL_EVENT_TYPES: ReadonlySet<string> = new Set(['run.token', 'run.citations', 'run.proposal', 'remark.advice']);

export function toRemarkView(r: RemarkRow, extra: ViewExtra, audience: Audience = 'internal'): RemarkView {
  const verdict = [...r.verdicts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const run = [...r.runs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const customer = audience === 'customer';
  // Заказчику черновик показываем, только когда человек уже поставил точку: до вердикта это рабочий документ PM
  const draftAllowed = !customer || r.verdicts.length > 0;
  const draft = draftAllowed && r.rationale ? r.rationale.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
  const first = draft[0];
  return {
    id: r.id,
    projectId: r.projectId,
    roundId: r.roundId,
    roundNumber: r.round.number,
    number: r.number,
    title: firstLine(r.description) || untitled(r.externalId),
    pageOrScreen: r.pageOrScreen ?? '—',
    description: r.description,
    expected: r.expected ?? undefined,
    status: r.status,
    externalId: r.externalId ?? undefined,
    severity: r.severity ?? undefined,
    authorId: r.authorId,
    authorName: r.authorId ? extra.names.get(r.authorId) : undefined,
    authorRole: r.authorId ? extra.roles?.get(r.authorId) : undefined,
    fixedByName: r.fixedByUserId ? extra.names.get(r.fixedByUserId) : undefined,
    fixedByRole: r.fixedByUserId ? extra.roles?.get(r.fixedByUserId) : undefined,
    closedByName: r.closedByUserId ? extra.names.get(r.closedByUserId) : undefined,
    closedByRole: r.closedByUserId ? extra.roles?.get(r.closedByUserId) : undefined,
    screenshots: [...r.screenshots]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((s) => ({ id: s.id, kind: s.kind, url: mediaUrl(r.projectId, s.storageKey), width: s.width, height: s.height })),
    // Цитата — снимок на момент предложения (ADR: evidence-citation-dangling); без текста (старые висячие) не показываем
    citations: r.citations.flatMap((c) => (c.quoteText ? [toCitation(c)] : [])),
    seen: draftAllowed ? (r.visionFacts ?? undefined) : undefined,
    draft,
    draftShort: first ? first.replace(/\.$/, '') : undefined,
    proposedClass: customer ? undefined : (r.proposedClass ?? undefined),
    verdict: verdict
      ? {
          code: verdict.code,
          userId: verdict.userId,
          userName: extra.names.get(verdict.userId),
          userRole: extra.roles?.get(verdict.userId),
          at: hhmm(verdict.createdAt),
          comment: customer ? undefined : (verdict.comment ?? undefined),
        }
      : undefined,
    advice: customer
      ? []
      : [...r.advices]
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
          .map((a) => ({ code: a.code, userId: a.userId, userName: extra.names.get(a.userId), role: extra.roles?.get(a.userId) ?? 'developer', at: hhmm(a.updatedAt), comment: a.comment ?? undefined })),
    retest: r.retestOutcome ? { outcome: r.retestOutcome, explanation: r.retestExplanation ?? '' } : undefined,
    duplicateOfNumber: extra.duplicateOfNumber,
    devNote: r.expected ?? undefined,
    fixedByUserId: r.fixedByUserId ?? undefined,
    closedByUserId: r.closedByUserId ?? undefined,
    closedAt: r.closedAt ? hhmm(r.closedAt) : undefined,
    runId: run?.id,
    runStatus: run?.status,
    runMode: run ? (run.mode === 'retest' ? 'retest' : 'triage') : undefined,
    runFailure: run?.status === 'failed' ? (run.failureMessage ?? undefined) : undefined,
    runModel: run?.model ?? undefined,
    origin: r.origin ? { remarkId: r.origin.id, number: r.origin.number, roundNumber: r.origin.round.number } : undefined,
    reopenedBy: r.reopenedBy?.[0] ? { remarkId: r.reopenedBy[0].id, number: r.reopenedBy[0].number, roundNumber: r.reopenedBy[0].round.number } : undefined,
    traceUrl: run && !customer ? extra.traceUrl?.(run.id) : undefined,
    createdAt: r.createdAt.toISOString(),
  };
}

function toCitation(c: RemarkRow['citations'][number]): CitationView {
  const section = c.section;
  const sectionNumber = section ? /§\S+/.exec(section)?.[0] : null;
  const isProtocol = c.documentKind === 'protocol' || c.documentKind === 'addendum';
  const date = c.effectiveAt ? ddmm(c.effectiveAt) : null;
  const heading = isProtocol
    ? `${c.documentKind === 'protocol' ? 'Протокол' : 'Доп. соглашение'}${date ? ` от ${date}` : ''}:`
    : `В ТЗ${sectionNumber ? ` (${sectionNumber})` : ''}:`;
  return {
    id: c.id,
    chunkId: c.chunkId,
    source: isProtocol ? 'protocol' : 'spec',
    heading,
    section,
    text: quote(c.quoteText ?? ''),
    soft: isProtocol,
  };
}

/** Цитата в кавычках «…», без markdown-звёздочек и обратных кавычек. */
export function quote(content: string): string {
  const clean = content
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = clean.length > 240 ? `${clean.slice(0, 237).trimEnd()}…` : clean;
  return `«${cut}»`;
}

function firstLine(s: string): string {
  const line = s.split('\n').map((l) => l.trim()).find(Boolean) ?? s;
  return line.length > 120 ? `${line.slice(0, 117).trimEnd()}…` : line;
}

/** Строка журнала без описания: заголовок карточки до того, как человек её допишет. */
function untitled(externalId: string | null): string {
  return externalId ? `Строка ${externalId} журнала без описания` : 'Строка журнала без описания';
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ddmm(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
