import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { VerdictCode } from '../core/models';
import { DECISION, PM_VERDICTS } from '../core/copy';

/**
 * Режимы панели «Ваше решение»:
 * disabled — черновик ещё печатается (артборд 3);
 * pm-full — пять кнопок PM (4); pm-two — «нужно ваше решение», две кнопки (4б);
 * attach — бизнесу не хватает скрина (4в); retest — «Закрыть: исправлено» / «Не исправлено» (5);
 * retest-wait — те же кнопки недоступны до нового кадра (5а); record — решение уже принято (4а).
 */
export type DecisionMode = 'disabled' | 'pm-full' | 'pm-two' | 'attach' | 'retest' | 'retest-wait' | 'record';

export interface DecisionRecord {
  label: string;
  who: string;
  at: string;
  changeable: boolean;
}

@Component({
  selector: 'rr-decision-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel', '[class.panel--record]': "mode() === 'record'", '[class.panel--glass]': "mode() !== 'record'" },
  template: `
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
        <button type="button" class="btn btn--primary btn--left" (click)="attach.emit()">{{ copy.attachShot }}</button>
        <div class="hint">{{ attachHint() ?? copy.attachFooterHint }}</div>
      }
      @case ('retest') {
        <button type="button" class="btn btn--primary btn--left" [disabled]="busy()" (click)="close.emit()">{{ copy.closeFixed }}</button>
        <button type="button" class="btn btn--secondary btn--left" [disabled]="busy()" (click)="notFixed.emit()">{{ copy.notFixed }}</button>
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
            class="btn btn--left fade"
            [class.btn--primary]="v.primary"
            [class.btn--secondary]="!v.primary"
            [style.opacity]="busy() ? 0.45 : null"
            [disabled]="busy()"
            (click)="pick(v.code)"
          >
            {{ v.label }}
          </button>
        }
        <label class="meta panel__label" [for]="commentId">{{ mode() === 'pm-two' ? copy.commentLabelShort : copy.commentLabel }}</label>
        <textarea
          class="textarea"
          rows="3"
          [id]="commentId"
          [value]="comment()"
          [disabled]="busy()"
          (input)="onComment($event)"
        ></textarea>
        @if (hint()) {
          <div class="meta">{{ copy.commentRequired }}</div>
        }
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px;
      position: sticky;
      top: 104px;
    }
    :host(.panel--glass) {
      background: var(--rr-glass-bg);
      -webkit-backdrop-filter: blur(24px) saturate(140%);
      backdrop-filter: blur(24px) saturate(140%);
      border: 1px solid var(--rr-glass-line);
      box-shadow: var(--rr-glass-shadow);
      border-radius: 16px;
    }
    :host(.panel--record) {
      background: var(--rr-surface-2);
      border: 1px solid var(--rr-line);
      border-radius: 12px;
      gap: 6px;
    }
    .record {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .record__title {
      font-weight: 600;
    }
    .record__change {
      margin-top: 6px;
      align-self: flex-start;
    }
    .hint {
      font-size: 13px;
      line-height: 18px;
      color: var(--rr-muted);
      margin-top: 4px;
    }
    .panel__label {
      margin-top: 8px;
    }
    @media (max-width: 720px) {
      :host(.panel--glass) {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: 12px;
        top: auto;
        z-index: 5;
        padding: 10px;
        gap: 4px;
        max-height: 240px;
        overflow: auto;
      }
      :host(.panel--glass) .btn {
        min-height: 40px;
        padding-top: 0;
        padding-bottom: 0;
      }
      .panel__label,
      .textarea,
      .hint {
        display: none;
      }
    }
  `,
})
export class DecisionPanel {
  readonly mode = input.required<DecisionMode>();
  readonly busy = input(false);
  readonly record = input<DecisionRecord | null>(null);
  readonly attachHint = input<string | null>(null);

  readonly verdict = output<{ code: Exclude<VerdictCode, 'rejected_binding'>; comment: string }>();
  readonly rejectBinding = output<string>();
  readonly attach = output<void>();
  readonly close = output<void>();
  readonly notFixed = output<void>();
  readonly changeDecision = output<void>();

  protected readonly copy = DECISION;
  protected readonly verdicts = PM_VERDICTS;
  protected readonly comment = signal('');
  protected readonly hint = signal(false);
  protected readonly commentId = `rr-comment-${Math.random().toString(36).slice(2, 8)}`;

  protected readonly visibleVerdicts = computed(() =>
    this.mode() === 'pm-two' ? PM_VERDICTS.filter((v) => v.code === 'defect' || v.code === 'change_request') : PM_VERDICTS,
  );

  protected onComment(e: Event): void {
    this.comment.set((e.target as HTMLTextAreaElement).value);
    if (this.comment().trim()) this.hint.set(false);
  }

  protected pick(code: VerdictCode): void {
    const comment = this.comment().trim();
    if (code === 'rejected_binding') {
      if (!comment) {
        this.hint.set(true);
        return;
      }
      this.hint.set(false);
      this.rejectBinding.emit(comment);
      this.comment.set('');
      return;
    }
    this.verdict.emit({ code, comment });
    this.comment.set('');
  }
}
