import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { COMMON, DECISION, DEV_QUEUE, IMPORT, JOURNAL, NAV, PHASE_TEXT, QUEUE, STAMP_LABEL, TOUR, TourStep, pmVerdictGroups } from '../core/copy';
import { OnboardingService } from '../core/onboarding.service';
import { Icon } from './icons';
import { ProcessStrip } from './process-strip';
import { RunSteps } from './run-steps';
import { Stamp } from './stamp';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Тур «Как это работает»: три шага про участок роли (copy.ts → TOUR.roles). Схема пути (rr-process-strip)
 * подсвечивает узел шага; ниже — сцена одной высоты с подписью «На экране» и настоящим элементом без
 * интерактива (кнопки, лента разбора, штамп, строка очереди, тайл), заголовок в одну строку и текст
 * на три строки: высота диалога не зависит от шага. Смена шага пересоздаёт тело (@for по одному шагу)
 * и поднимает его через animate.enter; уход диалога — animate.leave, 140 мс ease-in (принципы движения).
 * Один на приложение (app.ts), состояние — OnboardingService. role="dialog" глушит глобальные клавиши
 * (shortcuts.service), фокус заперт, Esc закрывает, ←/→ листают.
 */
@Component({
  selector: 'rr-onboarding-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ProcessStrip, RunSteps, Stamp],
  template: `
    @if (onboarding.state(); as s) {
      <div class="scrim" animate.leave="scrim--out" (click)="onScrim($event)">
        <div #dialog class="tour raised" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" (keydown)="onKey($event)">
          <div class="tour__head">
            <span class="eyebrow">{{ copy.title }}</span>
            <button type="button" class="btn btn--ghost btn--sm tour__close" [attr.aria-label]="common.close" (click)="close()">
              <rr-icon name="close" [size]="16" />
            </button>
          </div>

          <rr-process-strip class="tour__strip" [current]="step().status" [role]="s.role" />

          @for (st of [step()]; track st.title) {
            <div class="tour__body" animate.enter="rise">
              <div class="stage">
                <span class="eyebrow stage__label">{{ copy.onScreen }}</span>
                <div class="stage__body">
                  @switch (st.illustration) {
                    @case ('add') {
                      <div class="illo illo--row">
                        <span class="btn btn--primary btn--sm"><rr-icon name="plus" [size]="14" />{{ nav.addRemark }}</span>
                        <span class="meta">{{ copy.or }}</span>
                        <span class="illo__drop"><rr-icon name="upload" [size]="16" />{{ importTitle }}</span>
                      </div>
                    }
                    @case ('steps') {
                      <div class="illo illo--steps">
                        <rr-run-steps [hasShot]="true" [phase]="'binding'" [text]="phaseBinding" />
                      </div>
                    }
                    @case ('keys') {
                      <div class="illo illo--keys">
                        @for (g of keyGroups; track g.key) {
                          <div class="keys__group">
                            <span class="eyebrow">{{ g.title }}</span>
                            @for (v of g.verdicts; track v.code) {
                              <span class="btn btn--sm btn--left keys__btn" [class.btn--primary]="v.primary" [class.btn--secondary]="!v.primary">
                                <span class="keys__label">{{ v.label }}</span><span class="kbd">{{ v.key }}</span>
                              </span>
                            }
                          </div>
                        }
                      </div>
                    }
                    @case ('tile') {
                      <div class="tile paper">
                        <span class="eyebrow">{{ tiles.mine }}</span>
                        <span class="tile__count num">4</span>
                        <span class="btn btn--primary btn--sm">{{ queueStart }}</span>
                      </div>
                    }
                    @case ('queue') {
                      <div class="illo illo--queue">
                        <span class="n-serif illo__n num">5</span>
                        <span class="illo__text">
                          <span class="illo__title">{{ copy.illo.queueTitle }}</span>
                          <span class="meta">{{ copy.illo.queueWhere }}</span>
                          <span class="meta">{{ devQueue.expected }} {{ copy.illo.queueExpected }}</span>
                        </span>
                        <span class="btn btn--secondary btn--sm">{{ decision.readyForRetest }}</span>
                      </div>
                    }
                    @case ('ready') {
                      <div class="illo illo--stamp">
                        <rr-stamp [label]="stamp.ready" tone="work" [animate]="false" />
                        <span class="illo__title">{{ devQueue.allDone }}</span>
                      </div>
                    }
                    @case ('check') {
                      <div class="illo illo--check">
                        <span class="btn btn--primary btn--left">{{ decision.closeFixed }}<span class="kbd">1</span></span>
                        <span class="btn btn--secondary btn--left">{{ decision.notFixed }}<span class="kbd">2</span></span>
                        <rr-stamp class="illo__stamp" [label]="stamp.closed" tone="ok" [animate]="false" />
                      </div>
                    }
                    @case ('closed') {
                      <div class="illo illo--stamp">
                        <rr-stamp [label]="stamp.closed" tone="ok" [animate]="false" />
                        <span class="meta">{{ decision.closedWithoutFrame }}</span>
                      </div>
                    }
                  }
                </div>
              </div>

              <div class="tour__copy">
                <h2 class="tour__title" [id]="titleId">{{ st.title }}</h2>
                <p class="tour__text">{{ st.text }}</p>
              </div>
            </div>
          }

          <div class="tour__foot">
            <button type="button" class="btn btn--text" (click)="close()">{{ copy.skip }}</button>
            <span class="dots">
              @for (st of steps(); track st.title) {
                <i [class.is-on]="$index === s.step" aria-hidden="true"></i>
              }
              <span class="visually-hidden">{{ copy.of(s.step + 1, steps().length) }}</span>
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
    .scrim.scrim--out {
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
    .tour__body {
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }

    /* ---------- сцена: одна высота на всех шагах, подпись отделяет демо от текста ---------- */
    .stage {
      position: relative;
      height: 240px;
      display: grid;
      place-items: center;
      padding: var(--sp-7) var(--sp-5) var(--sp-5);
      background: var(--rr-surface-2);
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-md);
      overflow: hidden;
    }
    .stage__label {
      position: absolute;
      top: var(--sp-3);
      left: var(--sp-4);
    }
    .stage__body {
      display: grid;
      place-items: center;
      width: 100%;
      min-width: 0;
      pointer-events: none;
      user-select: none;
    }

    /* заголовок в строку и текст до трёх строк: место под них зарезервировано, высота диалога не зависит от шага */
    .tour__copy {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      min-height: calc(var(--lh-22) + var(--sp-3) + 3 * var(--lh-15));
    }
    .tour__title {
      margin: 0;
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

    /* ---------- иллюстрации: настоящие классы, без интерактива (pointer-events снят на сцене) ---------- */
    .illo {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      max-width: 100%;
    }
    .illo--row {
      flex-wrap: wrap;
      justify-content: center;
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
    /* шире 440px контейнера — лента показывает все четыре подписи (run-steps) */
    .illo--steps {
      display: block;
      width: 100%;
      padding: var(--sp-4) var(--sp-5);
      background: var(--rr-surface);
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-md);
    }
    /* пять кнопок PM тремя колонками — как три группы панели решения, но в высоту сцены */
    .illo--keys {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: start;
      gap: var(--sp-3);
      width: 100%;
    }
    .keys__group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .keys__btn {
      height: auto;
      min-height: 32px;
      padding-top: 6px;
      padding-bottom: 6px;
      white-space: normal;
      text-align: left;
    }
    .keys__label {
      flex: 1 1 auto;
      min-width: 0;
    }
    /* тайл «Ждут вас» — индиго-объект журнала (round-tiles, tone accent-2), в уменьшенном размере */
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
      background: var(--rr-object);
      border-color: transparent;
      color: var(--rr-accent-ink);
      box-shadow: var(--rr-shadow-ink), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    }
    .tile .eyebrow {
      grid-area: label;
      color: rgba(255, 255, 255, 0.82);
    }
    .tile__count {
      grid-area: count;
      font-size: var(--rr-fs-40);
      line-height: var(--rr-lh-40);
      font-weight: var(--fw-bold);
      letter-spacing: -0.02em;
    }
    .tile .btn {
      grid-area: cta;
      justify-self: end;
      background: var(--rr-surface);
      color: var(--rr-accent-text);
      border-color: transparent;
    }
    .illo--queue {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      width: 100%;
      padding: var(--sp-4) var(--sp-5);
      background: var(--rr-surface);
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-md);
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
    .illo--stamp {
      flex-direction: column;
      gap: var(--sp-3);
      text-align: center;
    }
    .illo--check {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      width: min(100%, 360px);
    }
    .illo__stamp {
      align-self: flex-end;
      margin-top: var(--sp-2);
    }

    @media (max-width: 900px) {
      .scrim {
        padding: var(--sp-3);
        align-items: flex-end;
      }
      .tour {
        max-height: calc(100vh - 24px);
        overflow: auto;
        padding: var(--sp-4) var(--sp-5) var(--sp-5);
      }
      .stage {
        height: 220px;
        padding: var(--sp-7) var(--sp-4) var(--sp-4);
        overflow: auto;
      }
      .tour__copy {
        min-height: calc(2 * var(--lh-22) + var(--sp-3) + 5 * var(--lh-15));
      }
      .illo--keys {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--sp-2);
      }
      /* главная кнопка — второй строкой на всю ширину, под большой палец */
      .tour__foot {
        flex-wrap: wrap;
      }
      .tour__foot .btn--primary {
        flex: 1 1 100%;
        order: 2;
      }
    }
  `,
})
export class OnboardingTour {
  protected readonly onboarding = inject(OnboardingService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly nextBtn = viewChild<ElementRef<HTMLButtonElement>>('nextBtn');

  protected readonly copy = TOUR;
  protected readonly common = COMMON;
  protected readonly nav = NAV;
  protected readonly decision = DECISION;
  protected readonly devQueue = DEV_QUEUE;
  protected readonly tiles = JOURNAL.tiles;
  protected readonly queueStart = QUEUE.start;
  protected readonly stamp = STAMP_LABEL;
  protected readonly importTitle = IMPORT.title;
  protected readonly phaseBinding = PHASE_TEXT.binding;
  protected readonly keyGroups = pmVerdictGroups();
  protected readonly titleId = 'rr-tour-title';

  protected readonly steps = computed<readonly TourStep[]>(() => {
    const s = this.onboarding.state();
    return s ? TOUR.roles[s.role] : [];
  });
  protected readonly step = computed<TourStep>(() => this.steps()[this.onboarding.state()?.step ?? 0] ?? this.steps()[0]!);
  protected readonly last = computed(() => (this.onboarding.state()?.step ?? 0) >= this.steps().length - 1);

  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Фокус на «Дальше» после отрисовки диалога — только при открытии, не при смене шага.
    let wasOpen = false;
    effect(() => {
      const open = !!this.onboarding.state();
      if (open && !wasOpen) this.focusPrimary();
      wasOpen = open;
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.focusTimer) clearTimeout(this.focusTimer);
    });
  }

  private focusPrimary(): void {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      this.nextBtn()?.nativeElement.focus();
    }, 30);
  }

  protected next(): void {
    const s = this.onboarding.state();
    if (!s) return;
    if (s.step >= this.steps().length - 1) this.close();
    else this.onboarding.goTo(s.step + 1);
  }

  protected prev(): void {
    const s = this.onboarding.state();
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
