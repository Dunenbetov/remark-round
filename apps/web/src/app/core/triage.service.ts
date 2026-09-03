import { Injectable, computed, signal } from '@angular/core';
import type { Phase, Remark } from './models';

/** Фазы идут по 200 мс — только чтобы человек успел прочитать строку. Печати по словам нет. */
const STEP_MS = 200;
const FADE_MS = 180;

const RUN_PHASES: Phase[] = ['retrieving', 'vision', 'binding', 'drafting'];

/**
 * Один прогон по замечанию. Сигналы читает карточка; таймеры живут здесь.
 * Форма повторяет docs/WS.md (run.phase / run.persisted / run.failed): в фазе 6
 * `applyEvent(ServerEvent)` заменит таймеры, карточка не меняется.
 */
export class TriageRun {
  readonly phase = signal<Phase>('retrieving');
  /** Кнопки решения гаснут на время повторного поиска цитаты или диффа. */
  readonly busy = signal(false);
  /** Цитата уходит и приходит с fade. */
  readonly quoteVisible = signal(true);
  /** Идёт разбор: фазы показываются, черновик скрыт. */
  readonly analyzing = signal(false);
  /** Черновик появляется с fade 180 мс, когда разбор закончен. */
  readonly draftVisible = signal(true);

  readonly failed = computed(() => this.phase() === 'failed');

  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    readonly remarkId: string,
    /** Демо (?run=1): прогон заканчивается сам; иначе ждём, пока сервер выйдет из `triaging`. */
    readonly demo: boolean,
  ) {}

  start(): void {
    this.clear();
    this.analyzing.set(true);
    this.draftVisible.set(false);
    this.phase.set('retrieving');
    RUN_PHASES.forEach((phase, i) => {
      if (i) this.after(i * STEP_MS, () => this.phase.set(phase));
    });
    if (this.demo) this.after(RUN_PHASES.length * STEP_MS + STEP_MS, () => this.finish());
  }

  /** Сервер записал результат: черновик проявляется, кнопки доступны. */
  finish(): void {
    this.clear();
    this.phase.set('awaiting_pm');
    this.analyzing.set(false);
    this.after(16, () => this.draftVisible.set(true));
  }

  /** Строка «Не получилось разобрать. Можно запустить снова». */
  fail(): void {
    this.clear();
    this.phase.set('failed');
    this.analyzing.set(false);
    this.draftVisible.set(true);
  }

  retry(): void {
    this.start();
  }

  /** «Не та цитата из ТЗ» с комментарием: та же карточка, цитата меняется без перезагрузки. */
  async requote(swapCitation: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.phase.set('rebinding');
    this.quoteVisible.set(false);
    try {
      await Promise.all([swapCitation(), wait(FADE_MS)]);
    } finally {
      this.quoteVisible.set(true);
      this.phase.set('awaiting_pm');
      this.busy.set(false);
    }
  }

  /** Ретест: «Сравниваем кадры…» → результат в хранилище. */
  async diff(complete: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.phase.set('diffing');
    try {
      await complete();
    } finally {
      this.phase.set('awaiting_business_close');
      this.busy.set(false);
    }
  }

  cancel(): void {
    this.clear();
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private clear(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Пока разбор на сервере синхронный (заглушка фазы 3), прогон здесь — только показ фаз.
 * В фазе 6 фазы придут по WS.
 */
@Injectable({ providedIn: 'root' })
export class TriageService {
  private readonly runs = new Map<string, TriageRun>();

  /** Активный прогон по замечанию, если есть. */
  runFor(remarkId: string): TriageRun | undefined {
    return this.runs.get(remarkId);
  }

  /** Запустить (или перезапустить) показ разбора. */
  start(remark: Remark, demo = false): TriageRun {
    this.runs.get(remark.id)?.cancel();
    const run = new TriageRun(remark.id, demo);
    this.runs.set(remark.id, run);
    run.start();
    return run;
  }

  /** Прогон без анимации фаз — для карточек, которые уже ждут решения. */
  idle(remark: Remark): TriageRun {
    const existing = this.runs.get(remark.id);
    if (existing) return existing;
    const run = new TriageRun(remark.id, false);
    run.phase.set('awaiting_pm');
    this.runs.set(remark.id, run);
    return run;
  }

  drop(remarkId: string): void {
    this.runs.get(remarkId)?.cancel();
    this.runs.delete(remarkId);
  }
}
