import { Injectable, computed, signal } from '@angular/core';
import type { Phase, Remark } from './models';
import { RemarksStore } from './remarks.store';
import { inject } from '@angular/core';

/** Тайминги из дизайна (артборд 3 и «Живое поведение»). */
const PHASE_MS = 1500;
const DRAFTING_MS = 3000;
const WORD_MS = 130;
const FADE_MS = 180;
const DIFF_MS = 1500;

const RUN_PHASES: Phase[] = ['retrieving', 'vision', 'binding', 'drafting', 'awaiting_pm'];

/**
 * Один прогон по замечанию. Сигналы читает карточка; таймеры живут здесь.
 * Форма событий повторяет docs/WS.md (run.phase / run.token / run.persisted / run.failed),
 * чтобы в фазе 6 подменить на WS без правок карточки.
 */
export class TriageRun {
  readonly phase = signal<Phase>('retrieving');
  /** Сколько слов черновика уже «напечатано». */
  readonly typed = signal(0);
  /** Кнопки решения гаснут на время повторного поиска цитаты. */
  readonly busy = signal(false);
  /** Цитата уходит и приходит с fade. */
  readonly quoteVisible = signal(true);
  /** Идёт разбор (фазы + печать черновика). Повторный поиск цитаты и дифф сюда не входят. */
  readonly analyzing = signal(false);

  readonly words: string[][];
  readonly totalWords: number;
  readonly failed = computed(() => this.phase() === 'failed');
  readonly done = computed(() => this.phase() === 'awaiting_pm' && this.typed() >= this.totalWords);

  private timers: ReturnType<typeof setTimeout>[] = [];
  private typer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly remarkId: string,
    draft: string[],
    private readonly onPersisted: () => void,
  ) {
    this.words = draft.map((p) => p.split(' '));
    this.totalWords = this.words.reduce((n, w) => n + w.length, 0);
  }

  start(): void {
    this.clear();
    this.analyzing.set(true);
    this.phase.set('retrieving');
    this.typed.set(0);
    let t = 0;
    RUN_PHASES.forEach((phase, i) => {
      if (i === 0) return;
      const prev = RUN_PHASES[i - 1];
      t += prev === 'drafting' ? DRAFTING_MS : PHASE_MS;
      this.after(t, () => {
        this.phase.set(phase);
        if (phase === 'binding') this.startTyping();
        if (phase === 'awaiting_pm') {
          this.typed.set(this.totalWords);
          this.analyzing.set(false);
          this.onPersisted();
        }
      });
    });
  }

  /** Демо ошибки: строка «Не получилось разобрать. Можно запустить снова». */
  fail(): void {
    this.clear();
    this.phase.set('failed');
  }

  retry(): void {
    this.start();
  }

  /** «Не та цитата из ТЗ» с комментарием: та же карточка, без перезагрузки. */
  requote(swapCitation: () => void): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.after(FADE_MS, () => this.phase.set('rebinding'));
    this.after(900, () => this.quoteVisible.set(false));
    this.after(1100, () => {
      swapCitation();
      this.quoteVisible.set(true);
    });
    this.after(1300, () => {
      this.phase.set('awaiting_pm');
      this.busy.set(false);
    });
  }

  /** Ретест: «Сравниваем кадры…» → результат в хранилище. */
  diff(complete: () => void): void {
    this.busy.set(true);
    this.phase.set('diffing');
    this.after(DIFF_MS, () => {
      complete();
      this.phase.set('awaiting_business_close');
      this.busy.set(false);
    });
  }

  cancel(): void {
    this.clear();
  }

  private startTyping(): void {
    if (this.typer) clearInterval(this.typer);
    this.typer = setInterval(() => {
      if (this.typed() >= this.totalWords) {
        if (this.typer) clearInterval(this.typer);
        this.typer = null;
        return;
      }
      this.typed.update((n) => n + 1);
    }, WORD_MS);
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private clear(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.typer) clearInterval(this.typer);
    this.typer = null;
    this.busy.set(false);
    this.quoteVisible.set(true);
  }
}

@Injectable({ providedIn: 'root' })
export class TriageService {
  private readonly store = inject(RemarksStore);
  private readonly runs = new Map<string, TriageRun>();

  /** Активный прогон по замечанию, если есть. */
  runFor(remarkId: string): TriageRun | undefined {
    return this.runs.get(remarkId);
  }

  /** Запустить (или перезапустить) разбор. По окончании статус становится awaiting_pm. */
  start(remark: Remark): TriageRun {
    this.runs.get(remark.id)?.cancel();
    const run = new TriageRun(remark.id, remark.draft, () => this.store.finishTriage(remark.id));
    this.runs.set(remark.id, run);
    run.start();
    return run;
  }

  /** Прогон без анимации фаз — для карточек, которые уже ждут решения. */
  idle(remark: Remark): TriageRun {
    const existing = this.runs.get(remark.id);
    if (existing) return existing;
    const run = new TriageRun(remark.id, remark.draft, () => this.store.finishTriage(remark.id));
    run.phase.set('awaiting_pm');
    run.typed.set(run.totalWords);
    this.runs.set(remark.id, run);
    return run;
  }

  drop(remarkId: string): void {
    this.runs.get(remarkId)?.cancel();
    this.runs.delete(remarkId);
  }
}
