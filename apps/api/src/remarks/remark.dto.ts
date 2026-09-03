import type { DocumentKind, ProposedClass, RemarkStatus, RetestOutcome, ScreenshotKind, VerdictCode } from '@remarkround/db';
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

export class LinkDuplicateDto {
  @IsInt()
  @Min(1)
  duplicateOfNumber!: number;
}

/** «Допишите строку журнала»: человек дописывает то, чего парсер не выдумывает. */
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
  chunkId: string;
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
  fixedByName?: string;
  closedByName?: string;
  screenshots: ScreenshotView[];
  citations: CitationView[];
  seen?: string;
  draft: string[];
  draftShort?: string;
  proposedClass?: ProposedClass;
  verdict?: VerdictView;
  retest?: { outcome: RetestOutcome; explanation: string };
  duplicateOfNumber?: number;
  devNote?: string;
  fixedByUserId?: string;
  closedByUserId?: string;
  closedAt?: string;
  /** Текущий AgentRun — нужен для идемпотентного вердикта. */
  runId?: string;
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
  citations: Array<{ id: string; chunkId: string }>;
  verdicts: Array<{ code: VerdictCode; userId: string; comment: string | null; createdAt: Date }>;
  runs: Array<{ id: string; createdAt: Date }>;
}

/** Чанк цитаты с документом; грузится отдельно (у EvidenceCitation нет FK на чанк). */
export interface ChunkInfo {
  id: string;
  section: string | null;
  content: string;
  document: { kind: DocumentKind; title: string; effectiveAt: Date | null };
}

export interface ViewExtra {
  duplicateOfNumber?: number;
  chunks: Map<string, ChunkInfo>;
  /** userId → имя, для «Добавила Айгерим», «Исправил Тимур», «Дана · 14:02». */
  names: Map<string, string>;
}

export function toRemarkView(r: RemarkRow, extra: ViewExtra): RemarkView {
  const verdict = [...r.verdicts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const run = [...r.runs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const draft = r.rationale ? r.rationale.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
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
    fixedByName: r.fixedByUserId ? extra.names.get(r.fixedByUserId) : undefined,
    closedByName: r.closedByUserId ? extra.names.get(r.closedByUserId) : undefined,
    screenshots: [...r.screenshots]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((s) => ({ id: s.id, kind: s.kind, url: mediaUrl(r.projectId, s.storageKey), width: s.width, height: s.height })),
    citations: r.citations.flatMap((c) => {
      const chunk = extra.chunks.get(c.chunkId);
      return chunk ? [toCitation(c.id, chunk)] : [];
    }),
    seen: r.visionFacts ?? undefined,
    draft,
    draftShort: first ? first.replace(/\.$/, '') : undefined,
    proposedClass: r.proposedClass ?? undefined,
    verdict: verdict
      ? { code: verdict.code, userId: verdict.userId, userName: extra.names.get(verdict.userId), at: hhmm(verdict.createdAt), comment: verdict.comment ?? undefined }
      : undefined,
    retest: r.retestOutcome ? { outcome: r.retestOutcome, explanation: r.retestExplanation ?? '' } : undefined,
    duplicateOfNumber: extra.duplicateOfNumber,
    devNote: r.expected ?? undefined,
    fixedByUserId: r.fixedByUserId ?? undefined,
    closedByUserId: r.closedByUserId ?? undefined,
    closedAt: r.closedAt ? hhmm(r.closedAt) : undefined,
    runId: run?.id,
    createdAt: r.createdAt.toISOString(),
  };
}

function toCitation(id: string, chunk: ChunkInfo): CitationView {
  const doc = chunk.document;
  const section = chunk.section;
  const sectionNumber = section ? /§\S+/.exec(section)?.[0] : null;
  const isProtocol = doc.kind === 'protocol' || doc.kind === 'addendum';
  const date = doc.effectiveAt ? ddmm(doc.effectiveAt) : null;
  const heading = isProtocol
    ? `${doc.kind === 'protocol' ? 'Протокол' : 'Доп. соглашение'}${date ? ` от ${date}` : ''}:`
    : `В ТЗ${sectionNumber ? ` (${sectionNumber})` : ''}:`;
  return {
    id,
    chunkId: chunk.id,
    source: isProtocol ? 'protocol' : 'spec',
    heading,
    section,
    text: quote(chunk.content),
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
