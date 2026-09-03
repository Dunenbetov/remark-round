import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import type { VerdictCode } from '../core/models';
import { COMMON, DECISION, PM_VERDICTS } from '../core/copy';

/**
 * Режимы панели «Ваше решение»:
 * disabled — черновик ещё готовится; pm-full — пять кнопок PM; pm-two — «нужно ваше решение», две кнопки;
 * attach — бизнесу не хватает скрина; retest — «Закрыть: исправлено» / «Не исправлено»;
 * retest-wait — те же кнопки недоступны до нового кадра; record — решение уже принято.
 * `pending` поверх любого режима: решение выбрано, 5 секунд можно «Отменить».
 */
export type DecisionMode = 'disabled' | 'pm-full' | 'pm-two' | 'attach' | 'retest' | 'retest-wait' | 'record';

export interface DecisionRecord {
  label: string;
  who: string;
  at: string;
  changeable: boolean;
}

export interface DecisionPending {
  label: string;
  /** Пять секунд прошли, запрос уходит: отменить уже нельзя. */
  committing?: boolean;
}

@Component({
  selector: 'rr-decision-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'panel',
    '[class.panel--record]': "mode() === 'record' && !pending()",
    '[class.panel--glass]': "mode() !== 'record' || !!pending()",
    '[class.panel--comment-open]': 'commentOpen()',
  },
  template: `
    @if (pending(); as p) {
      <div class="record record--pending">
        <div class="record__title">{{ copy.record }} {{ p.label }}</div>
        <button type="button" class="btn btn--secondary record__undo" [class.btn--busy]="p.committing" [disabled]="p.committing" (click)="undo.emit()">{{ common.undo }}</button>
        <span class="undo-line" aria-hidden="true"><span class="undo-line__fill"></span></span>
      </div>
    } @else {
      @switch (mode()) {
        @case ('record') {
          <div class="record">
            <div class="record__title">{{ copy.record }} {{ record()?.label }}</div>
            <div class="meta">{{ record()?.who }} · {{ record()?.at }}</div>
            @if (record()?.changeable) {
              <button type="button" class="btn btn--text record__change" (click)="changeDecision.emit()">{{ copy.change }}</button>
            }
          </div>
        }
        @case ('attach') {
          <button type="button" class="btn btn--primary btn--left" [class.btn--busy]="busy()" [disabled]="busy()" (click)="attach.emit()">{{ copy.attachShot }}</button>
          <div class="hint">{{ attachHint() ?? copy.attachFooterHint }}</div>
        }
        @case ('retest') {
          <button type="button" class="btn btn--primary btn--left" [class.btn--busy]="busy() && clicked() === 'close'" [disabled]="busy()" (click)="act('close')">{{ copy.closeFixed }}</button>
          <button type="button" class="btn btn--secondary btn--left" [class.btn--busy]="busy() && clicked() === 'notFixed'" [disabled]="busy()" (click)="act('notFixed')">{{ copy.notFixed }}</button>
          <div class="hint">{{ copy.onlyBusinessCloses }}</div>
        }
        @case ('retest-wait') {
          <button type="button" class="btn btn--secondary btn--left" disabled>{{ copy.closeFixed }}</button>
          <button type="button" class="btn btn--secondary btn--left" disabled>{{ copy.notFixed }}</button>
          <div class="hint">{{ copy.waitFrame }}</div>
        }
        @case ('disabled') {
          @for (v of verdicts; track v.code) {
            <button type="button" class="btn btn--left" [class.btn--outline-primary]="v.primary" [class.btn--secondary]="!v.primary" disabled>{{ v.label }}</button>
          }
          <div class="hint">{{ copy.waitDraft }}</div>
        }
        @default {
          @for (v of visibleVerdicts(); track v.code) {
            <button
              type="button"
              class="btn btn--left"
              [class.btn--primary]="v.primary"
              [class.btn--secondary]="!v.primary"
              [class.btn--busy]="busy() && clicked() === v.code"
              [disabled]="busy()"
              (click)="pick(v.code)"
            >
              {{ v.label }}
            </button>
          }
          <label class="meta panel__label" [for]="commentId">{{ commentLabel() }}</label>
          <button type="button" class="btn btn--text panel__toggle" [attr.aria-expanded]="commentOpen()" [attr.aria-controls]="commentId" (click)="commentOpen.set(!commentOpen())">
            {{ commentLabel() }}
          </button>
          <textarea
            class="textarea panel__comment"
            rows="3"
            [id]="commentId"
            [value]="comment()"
            [disabled]="busy()"
            [attr.aria-invalid]="hint() ? 'true' : null"
            (input)="onComment($event)"
          ></textarea>
          @if (hint()) {
            <div class="meta panel__required" role="alert">{{ copy.commentRequired }}</div>
          }
        }
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      padding: var(--sp-4);
      position: sticky;
      top: calc(var(--rr-bar-h) + var(--sp-4));
    }
    :host(.panel--glass) {
      background: var(--rr-glass-bg);
      -webkit-backdrop-filter: blur(16px) saturate(140%);
      backdrop-filter: blur(16px) saturate(140%);
      border: 1px solid var(--rr-glass-line);
      box-shadow: var(--rr-glass-shadow);
      border-radius: var(--rr-r-xl);
    }
    :host(.panel--record) {
      background: var(--rr-surface-2);
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-lg);
      gap: 6px;
    }
    .record {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .record__title {
      font-weight: var(--fw-semibold);
    }
    .record__change {
      margin-top: 6px;
      align-self: flex-start;
    }
    .record--pending {
      position: relative;
      padding-bottom: var(--sp-2);
    }
    .record__undo {
      align-self: flex-start;
      min-height: 36px;
      margin-top: var(--sp-1);
    }
    .undo-line {
      display: block;
      height: 3px;
      border-radius: var(--rr-r-pill);
      background: var(--rr-line);
      overflow: hidden;
      margin-top: var(--sp-2);
    }
    .undo-line__fill {
      display: block;
      height: 100%;
      width: 100%;
      background: var(--rr-accent);
      transform-origin: left;
      animation: rr-undo var(--undo-ms) linear forwards;
    }
    @keyframes rr-undo {
      from {
        transform: scaleX(1);
      }
      to {
        transform: scaleX(0);
      }
    }
    .hint {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-3);
      margin-top: var(--sp-1);
    }
    .panel__label {
      margin-top: var(--sp-2);
    }
    .panel__toggle {
      display: none;
      margin-top: var(--sp-1);
      align-self: flex-start;
      font-weight: var(--fw-regular);
      color: var(--rr-ink-2);
    }
    .panel__required {
      color: var(--rr-danger);
    }
    @media (max-width: 720px) {
      :host {
        position: static;
        padding: var(--sp-3);
        gap: 6px;
      }
      .btn--left {
        min-height: 40px;
        padding-top: 0;
        padding-bottom: 0;
      }
      .panel__label {
        display: none;
      }
      .panel__toggle {
        display: inline-flex;
      }
      :host(:not(.panel--comment-open)) .panel__comment {
        display: none;
      }
    }
  `,
})
export class DecisionPanel {
  readonly mode = input.required<DecisionMode>();
  readonly busy = input(false);
  readonly record = input<DecisionRecord | null>(null);
  readonly pending = input<DecisionPending | null>(null);
  readonly attachHint = input<string | null>(null);

  readonly verdict = output<{ code: Exclude<VerdictCode, 'rejected_binding'>; comment: string }>();
  readonly rejectBinding = output<string>();
  readonly attach = output<void>();
  readonly close = output<void>();
  readonly notFixed = output<void>();
  readonly changeDecision = output<void>();
  readonly undo = output<void>();

  protected readonly copy = DECISION;
  protected readonly common = COMMON;
  protected readonly verdicts = PM_VERDICTS;
  protected readonly comment = signal('');
  protected readonly hint = signal(false);
  protected readonly commentOpen = signal(false);
  protected readonly clicked = signal<string | null>(null);
  protected readonly commentId = `rr-comment-${Math.random().toString(36).slice(2, 8)}`;

  protected readonly visibleVerdicts = computed(() =>
    this.mode() === 'pm-two' ? PM_VERDICTS.filter((v) => v.code === 'defect' || v.code === 'change_request') : PM_VERDICTS,
  );
  protected readonly commentLabel = computed(() => (this.mode() === 'pm-two' ? DECISION.commentLabelShort : DECISION.commentLabel));

  constructor() {
    effect(() => {
      if (!this.busy()) this.clicked.set(null);
    });
  }

  protected onComment(e: Event): void {
    this.comment.set((e.target as HTMLTextAreaElement).value);
    if (this.comment().trim()) this.hint.set(false);
  }

  protected act(what: 'close' | 'notFixed'): void {
    this.clicked.set(what);
    if (what === 'close') this.close.emit();
    else this.notFixed.emit();
  }

  protected pick(code: VerdictCode): void {
    const comment = this.comment().trim();
    if (code === 'rejected_binding') {
      if (!comment) {
        this.hint.set(true);
        this.commentOpen.set(true);
        return;
      }
      this.hint.set(false);
      this.clicked.set(code);
      this.rejectBinding.emit(comment);
      this.comment.set('');
      return;
    }
    this.clicked.set(code);
    this.verdict.emit({ code, comment });
    this.comment.set('');
  }
}
