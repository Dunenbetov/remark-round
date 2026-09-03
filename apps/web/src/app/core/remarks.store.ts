import { Injectable, computed, inject, signal } from '@angular/core';
import type { DocumentKind, ImportJob, NewRemarkDto, ProjectDocument, Remark, Round, VerdictCode } from './models';
import { ApiDocument, ApiService } from './api.service';
import { ERROR } from './copy';
import { SessionService } from './session.service';
import { WsService } from './ws.service';

const DOC_LABEL: Record<DocumentKind, string> = {
  spec: 'ТЗ',
  protocol: 'Протокол',
  addendum: 'Доп. соглашение',
  journal_source: 'Журнал',
};

/**
 * Состояние проекта на фронте: раунд, замечания, документы, очередь разработчика.
 * Все переходы делает сервер (RemarksService); здесь только запросы и сигналы.
 */
@Injectable({ providedIn: 'root' })
export class RemarksStore {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly ws = inject(WsService);

  readonly projectId = signal<string | null>(null);
  readonly round = signal<Round | null>(null);
  readonly rounds = signal<Round[]>([]);
  readonly remarks = signal<Remark[]>([]);
  readonly devQueue = signal<Remark[]>([]);
  readonly documents = signal<ProjectDocument[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly projectName = computed(() => this.session.membership(this.projectId())?.projectName ?? '');
  readonly roundNumber = computed(() => this.round()?.number ?? null);
  readonly total = computed(() => this.remarks().length);
  /** «Ждут вас» у PM: ждут решения или скрина. */
  readonly awaitingCount = computed(() => this.remarks().filter((r) => r.status === 'awaiting_pm' || r.status === 'cannot_tell').length);
  readonly hasSpec = computed(() => this.documents().some((d) => d.kind === 'spec'));

  byId(id: string): Remark | undefined {
    return this.remarks().find((r) => r.id === id) ?? this.devQueue().find((r) => r.id === id);
  }

  // ---------- загрузка ----------

  /** Раунд по номеру или `latest`; журнал грузится следом. */
  async enterRound(projectId: string, roundParam: string): Promise<Round | null> {
    this.projectId.set(projectId);
    const rounds = await this.guard(() => this.api.rounds(projectId));
    if (!rounds) return null;
    this.rounds.set(rounds);
    const wanted = roundParam === 'latest' ? rounds[rounds.length - 1] : rounds.find((r) => String(r.number) === roundParam);
    const round = wanted ?? null;
    this.round.set(round);
    if (round) {
      const remarks = await this.guard(() => this.api.remarks(projectId, round.id));
      if (remarks) this.remarks.set(remarks);
    } else {
      this.remarks.set([]);
    }
    return round;
  }

  async loadRemark(projectId: string, remarkId: string): Promise<Remark | null> {
    this.projectId.set(projectId);
    const remark = await this.guard(() => this.api.remark(projectId, remarkId));
    if (remark) this.upsert(remark);
    return remark;
  }

  async loadDevQueue(projectId: string): Promise<void> {
    this.projectId.set(projectId);
    const queue = await this.guard(() => this.api.devQueue(projectId));
    if (queue) this.devQueue.set(queue);
  }

  async loadDocuments(projectId: string): Promise<void> {
    this.projectId.set(projectId);
    const docs = await this.guard(() => this.api.documents(projectId));
    if (docs) this.documents.set(docs.map(toDocument));
  }

  async uploadDocument(projectId: string, file: File, kind: DocumentKind): Promise<void> {
    await this.guard(() => this.api.uploadDocument(projectId, file, kind));
    await this.loadDocuments(projectId);
  }

  // ---------- действия ----------

  async addRemark(projectId: string, dto: NewRemarkDto): Promise<Remark | null> {
    const round = this.round();
    if (!round) return null;
    return this.guard(async () => {
      const screenshotKey = dto.file ? (await this.api.uploadMedia(projectId, dto.file)).storageKey : undefined;
      const remark = await this.api.createRemark(projectId, round.id, {
        description: dto.title.trim(),
        pageOrScreen: dto.pageOrScreen.trim() || undefined,
        expected: dto.expected?.trim() || undefined,
        screenshotKey,
      });
      this.upsert(remark);
      return remark;
    });
  }

  /** Импорт журнала в текущий раунд; журнал перечитывается — строки уже стали замечаниями. */
  async importJournal(projectId: string, file: File): Promise<ImportJob | null> {
    const round = this.round();
    if (!round) return null;
    const job = await this.guard(() => this.api.importJournal(projectId, round.id, file));
    if (job) await this.reloadRemarks(projectId, round.id);
    return job;
  }

  /** Статус строк импорта: разбор идёт на сервере после ответа, страница перечитывает задание. */
  async refreshImport(projectId: string, jobId: string): Promise<ImportJob | null> {
    try {
      return await this.api.importJob(projectId, jobId);
    } catch {
      return null;
    }
  }

  /** «Допишите строку журнала» → сервер запускает разбор и отдаёт замечание уже с черновиком. */
  async fixRow(remarkId: string, body: { description: string; pageOrScreen?: string; expected?: string }): Promise<Remark | null> {
    const remark = this.byId(remarkId);
    if (!remark) return null;
    const updated = await this.guard(() => this.api.fixRow(remark.projectId, remarkId, body));
    if (updated) this.upsert(updated);
    return updated;
  }

  /** Вердикт — в комнату WS (тот же run, идемпотентно); без сокета — REST. */
  async verdict(remarkId: string, code: Exclude<VerdictCode, 'rejected_binding'>, comment?: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark?.runId) return;
    const body = { verdict: code, comment: comment || undefined, runId: remark.runId, idempotencyKey: crypto.randomUUID() };
    await this.mutate(() => this.ws.command('verdict.approve', { remarkId, ...body }, () => this.api.verdict(remark.projectId, remarkId, body)));
  }

  async rejectBinding(remarkId: string, comment: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark?.runId) return;
    const body = { verdict: 'rejected_binding' as const, comment, runId: remark.runId, idempotencyKey: crypto.randomUUID() };
    await this.mutate(() => this.ws.command('verdict.reject_binding', { remarkId, ...body }, () => this.api.verdict(remark.projectId, remarkId, body)));
  }

  /** run.cancel: вердикта нет, замечание снова «Получено». */
  async cancelRun(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark?.runId) return;
    const body = { runId: remark.runId, idempotencyKey: crypto.randomUUID() };
    await this.mutate(() => this.ws.command('run.cancel', { remarkId, ...body }, () => this.api.cancelRun(remark.projectId, remarkId, body)));
  }

  /** «Запустить снова» после сбоя: новый прогон. */
  async triageAgain(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(() => this.api.action(remark.projectId, remarkId, 'triage'));
  }

  async linkDuplicate(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark?.duplicateOfNumber) return;
    await this.mutate(() => this.api.linkDuplicate(remark.projectId, remarkId, remark.duplicateOfNumber!));
    this.patch(remarkId, { duplicateLinked: true });
  }

  async readyForRetest(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(() => this.api.action(remark.projectId, remarkId, 'ready-for-retest'));
  }

  /** Новый кадр по «Не хватает скрина»: сервер сам запускает разбор. */
  async attachShot(remarkId: string, file: File): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(async () => {
      const media = await this.api.uploadMedia(remark.projectId, file);
      return this.api.screenshot(remark.projectId, remarkId, media.storageKey);
    });
  }

  async retest(remarkId: string, file: File): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(async () => {
      const media = await this.api.uploadMedia(remark.projectId, file);
      return this.api.retest(remark.projectId, remarkId, media.storageKey);
    });
  }

  async close(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(() => this.api.action(remark.projectId, remarkId, 'close'));
  }

  async notFixed(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(() => this.api.action(remark.projectId, remarkId, 'not-fixed'));
  }

  // ---------- helpers ----------

  private async reloadRemarks(projectId: string, roundId: string): Promise<void> {
    const remarks = await this.guard(() => this.api.remarks(projectId, roundId));
    if (remarks) this.remarks.set(remarks);
  }

  private async mutate(fn: () => Promise<Remark>): Promise<void> {
    const updated = await this.guard(fn);
    if (updated) this.upsert(updated);
  }

  private upsert(remark: Remark): void {
    const patchList = (list: Remark[]): Remark[] => {
      const i = list.findIndex((r) => r.id === remark.id);
      if (i < 0) return list;
      const next = [...list];
      next[i] = { ...remark, duplicateLinked: list[i]!.duplicateLinked };
      return next;
    };
    const inRound = this.round() && remark.roundId === this.round()!.id;
    this.remarks.update((list) => (list.some((r) => r.id === remark.id) ? patchList(list) : inRound ? [remark, ...list] : list));
    this.devQueue.update((list) => {
      const visible = remark.status === 'defect' || remark.status === 'ready_for_retest';
      if (list.some((r) => r.id === remark.id)) return visible ? patchList(list) : list.filter((r) => r.id !== remark.id);
      return list;
    });
    if (!this.byId(remark.id)) this.remarks.update((list) => [remark, ...list]);
  }

  private patch(remarkId: string, patch: Partial<Remark>): void {
    this.remarks.update((list) => list.map((r) => (r.id === remarkId ? { ...r, ...patch } : r)));
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      return await fn();
    } catch (e) {
      const message = (e as { error?: { message?: string | string[] }; message?: string }).error?.message ?? (e as Error).message ?? ERROR.request;
      this.error.set(Array.isArray(message) ? message.join(', ') : String(message));
      return null;
    } finally {
      this.loading.set(false);
    }
  }
}

function toDocument(d: ApiDocument): ProjectDocument {
  const date = new Date(d.effectiveAt ?? d.createdAt);
  return {
    id: d.id,
    kind: d.kind,
    label: DOC_LABEL[d.kind],
    fileName: d.title,
    date: `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`,
    pages: null,
    chunks: d.chunks ?? 0,
    status: d.status,
  };
}
