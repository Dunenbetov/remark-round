import { Injectable, computed, signal } from '@angular/core';
import type { Phase, Remark, ServerEvent } from './models';

/** Фаза, после которой черновик проявляется (fade 180 мс — переход, не имитация работы). */
const FADE_MS = 16;

/**
 * Один прогон графа по замечанию, как его видит карточка. Никаких таймеров «для красоты»:
 * фазы приходят из комнаты WS (docs/WS.md), сюда их кладёт `applyEvent`.
 */
export class TriageRun {
  readonly phase = signal<Phase>('retrieving');
  /** Идёт прогон: фазы показываются, черновик скрыт, кнопки решения недоступны. */
  readonly analyzing = signal(false);
  /** Ждём ack команды (вердикт, «Не та цитата», отмена). */
  readonly busy = signal(false);
  /** Цитата уходит на время повторного поиска. */
  readonly quoteVisible = signal(true);
  readonly draftVisible = signal(true);
  /** Черновик, как он печатается моделью (run.token). Только внутри «Черновик разбора». */
  readonly tokens = signal('');
  /** После «Не та цитата из ТЗ»: та же фаза binding, но текст «Ищем другое место в ТЗ…». */
  readonly rebinding = signal(false);
  readonly failed = computed(() => this.phase() === 'failed');
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly remarkId: string,
    public runId: string | null,
  ) {}

  /** Прогон запущен (ответ REST со статусом `running` или первая фаза из комнаты). */
  start(runId: string | null, phase: Phase): void {
    this.clear();
    this.runId = runId;
    this.analyzing.set(true);
    this.draftVisible.set(false);
    this.tokens.set('');
    this.phase.set(phase);
  }

  /** Сервер записал результат: черновик проявляется, кнопки доступны. */
  finish(phase: Phase): void {
    this.clear();
    this.phase.set(phase);
    this.analyzing.set(false);
    this.rebinding.set(false);
    this.quoteVisible.set(true);
    this.timer = setTimeout(() => this.draftVisible.set(true), FADE_MS);
  }

  fail(): void {
    this.clear();
    this.phase.set('failed');
    this.analyzing.set(false);
    this.rebinding.set(false);
    this.quoteVisible.set(true);
    this.draftVisible.set(true);
  }

  /**
   * Событие комнаты. Возвращает `reload`, когда карточку пора перечитать: сервер записал предложение,
   * решение или отмену — форма ответа REST остаётся единственным источником данных.
   */
  applyEvent(e: ServerEvent): 'reload' | null {
    switch (e.type) {
      case 'run.phase':
        if (e.runId !== this.runId) this.start(e.runId, e.phase);
        if (e.phase === 'awaiting_pm' || e.phase === 'awaiting_business_close') {
          this.finish(e.phase);
          return 'reload';
        }
        if (e.phase === 'persisted') return 'reload';
        if (e.phase === 'failed') {
          this.fail();
          return 'reload';
        }
        this.analyzing.set(true);
        this.draftVisible.set(false);
        this.phase.set(e.phase);
        return null;
      case 'run.token':
        if (e.runId === this.runId) this.tokens.update((t) => t + e.delta);
        return null;
      case 'run.persisted':
        this.finish('persisted');
        return 'reload';
      case 'run.cancelled':
        this.finish('persisted');
        return 'reload';
      case 'run.failed':
        this.fail();
        return 'reload';
      default:
        return null;
    }
  }

  cancel(): void {
    this.clear();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

@Injectable({ providedIn: 'root' })
export class TriageService {
  private readonly runs = new Map<string, TriageRun>();

  runFor(remarkId: string): TriageRun | undefined {
    return this.runs.get(remarkId);
  }

  /** Прогон идёт (сервер ответил `runStatus: running` или пришла фаза). */
  start(remark: Remark, runId: string | null, phase: Phase): TriageRun {
    const run = this.ensure(remark);
    run.start(runId, phase);
    return run;
  }

  /** Прогон без фаз — карточка уже ждёт решения или закрыта. */
  idle(remark: Remark): TriageRun {
    return this.ensure(remark);
  }

  drop(remarkId: string): void {
    this.runs.get(remarkId)?.cancel();
    this.runs.delete(remarkId);
  }

  private ensure(remark: Remark): TriageRun {
    const existing = this.runs.get(remark.id);
    if (existing) return existing;
    const run = new TriageRun(remark.id, remark.runId ?? null);
    run.phase.set(remark.status === 'awaiting_business_close' ? 'awaiting_business_close' : 'awaiting_pm');
    this.runs.set(remark.id, run);
    return run;
  }
}
