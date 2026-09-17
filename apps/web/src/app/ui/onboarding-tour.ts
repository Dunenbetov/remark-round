import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { COMMON, DECISION, JOURNAL, NAV, PHASE_TEXT, QUEUE, STAMP_LABEL, TOUR, TourStep, VERDICT_LABEL } from '../core/copy';
import { OnboardingService, TourState } from '../core/onboarding.service';
import { Icon } from './icons';
import { ProcessStrip } from './process-strip';
import { RunSteps } from './run-steps';
import { Stamp } from './stamp';

/** Уход диалога — выход 140ms ease-in (принципы движения). */
const LEAVE_MS = 140;
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let nextId = 0;

/**
 * Тур «Как это работает» для бизнеса и PM: пять шагов по схеме пути замечания (rr-process-strip в static-режиме
 * подсвечивает узел шага) + короткий текст + статичная иллюстрация настоящего элемента (кнопки 1–5, дропзона,
 * тайл «Ждут вас», строка очереди). Один на приложение (app.ts), состояние — OnboardingService.
 * Диалог: role="dialog" (глобальные клавиши под ним молчат — shortcuts.service), фокус заперт, Esc закрывает,
 * ←/→ листают. Уход через `leaving` + 140 мс, как undo-бар.
 */
@Component({
  selector: 'rr-onboarding-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ProcessStrip, RunSteps, Stamp],
  template: `
    @if (shown(); as s) {
      <div class="scrim" [class.is-leaving]="leaving()" (click)="onScrim($event)">
        <div #dialog class="tour raised" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" (keydown)="onKey($event)">
          <div class="tour__head">
            <span class="eyebrow">{{ copy.title }} · {{ copy.of(s.step + 1, steps().length) }}</span>
            <button type="button" class="btn btn--ghost btn--sm tour__close" [attr.aria-label]="common.close" (click)="close()">
              <rr-icon name="close" [size]="16" />
            </button>
          </div>

          <rr-process-strip class="tour__strip" mode="static" [current]="step().status" [role]="s.role" />

          <h2 class="tour__title" [id]="titleId">{{ step().title }}</h2>
          <p class="tour__text">{{ step().text }}</p>

          @switch (step().illustration) {
            @case ('add') {
              <div class="illo illo--add">
                <span class="btn btn--primary btn--sm illo__static"><rr-icon name="plus" [size]="14" />{{ nav.addRemark }}</span>
                <span class="meta">{{ copy.or }}</span>
                <span class="illo__drop"><rr-icon name="upload" [size]="16" />{{ copy.illo.journal }}</span>
              </div>
            }
            @case ('steps') {
              <div class="illo illo--steps">
                <rr-run-steps [hasShot]="true" [phase]="'binding'" [text]="phaseBinding" />
              </div>
            }
            @case ('keys') {
              <div class="illo illo--keys">
                <span class="eyebrow">{{ decision.groups.work }}</span>
                <span class="btn btn--primary btn--left illo__static">{{ verdict.defect }}<span class="kbd">1</span></span>
                <span class="eyebrow">{{ decision.groups.notWork }}</span>
                <span class="btn btn--secondary btn--left illo__static">{{ verdict.change_request }}<span class="kbd">2</span></span>
                <span class="btn btn--secondary btn--left illo__static">{{ verdict.unspecified }}<span class="kbd">3</span></span>
                <span class="eyebrow">{{ decision.groups.needData }}</span>
                <span class="btn btn--secondary btn--left illo__static">{{ verdict.cannot_tell }}<span class="kbd">4</span></span>
              </div>
            }
            @case ('queue') {
              <div class="illo illo--row">
                <span class="n-serif illo__n num">5</span>
                <span class="illo__text">
                  <span class="illo__title">{{ copy.illo.queueTitle }}</span>
                  <span class="meta">{{ copy.illo.queueMeta }}</span>
                </span>
                <span class="btn btn--soft btn--sm illo__static">{{ decision.readyForRetest }}</span>
              </div>
            }
            @case ('dropzone') {
              <div class="illo illo--drop">
                <rr-icon name="image" [size]="22" />
                <span class="illo__title">{{ copy.illo.dropzone }}</span>
                <span class="meta">{{ copy.illo.dropzoneHint }}</span>
              </div>
            }
            @case ('stamp') {
              <div class="illo illo--stamp">
                <span class="btn btn--primary btn--left illo__static">{{ decision.closeFixed }}<span class="kbd">1</span></span>
                <span class="btn btn--secondary btn--left illo__static">{{ decision.notFixed }}<span class="kbd">2</span></span>
                <rr-stamp class="illo__stamp" [label]="stampClosed" tone="ok" [animate]="false" />
              </div>
            }
            @case ('tile') {
              <div class="illo illo--tile">
                <span class="tile paper">
                  <span class="eyebrow">{{ tiles.mine }}</span>
                  <span class="tile__count num">4</span>
                  <span class="btn btn--primary btn--sm illo__static">{{ queueStart }}</span>
                </span>
              </div>
            }
          }

          <div class="tour__foot">
            <button type="button" class="btn btn--text" (click)="close()">{{ copy.skip }}</button>
            <span class="dots" aria-hidden="true">
              @for (st of steps(); track $index) {
                <i [class.is-on]="$index === s.step"></i>
              }
            </span>
            @if (s.step > 0) {
              <button type="button" class="btn btn--secondary" (click)="prev()">{{ copy.back }}</button>
            }
            <button #nextBtn type="button" class="btn btn--primary" (click)="next()">{{ last() ? copy.start : copy.next }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .scrim {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--sp-6);
      background: var(--rr-scrim);
      animation: rr-fade-in var(--dur) var(--rr-ease-out) both;
    }
    .scrim.is-leaving {
      animation: rr-tour-out 140ms var(--rr-ease-in) both;
      pointer-events: none;
    }
    @keyframes rr-tour-out {
      to {
        opacity: 0;
      }
    }
    .tour {
      width: min(640px, 100%);
      max-height: calc(100vh - 48px);
      overflow: auto;
      padding: var(--sp-5) var(--sp-7) var(--sp-6);
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
      color: var(--rr-ink);
      animation: rr-menu-in var(--dur) var(--rr-ease-out) both;
    }
    .tour__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-3);
    }
    .tour__close {
      min-height: 32px;
      padding: 0 6px;
      margin-right: calc(-1 * var(--sp-2));
    }
    .tour__strip {
      padding: var(--sp-2) var(--sp-2) 0;
    }
    .tour__title {
      margin: var(--sp-2) 0 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      letter-spacing: -0.01em;
    }
    .tour__text {
      margin: 0;
      font-size: var(--fs-15);
      line-height: var(--lh-15);
      color: var(--rr-ink-2);
      max-width: 60ch;
    }
    .tour__foot {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      margin-top: var(--sp-2);
    }
    .dots {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0 auto;
    }
    .dots i {
      width: 6px;
      height: 6px;
      border-radius: 3px;
      background: var(--rr-line-strong);
      transition:
        width var(--dur) var(--rr-ease-out),
        background-color var(--dur) var(--ease);
    }
    .dots i.is-on {
      width: 18px;
      background: var(--rr-accent);
    }

    /* ---------- иллюстрации: настоящие классы, но без интерактива ---------- */
    .illo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--sp-3);
      padding: var(--sp-4) var(--sp-5);
      background: var(--rr-surface-2);
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-md);
    }
    .illo__static {
      pointer-events: none;
    }
    .illo__drop {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
      padding: 8px 12px;
      border: 1px dashed var(--rr-line-strong);
      border-radius: var(--rr-r-md);
      color: var(--rr-ink-2);
      font-size: var(--fs-13);
      line-height: var(--lh-13);
    }
    .illo--steps {
      display: block;
    }
    .illo--keys {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      max-width: 360px;
    }
    .illo--keys .eyebrow:not(:first-child) {
      margin-top: var(--sp-2);
    }
    .illo--row {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      align-items: center;
      background: var(--rr-surface);
    }
    .illo__n {
      font-size: var(--fs-18);
      color: var(--rr-ink-2);
    }
    .illo__text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .illo__title {
      font-size: var(--fs-15);
      line-height: var(--lh-15);
      font-weight: var(--fw-semibold);
    }
    .illo--drop {
      flex-direction: column;
      gap: 6px;
      padding: var(--sp-6);
      border-style: dashed;
      border-color: var(--rr-line-strong);
      text-align: center;
      color: var(--rr-ink-2);
    }
    .illo--stamp {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      max-width: 360px;
    }
    .illo__stamp {
      align-self: flex-end;
      margin-top: var(--sp-2);
    }
    .illo--tile {
      background: transparent;
      border: 0;
      padding: 0;
    }
    .tile {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'label label'
        'count cta';
      column-gap: var(--sp-3);
      row-gap: 2px;
      align-items: center;
      width: 260px;
      padding: var(--sp-4) var(--sp-5);
      box-shadow: inset 0 -3px 0 var(--rr-accent);
    }
    .tile .eyebrow {
      grid-area: label;
    }
    .tile__count {
      grid-area: count;
      font-size: var(--rr-fs-40);
      line-height: var(--rr-lh-40);
      font-weight: var(--fw-bold);
      letter-spacing: -0.02em;
      color: var(--rr-accent-2-text);
    }
    .tile .btn {
      grid-area: cta;
      justify-self: end;
    }
    @media (max-width: 900px) {
      .scrim {
        padding: var(--sp-3);
        align-items: flex-end;
      }
      .tour {
        padding: var(--sp-4) var(--sp-5) var(--sp-5);
      }
      .tour__foot {
        flex-wrap: wrap;
      }
    }
  `,
})
export class OnboardingTour {
  private readonly onboarding = inject(OnboardingService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly nextBtn = viewChild<ElementRef<HTMLButtonElement>>('nextBtn');

  protected readonly copy = TOUR;
  protected readonly common = COMMON;
  protected readonly nav = NAV;
  protected readonly decision = DECISION;
  protected readonly verdict = VERDICT_LABEL;
  protected readonly tiles = JOURNAL.tiles;
  protected readonly queueStart = QUEUE.start;
  protected readonly stampClosed = STAMP_LABEL.closed;
  protected readonly phaseBinding = PHASE_TEXT.binding;
  protected readonly titleId = `rr-tour-title-${nextId++}`;

  /** Копия состояния живёт на время ухода (140 мс), как в undo-баре. */
  protected readonly shown = signal<TourState | null>(null);
  protected readonly leaving = signal(false);
  protected readonly steps = computed<TourStep[]>(() => {
    const s = this.shown();
    return s ? TOUR[s.role].steps : [];
  });
  protected readonly step = computed<TourStep>(() => this.steps()[this.shown()?.step ?? 0] ?? this.steps()[0]!);
  protected readonly last = computed(() => (this.shown()?.step ?? 0) >= this.steps().length - 1);

  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const s = this.onboarding.state();
      untracked(() => (s ? this.enter(s) : this.leave()));
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.leaveTimer) clearTimeout(this.leaveTimer);
      if (this.focusTimer) clearTimeout(this.focusTimer);
    });
  }

  private enter(s: TourState): void {
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
    this.leaving.set(false);
    const opened = !this.shown();
    this.shown.set(s);
    if (opened) this.focusPrimary();
  }

  private leave(): void {
    if (!this.shown() || this.leaving()) return;
    this.leaving.set(true);
    this.leaveTimer = setTimeout(() => {
      this.shown.set(null);
      this.leaving.set(false);
      this.leaveTimer = null;
    }, LEAVE_MS);
  }

  /** Фокус на «Дальше» после отрисовки диалога. */
  private focusPrimary(): void {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      this.nextBtn()?.nativeElement.focus();
    }, 30);
  }

  protected next(): void {
    const s = this.shown();
    if (!s) return;
    if (s.step >= this.steps().length - 1) this.close();
    else this.onboarding.goTo(s.step + 1);
  }

  protected prev(): void {
    const s = this.shown();
    if (s && s.step > 0) this.onboarding.goTo(s.step - 1);
  }

  protected close(): void {
    this.onboarding.close();
  }

  protected onScrim(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.close();
  }

  /** Esc — закрыть; ←/→ — листать; Tab — по кругу внутри диалога. */
  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.next();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.prev();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = this.dialog()?.nativeElement;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0]!;
    const lastEl = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && active === lastEl) {
      e.preventDefault();
      first.focus();
    }
  }
}
