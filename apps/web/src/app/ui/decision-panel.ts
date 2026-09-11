import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { Advice, VerdictCode } from '../core/models';
import { COMMON, DECISION, PM_VERDICTS, PillTone, VERDICT_LABEL } from '../core/copy';
import { ShortcutsService } from '../core/shortcuts.service';
import { Icon } from './icons';
import { Stamp } from './stamp';

/**
 * Режимы панели «Ваше решение»:
 * disabled — черновик ещё готовится; pm-full — пять кнопок PM тремя группами; pm-two — «нужно ваше решение», две кнопки;
 * attach — бизнесу не хватает скрина; retest — «Закрыть: исправлено» / «Не исправлено»;
 * retest-wait — те же кнопки недоступны до нового кадра; record — решение уже принято (штамп);
 * dev-advice — разработчик советует PM теми же пятью вариантами: совет уходит сразу, его можно изменить или снять.
 * В pm-full / pm-two у варианта с советами — бейдж «Developer советует» (стек аватаров); он ничего не выбирает.
 * `pending` поверх любого режима: чернильная карточка отсчёта, 5 секунд можно «Отменить».
 */
export type DecisionMode = 'disabled' | 'pm-full' | 'pm-two' | 'dev-advice' | 'attach' | 'retest' | 'retest-wait' | 'record';

export interface DecisionRecord {
  label: string;
  who: string;
  at: string;
  changeable: boolean;
  /** Подпись штампа (STAMP_LABEL); без неё — обычная строка «Решение: …». */
  stamp?: string;
  tone?: PillTone;
  comment?: string;
  /** Вторая, тихая строка под записью (например, вердикт PM под штампом «Готово» разработчика). */
  sub?: string;
}

export interface DecisionPending {
  label: string;
  /** Пять секунд прошли, запрос уходит: отменить уже нельзя. */
  committing?: boolean;
}

export interface DecisionNext {
  n: number;
  title: string;
}

type Group = { key: 'work' | 'notWork' | 'needData'; title: string; codes: VerdictCode[] };

const GROUPS: Group[] = [
  { key: 'work', title: DECISION.groups.work, codes: ['defect'] },
  { key: 'notWork', title: DECISION.groups.notWork, codes: ['change_request', 'unspecified'] },
  { key: 'needData', title: DECISION.groups.needData, codes: ['cannot_tell', 'rejected_binding'] },
];

const UNDO_SECONDS = 5;

@Component({
  selector: 'rr-decision-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Stamp],
  host: {
    class: 'panel',
    '[class.panel--record]': "mode() === 'record' && !pending()",
    '[class.panel--glass]': "mode() !== 'record' && !pending()",
    '[class.panel--ink]': '!!pending()',
    '[class.ink-card]': '!!pending()',
    '[class.panel--comment-open]': 'commentOpen()',
  },
  template: `
    @if (pending(); as p) {
      <div class="pend">
        <div class="pend__title">{{ copy.record }} {{ p.label }}</div>
        <div class="pend__row">
          <button type="button" class="btn btn--secondary pend__undo" [class.btn--busy]="p.committing" [disabled]="p.committing" (click)="undo.emit()">
            {{ common.undo }}<span class="kbd">Esc</span>
          </button>
          <span class="pend__sec num" aria-hidden="true">{{ seconds() }}</span>
        </div>
        <span class="undo-line" aria-hidden="true"><span class="undo-line__fill"></span></span>
        @if (next(); as nx) {
          <div class="pend__next">
            <button type="button" class="btn btn--secondary btn--left pend__next-btn" [disabled]="p.committing" (click)="goNext.emit()">
              <span class="pend__next-text">{{ copy.next(nx.n, nx.title) }}</span>
              <rr-icon name="arrow-right" [size]="16" />
            </button>
            <span class="pend__next-note">{{ copy.nextNow }}</span>
          </div>
        }
      </div>
    } @else {
      @switch (mode()) {
        @case ('record') {
          <div class="record">
            @if (record(); as r) {
              @if (r.stamp) {
                <rr-stamp [label]="r.stamp" [tone]="r.tone ?? 'ok'" />
              } @else {
                <div class="record__title">{{ copy.record }} {{ r.label }}</div>
              }
              @if (whoAt(r); as w) {
                <div class="meta">{{ w }}</div>
              }
              @if (r.comment) {
                <div class="record__comment">«{{ r.comment }}»</div>
              }
              @if (r.sub) {
                <div class="meta record__sub">{{ r.sub }}</div>
              }
              @if (r.changeable) {
                <button type="button" class="btn btn--text record__change" (click)="changeDecision.emit()">{{ copy.change }}</button>
              }
              @if (reopenLabel(); as rl) {
                <button type="button" class="btn btn--secondary record__change" [disabled]="busy()" (click)="reopen.emit()">{{ rl }}</button>
              }
            }
            @if (next(); as nx) {
              <button type="button" class="btn btn--primary btn--left panel__next" (click)="goNext.emit()">
                <span class="panel__next-text">{{ copy.nextShort(nx.n) }} · {{ nx.title }}</span>
                <rr-icon name="arrow-right" [size]="16" />
              </button>
            } @else if (queueEmpty()) {
              <div class="record__empty">
                <span class="meta">{{ copy.queueEmpty }}</span>
                <button type="button" class="btn btn--text" (click)="toJournal.emit()">{{ copy.toJournal }}</button>
              </div>
            }
          </div>
        }
        @case ('attach') {
          <button type="button" class="btn btn--primary btn--lg btn--left" [class.btn--busy]="busy()" [disabled]="busy()" (click)="attach.emit()">
            {{ copy.attachShot }}<span class="kbd">U</span>
          </button>
          <div class="hint">{{ attachHint() ?? copy.attachFooterHint }}</div>
        }
        @case ('retest') {
          <button type="button" class="btn btn--primary btn--lg btn--left" [class.btn--busy]="busy() && clicked() === 'close'" [class.is-pressed]="pressed() === 'Digit1'" [disabled]="busy()" (click)="act('close')">
            {{ copy.closeFixed }}<span class="kbd">1</span>
          </button>
          <button type="button" class="btn btn--secondary btn--lg btn--left" [class.btn--busy]="busy() && clicked() === 'notFixed'" [class.is-pressed]="pressed() === 'Digit2'" [disabled]="busy()" (click)="act('notFixed')">
            {{ copy.notFixed }}<span class="kbd">2</span>
          </button>
          <div class="hint">{{ copy.onlyBusinessCloses }}</div>
        }
        @case ('retest-wait') {
          <button type="button" class="btn btn--secondary btn--lg btn--left" disabled>{{ copy.closeFixed }}</button>
          <button type="button" class="btn btn--secondary btn--lg btn--left" disabled>{{ copy.notFixed }}</button>
          <div class="hint">{{ copy.waitFrame }}</div>
        }
        @case ('disabled') {
          @for (g of visibleGroups(); track g.key) {
            <div class="group">
              <div class="eyebrow group__title">{{ g.title }}</div>
              @for (v of g.verdicts; track v.code) {
                <button type="button" class="btn btn--lg btn--left" [class.btn--outline-primary]="v.primary" [class.btn--secondary]="!v.primary" disabled>
                  {{ v.label }}<span class="kbd">{{ v.key }}</span>
                </button>
              }
            </div>
          }
          <div class="hint">{{ copy.waitDraft }}</div>
        }
        @default {
          @if (mode() === 'dev-advice' && myAdvice() && !editing()) {
            <!-- совет уже дан: показываем его, можно изменить или снять -->
            <div class="advice-mine">
              <div class="advice-mine__label">{{ copy.yourAdvice(verdictLabel[myAdvice()!.code]) }}</div>
              @if (myAdvice()!.comment) {
                <div class="record__comment">«{{ myAdvice()!.comment }}»</div>
              }
              <div class="advice-mine__actions">
                <button type="button" class="btn btn--text" [disabled]="busy()" (click)="startEditAdvice()">{{ copy.changeAdvice }}</button>
                <button type="button" class="btn btn--text" [disabled]="busy()" (click)="retractAdvice.emit()">{{ copy.retractAdvice }}</button>
              </div>
              <div class="hint">{{ copy.adviseHint }}</div>
            </div>
          } @else {
            @if (mode() === 'dev-advice') {
              <div class="eyebrow advise__eyebrow">{{ copy.adviseEyebrow }}</div>
            }
            @for (g of visibleGroups(); track g.key) {
              <div class="group">
                <div class="eyebrow group__title">{{ g.title }}</div>
                @for (v of g.verdicts; track v.code) {
                  <button
                    type="button"
                    class="btn btn--lg btn--left"
                    [class.btn--primary]="v.primary && mode() !== 'dev-advice'"
                    [class.btn--secondary]="!v.primary || mode() === 'dev-advice'"
                    [class.btn--busy]="busy() && clicked() === v.code"
                    [class.is-pressed]="pressed() === 'Digit' + v.key"
                    [class.is-chosen]="chosen() === v.code || (mode() === 'dev-advice' && myAdvice()?.code === v.code)"
                    [class.is-dim]="chosen() !== null && chosen() !== v.code"
                    [class.has-advice]="!!adviceFor(v.code)"
                    [disabled]="busy() || chosen() !== null"
                    (click)="pick(v.code)"
                  >
                    <span class="btn__label">{{ v.label }}</span>
                    @if (adviceFor(v.code); as list) {
                      <!-- совет разработчиков у варианта: стек аватаров + «Developer советует»; ничего не выбирает -->
                      <span class="btn__advice" [class.btn__advice--pop]="popping()" [attr.title]="adviceTitle(list)">
                        <span class="btn__advice-av" aria-hidden="true">
                          @for (a of list; track a.userId) {
                            <i>{{ initial(a) }}</i>
                          }
                        </span>
                        <span class="btn__advice-text">{{ copy.advises(list.length, list[0].userName ?? '') }}</span>
                      </span>
                    }
                    <span class="kbd">{{ v.key }}</span>
                  </button>
                }
              </div>
            }
            @if (mode() !== 'dev-advice') {
              @for (a of adviceNotes(); track a.userId) {
                <div class="advice-note">
                  <span class="advice-note__who">{{ copy.advises(1, a.userName ?? '') }} «{{ verdictLabel[a.code] }}»{{ a.comment ? ':' : '' }}</span>
                  @if (a.comment) {
                    <span class="advice-note__text">«{{ a.comment }}»</span>
                  }
                </div>
              }
            }
            @if (mode() === 'dev-advice') {
              <div class="hint">{{ copy.adviseHint }}</div>
            }
          }
          @if (!commentOpen()) {
            <button type="button" class="btn btn--text panel__toggle" [attr.aria-expanded]="false" [attr.aria-controls]="commentId" (click)="openComment()">
              <rr-icon name="plus" [size]="14" />
              {{ copy.addComment }}
            </button>
          } @else {
            <label class="meta panel__label" [for]="commentId">{{ commentLabel() }}</label>
            <textarea
              #commentField
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
            <!-- Комментарий не отдельная запись: он уходит вместе с решением PM или советом разработчика -->
            <div class="meta panel__comment-hint">{{ mode() === 'dev-advice' ? copy.commentWithAdvice : copy.commentWithVerdict }}</div>
          }
        }
      }
      @if (keysLine(); as k) {
        <div class="keys meta">{{ k }}</div>
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
      transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
    }
    :host(.panel--glass) {
      background: var(--rr-surface-2);
      border-radius: var(--rr-r-xl);
    }
    .group__title {
      text-transform: none;
      letter-spacing: 0;
      font-size: var(--fs-13);
      font-weight: var(--fw-medium);
      color: var(--rr-ink-3);
    }
    .btn--secondary {
      border-color: transparent;
      box-shadow: 0 1px 2px rgba(20, 26, 51, 0.06);
    }
    .kbd {
      border-radius: 6px;
      background: var(--rr-surface);
      border-bottom-width: 2px;
    }
    .btn--primary .kbd {
      background: rgba(255, 255, 255, 0.18);
      border-color: rgba(255, 255, 255, 0.35);
      color: var(--rr-accent-ink);
    }
    :host(.panel--record) {
      background: var(--rr-surface-2);
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-lg);
      gap: 6px;
    }
    :host(.panel--ink) {
      border: 1px solid transparent;
      border-radius: var(--rr-r-xl);
      box-shadow: var(--rr-shadow-ink), inset 0 1px 0 rgba(255, 255, 255, 0.18);
      animation: rr-ink-in var(--dur) var(--rr-ease-out) both;
    }
    @keyframes rr-ink-in {
      from {
        opacity: 0;
        transform: scale(0.96);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    /* группы кнопок */
    .group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .group + .group {
      margin-top: var(--sp-1);
    }
    .group__title {
      margin: 0 0 2px 2px;
    }
    .btn--left {
      justify-content: space-between;
      text-wrap: balance;
    }
    .btn--left .kbd {
      margin-left: var(--sp-3);
    }
    .btn--left .btn__label {
      flex: 1 1 auto;
      min-width: 0;
      text-align: left;
    }
    /* с советом кнопка — сетка: подпись и kbd в первой строке, бейдж — своей строкой под ними */
    .btn--left.has-advice {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'label kbd'
        'advice advice';
      row-gap: 6px;
      align-items: center;
    }
    .btn--left.has-advice .btn__label {
      grid-area: label;
    }
    .btn--left.has-advice .kbd {
      grid-area: kbd;
      margin-left: var(--sp-3);
    }
    /* бейдж совета разработчика у варианта */
    .btn__advice {
      grid-area: advice;
      justify-self: start;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      padding: 2px 8px 2px 2px;
      border-radius: 999px;
      background: var(--rr-work-bg);
      color: var(--rr-work-ink);
      font-size: var(--fs-12);
      line-height: var(--lh-12);
      font-weight: var(--fw-semibold);
      white-space: nowrap;
    }
    .btn--primary .btn__advice {
      background: rgba(255, 255, 255, 0.18);
      color: var(--rr-accent-ink);
    }
    .btn--primary .btn__advice-av i {
      background: var(--rr-surface);
      color: var(--rr-accent);
      border-color: transparent;
    }
    .btn__advice--pop {
      animation: rr-pop 300ms var(--rr-ease-spring);
    }
    .btn__advice-av {
      display: inline-flex;
    }
    .btn__advice-av i {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--rr-work-dot);
      color: var(--rr-accent-ink);
      font-size: 10px;
      font-style: normal;
      font-weight: 700;
      border: 1.5px solid var(--rr-surface);
    }
    .btn__advice-av i + i {
      margin-left: -6px;
    }
    .btn__advice-text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* комментарий совета под группами — тихая серифная цитата */
    .advice-note {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 6px;
      align-items: baseline;
      padding: 2px 2px 0;
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-2);
    }
    .advice-note__who {
      font-weight: var(--fw-semibold);
    }
    .advice-note__text {
      font-style: italic;
    }
    /* режим dev-advice */
    .advise__eyebrow {
      margin: 0 0 2px 2px;
      color: var(--rr-ink);
    }
    .advice-mine {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: var(--sp-3) var(--sp-3) var(--sp-2);
      border-radius: var(--rr-r-md);
      background: var(--rr-work-bg);
      color: var(--rr-work-ink);
    }
    .advice-mine__label {
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
    }
    .advice-mine__actions {
      display: flex;
      gap: var(--sp-3);
    }
    .advice-mine .btn--text {
      color: var(--rr-work-ink);
      padding-left: 0;
    }
    .advice-mine .hint {
      color: inherit;
      opacity: 0.85;
    }
    .btn.is-chosen {
      position: relative;
      overflow: hidden;
    }
    .btn.is-chosen::before {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.14);
      transform-origin: left;
      animation: rr-fill 220ms var(--rr-ease-out) both;
    }
    @keyframes rr-fill {
      from {
        transform: scaleX(0);
      }
      to {
        transform: scaleX(1);
      }
    }
    .btn.is-dim {
      opacity: 0.35;
      transition: opacity 120ms var(--ease);
    }

    /* комментарий */
    .panel__toggle {
      align-self: flex-start;
      margin-top: var(--sp-1);
      font-weight: var(--fw-regular);
      color: var(--rr-ink-2);
      gap: 4px;
    }
    .panel__label {
      margin-top: var(--sp-2);
    }
    .panel__comment-hint {
      margin-top: calc(var(--sp-1) * -1);
    }
    .panel__required {
      color: var(--rr-danger);
    }

    /* запись решения */
    .record {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-start;
    }
    .record__title {
      font-weight: var(--fw-semibold);
    }
    .record__comment {
      color: var(--rr-ink-2);
      font-style: italic;
    }
    .record__sub {
      color: var(--rr-ink-3);
    }
    .record__change {
      margin-top: 2px;
    }
    .panel__next {
      align-self: stretch;
      margin-top: var(--sp-2);
      justify-content: space-between;
    }
    .panel__next-text {
      text-align: left;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .record__empty {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      margin-top: var(--sp-2);
    }

    /* отсчёт на чернильной карточке */
    .pend {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
    }
    .pend__title {
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
    }
    .pend__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-3);
    }
    .pend__undo {
      min-height: 40px;
      gap: var(--sp-3);
    }
    .pend__sec {
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      color: var(--rr-accent-2);
      min-width: 1.2em;
      text-align: right;
    }
    .undo-line {
      display: block;
      height: 3px;
      border-radius: var(--rr-r-pill);
      background: color-mix(in srgb, var(--rr-ink-surface-text) 18%, transparent);
      overflow: hidden;
    }
    .undo-line__fill {
      display: block;
      height: 100%;
      width: 100%;
      background: var(--rr-accent-2);
      transform-origin: left;
      animation: rr-undo var(--undo-ms) linear forwards;
    }
    .pend__next {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: var(--sp-1);
    }
    .pend__next-btn {
      justify-content: space-between;
    }
    .pend__next-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pend__next-note {
      font-size: var(--fs-12);
      line-height: var(--lh-12);
      opacity: 0.7;
      padding-left: 2px;
    }

    .hint {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-3);
      margin-top: var(--sp-1);
    }
    .keys {
      color: var(--rr-ink-3);
      margin-top: var(--sp-1);
      padding-top: var(--sp-2);
      border-top: 1px solid var(--rr-line);
    }
    @media (max-width: 900px) {
      :host {
        position: static;
        padding: var(--sp-3);
        gap: 6px;
      }
      .keys {
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
  /** Смена карточки без пересоздания панели: сбрасываем комментарий, выбор и отсчёт. */
  readonly remarkId = input<string | null>(null);
  readonly next = input<DecisionNext | null>(null);
  readonly queueEmpty = input(false);
  /** Строка подсказки клавиш; null — по режиму (DECISION.keysHint). */
  readonly keysHint = input<string | null | undefined>(undefined);
  /** Советы разработчиков по замечанию (RemarkView.advice) — бейджи у вариантов PM и «Ваш совет» в dev-advice. */
  readonly advice = input<Advice[]>([]);
  readonly myUserId = input<string | null>(null);
  /** Меняется при событии remark.advice — бейдж делает pop. */
  readonly adviceTick = input(0);
  /** Заказчик на закрытом замечании: «Открыть снова в раунде N» (null — не показывать). */
  readonly reopenLabel = input<string | null>(null);
  readonly reopen = output<void>();

  readonly verdict = output<{ code: Exclude<VerdictCode, 'rejected_binding'>; comment: string }>();
  readonly rejectBinding = output<string>();
  readonly attach = output<void>();
  readonly close = output<void>();
  readonly notFixed = output<void>();
  readonly changeDecision = output<void>();
  readonly undo = output<void>();
  readonly goNext = output<void>();
  readonly toJournal = output<void>();
  readonly advise = output<{ code: VerdictCode; comment: string }>();
  readonly retractAdvice = output<void>();

  protected readonly copy = DECISION;
  protected readonly common = COMMON;
  protected readonly verdictLabel = VERDICT_LABEL;
  /** dev-advice: «Изменить» открывает кнопки поверх уже данного совета. */
  protected readonly editing = signal(false);
  protected readonly popping = signal(false);
  protected readonly myAdvice = computed<Advice | null>(() => this.advice().find((a) => a.userId === this.myUserId()) ?? null);
  private readonly adviceByCode = computed(() => {
    const map = new Map<VerdictCode, Advice[]>();
    for (const a of this.advice()) map.set(a.code, [...(map.get(a.code) ?? []), a]);
    return map;
  });
  /** Строки под группами: советы с комментарием и советы за вариант, у которого сейчас нет кнопки (pm-two). */
  protected readonly adviceNotes = computed(() => {
    const visible = new Set(this.visibleGroups().flatMap((g) => g.verdicts.map((v) => v.code)));
    return this.advice().filter((a) => a.comment || !visible.has(a.code));
  });
  protected readonly comment = signal('');
  protected readonly hint = signal(false);
  protected readonly commentOpen = signal(false);
  protected readonly clicked = signal<string | null>(null);
  protected readonly chosen = signal<VerdictCode | null>(null);
  protected readonly seconds = signal(UNDO_SECONDS);
  protected readonly commentId = `rr-comment-${Math.random().toString(36).slice(2, 8)}`;

  private readonly shortcuts = inject(ShortcutsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly pressed = this.shortcuts.pressed;
  private timer: ReturnType<typeof setInterval> | null = null;
  private popTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly visibleGroups = computed(() => {
    const two = this.mode() === 'pm-two';
    return GROUPS.map((g) => ({
      ...g,
      verdicts: g.codes
        .filter((code) => !two || code === 'defect' || code === 'change_request')
        .map((code) => {
          const v = PM_VERDICTS.find((x) => x.code === code)!;
          return { ...v, key: PM_VERDICTS.indexOf(v) + 1 };
        }),
    })).filter((g) => g.verdicts.length);
  });
  protected readonly commentLabel = computed(() => (this.mode() === 'pm-two' ? DECISION.commentLabelShort : DECISION.commentLabel));
  protected readonly keysLine = computed(() => {
    const override = this.keysHint();
    if (override !== undefined) return override;
    const mode = this.mode();
    if (mode === 'disabled') return null;
    if (mode === 'record' && !this.next()) return null;
    return DECISION.keysHint[mode];
  });

  constructor() {
    effect(() => {
      this.remarkId();
      untracked(() => this.restoreDraft());
    });
    effect(() => {
      if (!this.busy()) this.clicked.set(null);
    });
    // Отсчёт 5…1 рядом с полоской: живёт только пока pending; смена карточки его гасит.
    effect((onCleanup) => {
      const p = this.pending();
      this.remarkId();
      untracked(() => this.stopTimer());
      if (!p) return;
      untracked(() => {
        this.seconds.set(UNDO_SECONDS);
        this.timer = setInterval(() => this.seconds.update((s) => Math.max(1, s - 1)), 1000);
      });
      onCleanup(() => this.stopTimer());
    });
    // Новая карточка в той же панели: чужой комментарий и выбор не переезжают.
    effect(() => {
      this.remarkId();
      untracked(() => {
        this.comment.set('');
        this.hint.set(false);
        this.commentOpen.set(false);
        this.chosen.set(null);
        this.clicked.set(null);
        this.editing.set(false);
      });
    });
    // Совет записан / изменён — режим «Изменить» закрывается; пришёл по WS — бейдж делает pop.
    effect(() => {
      this.advice();
      untracked(() => this.editing.set(false));
    });
    effect(() => {
      if (!this.adviceTick()) return;
      untracked(() => {
        if (this.popTimer) clearTimeout(this.popTimer);
        this.popping.set(true);
        this.popTimer = setTimeout(() => this.popping.set(false), 400);
      });
    });
    // Отсчёт снят («Отменить» или запись) — кнопки снова доступны; после записи фокус на «Следующее».
    effect(() => {
      const p = this.pending();
      const mode = this.mode();
      untracked(() => {
        if (p) return;
        this.chosen.set(null);
        if (mode === 'record' && this.next()) {
          afterNextRender(() => this.host.nativeElement.querySelector<HTMLButtonElement>('.panel__next')?.focus({ preventScroll: true }), { injector: this.injector });
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.stopTimer();
      if (this.popTimer) clearTimeout(this.popTimer);
    });
  }

  protected adviceFor(code: VerdictCode): Advice[] | null {
    if (this.mode() === 'dev-advice') return null;
    const list = this.adviceByCode().get(code);
    return list?.length ? list : null;
  }

  protected adviceTitle(list: Advice[]): string {
    return list.map((a) => [a.userName, a.comment ? `«${a.comment}»` : ''].filter(Boolean).join(': ')).join('; ');
  }

  protected initial(a: Advice): string {
    return (a.userName ?? '?').charAt(0).toUpperCase();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Открыть комментарий и поставить фокус (клавиша C или «Добавить комментарий»). Комментарий уходит только
   * вместе с решением или советом, поэтому у разработчика с уже данным советом заодно возвращаются варианты:
   * иначе поле открывается, а отправить его нечем.
   */
  openComment(): void {
    if (this.mode() !== 'pm-full' && this.mode() !== 'pm-two' && this.mode() !== 'dev-advice') return;
    if (this.mode() === 'dev-advice' && this.myAdvice() && !this.editing()) this.startEditAdvice();
    this.commentOpen.set(true);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLTextAreaElement>('.panel__comment')?.focus(), { injector: this.injector });
  }

  /** «Изменить» у своего совета: варианты снова доступны, а уже написанный комментарий не теряется. */
  protected startEditAdvice(): void {
    const mine = this.myAdvice();
    if (mine?.comment && !this.comment().trim()) {
      this.comment.set(mine.comment);
      this.commentOpen.set(true);
    }
    this.editing.set(true);
  }

  /** Вердикт по номеру клавиши 1–5 (порядок канона); в pm-two — только 1–2. */
  pickByKey(n: number): void {
    const v = PM_VERDICTS[n - 1];
    if (!v) return;
    const allowed = this.visibleGroups().some((g) => g.verdicts.some((x) => x.code === v.code));
    if (!allowed || this.busy() || this.chosen() !== null) return;
    this.pick(v.code);
  }

  protected whoAt(r: DecisionRecord): string {
    return [r.who, r.at].filter(Boolean).join(' · ');
  }

  protected onComment(e: Event): void {
    this.comment.set((e.target as HTMLTextAreaElement).value);
    if (this.comment().trim()) this.hint.set(false);
    this.saveDraft();
  }

  /**
   * Черновик комментария живёт в sessionStorage по id замечания (аудит: session-expiry-loses-work): истёкшая сессия
   * или случайный переход не теряют то, что человек уже написал; отправка решения черновик снимает.
   */
  private draftKey(): string | null {
    const id = this.remarkId();
    return id ? `rr.draft.comment:${id}` : null;
  }

  private saveDraft(): void {
    const key = this.draftKey();
    if (!key) return;
    try {
      if (this.comment().trim()) sessionStorage.setItem(key, this.comment());
      else sessionStorage.removeItem(key);
    } catch {
      /* приватный режим */
    }
  }

  private restoreDraft(): void {
    const key = this.draftKey();
    if (!key) return;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved && !this.comment()) {
        this.comment.set(saved);
        this.commentOpen.set(true);
      }
    } catch {
      /* приватный режим */
    }
  }

  private clearDraft(): void {
    this.comment.set('');
    const key = this.draftKey();
    if (!key) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* приватный режим */
    }
  }

  protected act(what: 'close' | 'notFixed'): void {
    this.clicked.set(what);
    if (what === 'close') this.close.emit();
    else this.notFixed.emit();
  }

  protected pick(code: VerdictCode): void {
    const comment = this.comment().trim();
    if (this.mode() === 'dev-advice') {
      // Совет — не решение: уходит сразу, без отсчёта; кнопки не гаснут — совет можно тут же изменить.
      // Смена варианта с закрытым полем не стирает уже написанный комментарий: чтобы убрать его, поле открывают и чистят.
      const keep = !comment && !this.commentOpen() ? (this.myAdvice()?.comment ?? '') : comment;
      this.clicked.set(code);
      this.advise.emit({ code, comment: keep });
      this.clearDraft();
      this.commentOpen.set(false);
      return;
    }
    if (code === 'rejected_binding') {
      if (!comment) {
        this.hint.set(true);
        this.openComment();
        return;
      }
      this.hint.set(false);
      this.clicked.set(code);
      this.rejectBinding.emit(comment);
      this.clearDraft();
      return;
    }
    // Нажатая кнопка отмечается, остальные гаснут; родитель тут же переводит панель в отсчёт.
    this.chosen.set(code);
    this.clicked.set(code);
    this.verdict.emit({ code, comment });
    this.clearDraft();
  }
}
