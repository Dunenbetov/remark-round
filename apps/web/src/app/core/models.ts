/**
 * Имена сущностей и кодов — как в packages/db/prisma/schema.prisma и docs/API.md.
 * Форма Remark совпадает с RemarkView сервера (apps/api/src/remarks/remark.dto.ts).
 * Коды никогда не показываются на экране: русские подписи берутся из core/copy.ts.
 */

export type Role = 'business' | 'pm' | 'developer' | 'admin';

export type RemarkStatus =
  | 'imported'
  | 'needs_human_parse'
  | 'triaging'
  | 'awaiting_pm'
  | 'defect'
  | 'change_request'
  | 'unspecified'
  | 'duplicate'
  | 'cannot_tell'
  | 'ready_for_retest'
  | 'awaiting_business_close'
  | 'closed'
  | 'reopened';

export type VerdictCode =
  | 'defect'
  | 'change_request'
  | 'unspecified'
  | 'duplicate'
  | 'cannot_tell'
  | 'rejected_binding';

/** docs/WS.md `Phase` + `rebinding` (повторный поиск после «Не та цитата из ТЗ»). */
export type Phase =
  | 'retrieving'
  | 'vision'
  | 'binding'
  | 'rebinding'
  | 'drafting'
  | 'awaiting_pm'
  | 'diffing'
  | 'awaiting_business_close'
  | 'persisted'
  | 'failed';

export type ProposedClass =
  | 'defect_candidate'
  | 'change_request_candidate'
  | 'unspecified'
  | 'duplicate'
  | 'cannot_tell';

export type RetestOutcome = 'likely_addressed' | 'likely_unchanged' | 'cannot_tell';

export type ShotVariant = 'grey' | 'blue' | 'diff';
export type ScreenshotKind = 'original' | 'retest' | 'diff';

export type DocumentKind = 'spec' | 'protocol' | 'addendum' | 'journal_source';
export type DocumentStatus = 'uploaded' | 'parsed' | 'indexed' | 'failed';
export type ImportRowStatus = 'parsed' | 'needs_human_parse' | 'failed';

export type Tone = 'accent' | 'wait' | 'work';

export interface Membership {
  projectId: string;
  projectName: string;
  role: Role;
}

export interface User {
  id: string;
  email: string;
  name: string;
  /** Сторона при регистрации (ADR 005): подсказка; право создавать проекты — только pm. Роль в проекте — Membership.role. */
  preferredRole?: Role | null;
}

export interface Session {
  accessToken: string;
  user: User;
  memberships: Membership[];
}

/** Стороны при регистрации: admin — роль проекта, её не выбирают. */
export type Side = Exclude<Role, 'admin'>;

/** GET /auth/me — свежие пользователь и membership без перелогина. */
export interface MeResult {
  user: User;
  memberships: Membership[];
}

export interface AuthOptions {
  /** Карточки демо-персон на входе: только на демо-стенде. */
  demoLogins: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface MemberSummary {
  userId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

/** Приглашённый, который ещё не зарегистрировался: ссылка `${origin}/join/${token}`. */
export interface InvitationSummary {
  id: string;
  email: string;
  role: Role;
  token: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface InvitationPeek {
  projectName: string;
  role: Role;
  email: string;
  inviterName: string;
  expiresAt: string | null;
}

export interface MembersView {
  members: MemberSummary[];
  invitations: InvitationSummary[];
}

export type AddMemberResult = { kind: 'member'; member: MemberSummary } | { kind: 'invitation'; invitation: InvitationSummary };

export interface Round {
  id: string;
  number: number;
  status: 'open' | 'closed';
  remarks: number;
}

export interface Citation {
  id: string;
  chunkId?: string;
  source: 'spec' | 'protocol';
  /** «В ТЗ (§2.1):», «Протокол от 12.03:» */
  heading: string;
  section?: string | null;
  text: string;
  /** Серая полоса: цитата не подтверждает, а фиксирует отсутствие. */
  soft?: boolean;
}

export interface Screenshot {
  id?: string;
  kind: ScreenshotKind;
  /** Мок-кадр (компонент Shot), когда нет настоящего файла. */
  variant?: ShotVariant;
  /** Защищённый URL API: грузится через MediaService с токеном. */
  url?: string;
  width?: number | null;
  height?: number | null;
}

export interface Verdict {
  code: VerdictCode;
  userId: string;
  userName?: string;
  userRole?: Role;
  /** «14:02» — локальное время решения. */
  at: string;
  comment?: string;
}

/** Совет разработчика по замечанию в awaiting_pm (RemarkView.advice): подсказка PM, не решение. */
export interface Advice {
  code: VerdictCode;
  userId: string;
  userName?: string;
  role: Role;
  /** «14:02» — когда совет дан или изменён. */
  at: string;
  comment?: string;
}

export interface Retest {
  outcome: RetestOutcome;
  explanation: string;
}

export interface Remark {
  id: string;
  projectId: string;
  roundId?: string;
  roundNumber: number;
  number: number;
  title: string;
  pageOrScreen: string;
  description: string;
  expected?: string;
  status: RemarkStatus;
  /** Номер строки заказчика из журнала («J-01»), если пришло импортом. */
  externalId?: string;
  severity?: string;
  authorId: string | null;
  authorName?: string;
  /** Роль автора в проекте — подпись рядом с именем, когда людей на стороне несколько. */
  authorRole?: Role;
  fixedByName?: string;
  fixedByRole?: Role;
  closedByName?: string;
  closedByRole?: Role;
  screenshots: Screenshot[];
  citations: Citation[];
  /** «На скрине видно: …» */
  seen?: string;
  /** Абзацы черновика разбора. */
  draft: string[];
  /** Короткая фраза для колонки «Черновик» журнала. */
  draftShort?: string;
  proposedClass?: ProposedClass;
  verdict?: Verdict;
  /** Советы разработчиков; пусто, пока никто не советовал. */
  advice?: Advice[];
  retest?: Retest;
  duplicateOfNumber?: number;
  /** «Связать с №4» нажато (локальная пометка). */
  duplicateLinked?: boolean;
  /** Что ждём от разработчика — подпись в очереди «В работу». */
  devNote?: string;
  fixedByUserId?: string;
  closedByUserId?: string;
  closedAt?: string;
  /** Текущий AgentRun — для идемпотентного вердикта. */
  runId?: string;
  /** `running` — фазы идут по WS; `awaiting_human` — прогон ждёт кнопки. */
  runStatus?: 'running' | 'awaiting_human' | 'persisted' | 'cancelled' | 'failed';
  runMode?: 'triage' | 'retest';
  /** Trace прогона в Langfuse — только когда сервер его настроил; показываем PM. */
  traceUrl?: string;
  /** ISO-дата создания (RemarkView.createdAt). */
  createdAt?: string;
}

/** Хит поиска по документам — GET /projects/:id/search (apps/api/src/rag/rag.service.ts SearchHit). */
export interface SearchHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentKind: DocumentKind;
  section: string | null;
  page: number | null;
  content: string;
  /** Косинусная близость 0..1; на экран не выводится. */
  score: number;
}

export interface ProjectDocument {
  id: string;
  kind: DocumentKind;
  /** «ТЗ», «Протокол», «Доп. соглашение» */
  label: string;
  fileName: string;
  /** «14.01» */
  date: string;
  pages: number | null;
  chunks: number;
  status: DocumentStatus;
}

/** Строка импорта — ответ GET /projects/:id/imports/:jobId (apps/api/src/imports/import.dto.ts). */
export interface ImportRow {
  rowNumber: number;
  status: ImportRowStatus;
  externalId: string | null;
  /** Первая строка description. */
  text: string;
  pageOrScreen: string | null;
  /** Почему строка ушла человеку — по-русски, с сервера. */
  reason: string | null;
  /** Ссылка на скрин из файла: её не тянем, кадр прикрепляют на карточке. */
  screenshotRef: string | null;
  hasScreenshot: boolean;
  remarkId: string | null;
  /** «строка 10 → №13» */
  remarkNumber: number | null;
  remarkStatus: RemarkStatus | null;
}

export interface ImportJob {
  id: string;
  projectId: string;
  roundId: string;
  fileName: string;
  createdAt: string;
  rows: ImportRow[];
  parsed: number;
  needsHumanParse: number;
}

export interface NewRemarkDto {
  title: string;
  pageOrScreen: string;
  expected?: string;
  file?: File | null;
}

/** Кто ещё смотрит карточку (presence из комнаты WS). */
export interface Presence {
  userId: string;
  role: Role;
  name: string;
}

/** docs/WS.md сервер → клиент (apps/api/src/agent/run-events.ts). */
export type ServerEvent =
  | { type: 'run.phase'; runId: string; phase: Phase }
  | { type: 'run.token'; runId: string; delta: string }
  | { type: 'run.citations'; runId: string; citations: Citation[] }
  | { type: 'run.proposal'; runId: string; proposedClass: ProposedClass; rationale: string }
  | { type: 'run.persisted'; runId: string; remarkStatus: RemarkStatus }
  | { type: 'run.cancelled'; runId: string; remarkStatus: RemarkStatus }
  | { type: 'run.failed'; runId: string; message: string }
  | ({ type: 'presence'; action: 'join' | 'leave' } & Presence)
  | { type: 'remark.advice'; remarkId: string; advice: Advice[] };

/** Ответ на join: текущий прогон (если идёт) и кто уже в комнате. */
export type JoinAck = { ok: true; runId?: string; phase?: Phase; presence: Presence[] } | { ok: false; status: number; message: string };
