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
}

export interface Session {
  accessToken: string;
  user: User;
  memberships: Membership[];
}

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
  /** «14:02» — локальное время решения. */
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
  authorId: string | null;
  authorName?: string;
  fixedByName?: string;
  closedByName?: string;
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

export interface ImportRow {
  rowNumber: number;
  text: string;
  status: ImportRowStatus;
  /** «строка 10 → №13» */
  remarkNumber?: number;
}

export interface NewRemarkDto {
  title: string;
  pageOrScreen: string;
  expected?: string;
  file?: File | null;
}

/** Копия docs/WS.md — чтобы в фазе 6 подменить мок на WS-клиент без правок компонентов. */
export type ServerEvent =
  | { type: 'run.phase'; runId: string; phase: Phase }
  | { type: 'run.token'; runId: string; delta: string }
  | { type: 'run.citations'; runId: string; citations: Citation[] }
  | { type: 'run.proposal'; runId: string; proposedClass: ProposedClass; rationale: string }
  | { type: 'run.persisted'; runId: string; remarkStatus: RemarkStatus }
  | { type: 'run.failed'; runId: string; message: string }
  | { type: 'presence'; userId: string; role: Role; action: 'join' | 'leave' };
