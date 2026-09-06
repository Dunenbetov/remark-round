import { ChangeDetectionStrategy, Component, computed, effect, input, signal, untracked } from '@angular/core';
import type { Phase } from '../core/models';
import { PHASE_STEPS } from '../core/copy';

type StepPhase = keyof typeof PHASE_STEPS;

interface Step {
  phase: StepPhase;
  label: string;
}

/**
 * Лента фаз разбора: точки со связками, пройденные — заливка и галочка, текущая — пульс.
 * Показывается только пока идёт прогон (решает страница). Под лентой — строка фазы с crossfade 180 мс.
 */
@Component({
  selector: 'rr-run-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="steps" [attr.aria-label]="'Разбор'">
      @for (step of steps(); track step.phase; let i = $index; let last = $last) {
        <li class="step" [class.step--done]="i < current()" [class.step--now]="i === current()">
          <span class="step__dot">
            @if (i < current()) {
              <svg class="step__check" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 8.5l3 3 7-7" stroke-dasharray="24" />
              </svg>
            } @else if (i === current()) {
              <span class="step__pulse"></span>
            }
          </span>
          <span class="step__label">{{ step.label }}</span>
          @if (!last) {
            <span class="step__line" aria-hidden="true"><span class="step__line-fill"></span></span>
          }
        </li>
      }
    </ol>
    @if (shown()) {
      <div class="steps__text meta" aria-live="polite" [style.opacity]="visible() ? 1 : 0">{{ shown() }}</div>
    }
  `,
  styles: `
    /* container: в узкой колонке (карточка 1440 при 4 шагах) подписи не должны вылезать на соседнюю колонку */
    :host {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      container-type: inline-size;
    }
    .steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      align-items: center;
      gap: 0;
      min-width: 0;
    }
    .step {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
      min-width: 0;
    }
    .step:not(:last-child) {
      flex: 1;
    }
    .step__dot {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      border: 1.5px solid var(--rr-line-strong);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--rr-surface);
      color: var(--rr-accent-ink);
      flex: none;
      transition:
        background-color var(--dur) var(--ease),
        border-color var(--dur) var(--ease);
    }
    .step--done .step__dot {
      background: var(--rr-accent);
      border-color: var(--rr-accent);
    }
    .step--now .step__dot {
      border-color: var(--rr-accent);
    }
    .step__pulse {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--rr-accent);
      animation: rr-pulse 1.2s ease-in-out infinite;
    }
    .step__check path {
      animation: rr-draw 300ms var(--rr-ease-out) both;
    }
    .step__label {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-3);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .step--done .step__label,
    .step--now .step__label {
      color: var(--rr-ink);
    }
    .step--now .step__label {
      font-weight: 600;
    }
    .step__line {
      flex: 1;
      height: 2px;
      margin: 0 8px;
      background: var(--rr-line);
      border-radius: 1px;
      overflow: hidden;
      min-width: 16px;
    }
    .step__line-fill {
      display: block;
      height: 100%;
      background: var(--rr-accent);
      transform: scaleX(0);
      transform-origin: left;
      transition: transform var(--dur-slow) var(--rr-ease-out);
    }
    .step--done .step__line-fill {
      transform: scaleX(1);
    }
    .steps__text {
      transition: opacity 180ms;
    }
    /* узко: точки и связки, подпись только у текущего шага (текст фазы под лентой остаётся) */
    @container (max-width: 440px) {
      .step:not(.step--now) .step__label {
        display: none;
      }
      .step__line {
        margin: 0 6px;
        min-width: 12px;
      }
    }
  `,
})
export class RunSteps {
  readonly hasShot = input.required<boolean>();
  readonly phase = input.required<Phase | null>();
  /** Строка фазы под лентой; пусто — не рендерить. */
  readonly text = input<string>('');

  protected readonly steps = computed<Step[]>(() => {
    const order: StepPhase[] = this.hasShot() ? ['retrieving', 'vision', 'binding', 'drafting'] : ['retrieving', 'binding', 'drafting'];
    return order.map((phase) => ({ phase, label: PHASE_STEPS[phase] }));
  });

  /** Индекс текущего шага: -1 — ничего не подсвечено, steps.length — все пройдены. */
  protected readonly current = computed(() => {
    const phase = this.phase();
    const steps = this.steps();
    switch (phase) {
      case null:
      case 'failed':
      case 'diffing':
        return -1;
      case 'awaiting_pm':
      case 'persisted':
      case 'awaiting_business_close':
        return steps.length;
      case 'rebinding':
        return steps.findIndex((s) => s.phase === 'binding');
      default:
        return steps.findIndex((s) => s.phase === phase);
    }
  });

  // crossfade текста фазы — как в phase-line.ts
  protected readonly shown = signal('');
  protected readonly visible = signal(true);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const next = this.text();
      untracked(() => {
        if (this.shown() === '') {
          this.shown.set(next);
          return;
        }
        if (this.shown() === next) return;
        if (this.timer) clearTimeout(this.timer);
        this.visible.set(false);
        this.timer = setTimeout(() => {
          this.shown.set(next);
          this.visible.set(true);
        }, 180);
      });
    });
  }
}
