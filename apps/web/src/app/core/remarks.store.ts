import { Injectable, computed, inject, signal } from '@angular/core';
import type { Advice, DocumentKind, ImportJob, NewRemarkDto, ProjectDocument, Remark, Round, VerdictCode } from './models';
import { ApiDocument, ApiService } from './api.service';
import { DOCUMENTS } from './copy';
import { errorMessage, errorStatus } from './errors';
import { SessionService } from './session.service';
import { WsService } from './ws.service';

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
  /** Разработчику: замечания на приёмке у PM (awaiting_pm) — можно посоветовать. */
  readonly advisoryQueue = signal<Remark[]>([]);
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
    return this.remarks().find((r) => r.id === id) ?? this.devQueue().find((r) => r.id === id) ?? this.advisoryQueue().find((r) => r.id === id);
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

  /** Новый раунд (pm, business, admin): следующий номер; журнал открывается пустым. */
  async createRound(projectId: string): Promise<Round | null> {
    this.projectId.set(projectId);
    const round = await this.guard(() => this.api.createRound(projectId));
    if (round) {
      this.rounds.update((list) => [...list, round]);
      this.round.set(round);
      this.remarks.set([]);
    }
    return round;
  }

  async closeRound(projectId: string, roundId: string): Promise<Round | null> {
    const round = await this.guard(() => this.api.closeRound(projectId, roundId));
    if (round) this.replaceRound(round);
    return round;
  }

  async reopenRound(projectId: string, roundId: string): Promise<Round | null> {
    const round = await this.guard(() => this.api.reopenRound(projectId, roundId));
    if (round) this.replaceRound(round);
    return round;
  }

  private replaceRound(round: Round): void {
    this.rounds.update((list) => list.map((r) => (r.id === round.id ? round : r)));
    if (this.round()?.id === round.id) this.round.set(round);
  }

  /** Повтор закрытой претензии в открытом раунде: новое замечание, статус reopened; дальше — «Запустить разбор». */
  async reopenRemark(remarkId: string, roundId: string): Promise<Remark | null> {
    const remark = this.byId(remarkId);
    if (!remark) return null;
    const created = await this.guard(() => this.api.reopenRemark(remark.projectId, remarkId, { roundId }), remarkId);
    if (created) {
      this.upsert(created);
      this.patch(remarkId, { reopenedBy: { remarkId: created.id, number: created.number, roundNumber: created.roundNumber } });
    }
    return created;
  }

  /** id карточки по адресу /<slug>/round-2/12: из уже загруженных списков, иначе GET …/remarks/at/2/12. Ошибка — null, не баннер: решает резолвер. */
  async remarkIdAt(projectId: string, roundNumber: number, number: number): Promise<string | null> {
    const known = [...this.remarks(), ...this.devQueue(), ...this.advisoryQueue()].find((r) => r.projectId === projectId && r.roundNumber === roundNumber && r.number === number);
    if (known) return known.id;
    try {
      const remark = await this.api.remarkAt(projectId, roundNumber, number);
      this.upsert(remark);
      return remark.id;
    } catch {
      return null;
    }
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

  async loadAdvisoryQueue(projectId: string): Promise<void> {
    this.projectId.set(projectId);
    const queue = await this.guard(() => this.api.advisoryQueue(projectId));
    if (queue) this.advisoryQueue.set(queue);
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
    await this.mutate(remarkId, () => this.ws.command('verdict.approve', { remarkId, ...body }, () => this.api.verdict(remark.projectId, remarkId, body)));
  }

  async rejectBinding(remarkId: string, comment: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark?.runId) return;
    const body = { verdict: 'rejected_binding' as const, comment, runId: remark.runId, idempotencyKey: crypto.randomUUID() };
    await this.mutate(remarkId, () => this.ws.command('verdict.reject_binding', { remarkId, ...body }, () => this.api.verdict(remark.projectId, remarkId, body)));
  }

  /** run.cancel: вердикта нет, замечание снова «Получено». */
  async cancelRun(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark?.runId) return;
    const body = { runId: remark.runId, idempotencyKey: crypto.randomUUID() };
    await this.mutate(remarkId, () => this.ws.command('run.cancel', { remarkId, ...body }, () => this.api.cancelRun(remark.projectId, remarkId, body)));
  }

  /** «Запустить снова» после сбоя: новый прогон. */
  async triageAgain(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(remarkId, () => this.api.action(remark.projectId, remarkId, 'triage'));
  }

  async linkDuplicate(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark?.duplicateOfNumber) return;
    await this.mutate(remarkId, () => this.api.linkDuplicate(remark.projectId, remarkId, remark.duplicateOfNumber!));
    this.patch(remarkId, { duplicateLinked: true });
  }

  /** Совет разработчика — сразу, без отсчёта: его можно изменить или снять. */
  async advise(remarkId: string, code: VerdictCode, comment?: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(remarkId, () => this.api.advise(remark.projectId, remarkId, { code, comment: comment || undefined }));
  }

  async retractAdvice(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(remarkId, () => this.api.retractAdvice(remark.projectId, remarkId));
  }

  /** Событие remark.advice из комнаты: обновить советы без перечитывания карточки. */
  applyAdvice(remarkId: string, advice: Advice[]): void {
    this.patch(remarkId, { advice });
  }

  async readyForRetest(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(remarkId, () => this.api.action(remark.projectId, remarkId, 'ready-for-retest'));
  }

  /** Новый кадр по «Не хватает скрина»: сервер сам запускает разбор. */
  async attachShot(remarkId: string, file: File): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(remarkId, async () => {
      const media = await this.api.uploadMedia(remark.projectId, file);
      return this.api.screenshot(remark.projectId, remarkId, media.storageKey);
    });
  }

  async retest(remarkId: string, file: File): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(remarkId, async () => {
      const media = await this.api.uploadMedia(remark.projectId, file);
      return this.api.retest(remark.projectId, remarkId, media.storageKey);
    });
  }

  /** «Закрыть: исправлено» — после ретеста или сразу, если заказчик проверил сам (ADR 010); комментарий по желанию. */
  async close(remarkId: string, comment?: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(remarkId, () => this.api.action(remark.projectId, remarkId, 'close', comment?.trim() ? { comment: comment.trim() } : {}));
  }

  async notFixed(remarkId: string): Promise<void> {
    const remark = this.byId(remarkId);
    if (!remark) return;
    await this.mutate(remarkId, () => this.api.action(remark.projectId, remarkId, 'not-fixed'));
  }

  // ---------- helpers ----------

  private async reloadRemarks(projectId: string, roundId: string): Promise<void> {
    const remarks = await this.guard(() => this.api.remarks(projectId, roundId));
    if (remarks) this.remarks.set(remarks);
  }

  /**
   * Мутация карточки. 409 — статус уже изменился (второй человек нажал раньше, прогон завершился):
   * перечитываем карточку, чтобы человек увидел актуальное решение, а не своё пропавшее (docs/STATUS.md).
   */
  private async mutate(remarkId: string, fn: () => Promise<Remark>): Promise<void> {
    const updated = await this.guard(fn, remarkId);
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
    this.advisoryQueue.update((list) => {
      if (list.some((r) => r.id === remark.id)) return remark.status === 'awaiting_pm' ? patchList(list) : list.filter((r) => r.id !== remark.id);
      return list;
    });
    if (!this.byId(remark.id)) this.remarks.update((list) => [remark, ...list]);
  }

  private patch(remarkId: string, patch: Partial<Remark>): void {
    const apply = (list: Remark[]): Remark[] => list.map((r) => (r.id === remarkId ? { ...r, ...patch } : r));
    this.remarks.update(apply);
    this.devQueue.update(apply);
    this.advisoryQueue.update(apply);
  }

  private async guard<T>(fn: () => Promise<T>, remarkId?: string): Promise<T | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      return await fn();
    } catch (e) {
      this.error.set(errorMessage(e));
      const stale = remarkId ? this.byId(remarkId) : null;
      if (errorStatus(e) === 409 && stale) {
        try {
          this.upsert(await this.api.remark(stale.projectId, remarkId!));
        } catch {
          /* не смогли перечитать — сообщение об ошибке уже показано */
        }
      }
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
    label: DOCUMENTS.kinds[d.kind],
    fileName: d.title,
    date: `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`,
    pages: null,
    chunks: d.chunks ?? 0,
    status: d.status,
  };
}
