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
  /** Имя проекта в адресе: /klientskiy-kabinet/round-2/12 (core/links.ts). */
  projectSlug: string;
  role: Role;
}

export interface User {
  id: string;
  email: string;
  name: string;
  /** Сторона при регистрации (ADR 005): подсказка для экранов, прав не даёт. Роль в проекте — Membership.role. */
  preferredRole?: Role | null;
  /** Право создавать проекты (ADR 006): выдаёт администратор инстанса; у администратора есть всегда. */
  canCreateProjects: boolean;
  /** E-mail из ADMIN_EMAILS: видит /admin — люди и проекты инстанса. */
  isInstanceAdmin: boolean;
  /** Письма «вас ждёт кнопка» (ADR 009): выключаются в профиле. */
  notifyByEmail: boolean;
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

export type RegistrationMode = 'open' | 'invite_only';

export interface AuthOptions {
  /** Карточки демо-персон на входе: только на демо-стенде. */
  demoLogins: boolean;
  /** invite_only — регистрация только по ссылке приглашения (ADR 006): ссылку «Зарегистрироваться» на входе не показываем. */
  registration: RegistrationMode;
  /** SMTP настроен: приглашения и «вас ждёт кнопка» уходят письмом (ADR 009). */
  mail: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
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
  createdAt: string;
  expiresAt: string | null;
}

/** Сырой токен ссылки /join/<token> приходит один раз: при создании и по «Новая ссылка» (ADR 006). */
export interface InvitationLink {
  token: string;
  expiresAt: string;
  /** Письмо с этой ссылкой ушло приглашённому (ADR 009); без SMTP — false или пусто. */
  emailed?: boolean;
}

export type InvitationCreated = InvitationSummary & InvitationLink & {
  /** Письмо со ссылкой ушло приглашённому; иначе ссылку шлёт PM сам. */
  emailed: boolean;
};

export interface InvitationPeek {
  projectName: string;
  role: Role;
  inviterName: string;
  expiresAt: string | null;
}

export interface MembersView {
  members: MemberSummary[];
  invitations: InvitationSummary[];
}

export type AddMemberResult = { kind: 'member'; member: MemberSummary; emailed: boolean } | { kind: 'invitation'; invitation: InvitationCreated };

/** /admin/users (ADR 006): человек поперёк проектов. */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  preferredRole: Role | null;
  canCreateProjects: boolean;
  isInstanceAdmin: boolean;
  disabledAt: string | null;
  createdAt: string;
  memberships: Membership[];
}

export interface AdminProject {
  id: string;
  name: string;
  createdAt: string;
  members: number;
}

export interface Round {
  id: string;
  number: number;
  status: 'open' | 'closed';
  remarks: number;
  /** Нерешённых замечаний (не закрыто, не новое желание, не повтор). Пока хоть у одного раунда > 0, новый не открыть. */
  pending: number;
  /** Страница «Раунды» (ADR 011): сколько закрыто, новых желаний и повторов. */
  closed?: number;
  changeRequests?: number;
  duplicates?: number;
  /** ISO: когда раунд открыт. */
  createdAt?: string;
  closedAt?: string | null;
  /** Кто закрыл — имя и роль на момент закрытия. */
  closedByName?: string | null;
  closedByRole?: Role | null;
}

/** Строка истории замечания (GET /remarks/:id/history): `by` пуст — переход сделала система (граф, сбой). */
export interface RemarkHistoryEntry {
  id: string;
  /** ISO 8601 — форматирует core/format.ts. */
  at: string;
  action: string;
  fromStatus?: RemarkStatus;
  toStatus: RemarkStatus;
  /** Имя на момент действия (ADR 011); userId пуст, если аккаунт с тех пор удалён. */
  by?: { userId?: string; name: string; role?: Role };
  runId?: string;
  detail?: string;
  /** Слова человека при действии (решение, закрытие); заказчику — только слова заказчика. */
  comment?: string;
  /** Кадр этого действия; current: false — его потом заменили, но в истории он остался. */
  shot?: { kind: ScreenshotKind; url: string; current: boolean };
}

/** Ссылка между закрытым замечанием и его повтором в новом раунде (docs/STATUS.md closed → reopened). */
export interface RemarkLink {
  remarkId: string;
  number: number;
  roundNumber: number;
}

export interface Citation {
  id: string;
  /** null — документ переиндексирован после решения; текст цитаты остался снимком (ADR: evidence-citation-dangling). */
  chunkId?: string | null;
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
  /** ISO 8601 — момент решения; на экране через core/format.ts (дата с годом и время). */
  at: string;
  comment?: string;
}

/** Совет разработчика по замечанию в awaiting_pm (RemarkView.advice): подсказка PM, не решение. */
export interface Advice {
  code: VerdictCode;
  userId: string;
  userName?: string;
  role: Role;
  /** ISO 8601 — когда совет дан или изменён. */
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
  /** Как закрыли (ADR 010): после ретеста или заказчик проверил сам, без нового кадра. */
  closedVia?: 'retest' | 'business_check';
  closeComment?: string;
  /** Текущий AgentRun — для идемпотентного вердикта. */
  runId?: string;
  /** `running` — фазы идут по WS; `awaiting_human` — прогон ждёт кнопки. */
  runStatus?: 'running' | 'awaiting_human' | 'persisted' | 'cancelled' | 'failed';
  runMode?: 'triage' | 'retest';
  /** Причина сбоя последнего прогона по-русски (модель перегружена, ключ не принят…). */
  runFailure?: string;
  /** Чем шёл прогон: `openai/…` или `rules/retrieve-only` — бейдж «по правилам, без модели». */
  runModel?: string;
  /** Это повтор закрытой претензии из прошлого раунда. */
  origin?: RemarkLink;
  /** Эту закрытую претензию открыли снова в другом раунде. */
  reopenedBy?: RemarkLink;
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
