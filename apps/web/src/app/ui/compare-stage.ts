import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { CARD } from '../core/copy';
import type { ScreenshotKind, ShotVariant } from '../core/models';
import { Icon } from './icons';
import { Shot } from './shot';

/** Кадр сцены: что это (Было / Стало / Дифф), подпись таба, мок-вариант и реальный src, если есть. */
export interface StageFrame {
  kind: ScreenshotKind;
  label: string;
  variant: ShotVariant;
  src?: string | null;
}

/**
 * Сцена сравнения на ретесте: один большой кадр + табы-миниатюры Было / Стало / Дифф.
 * По умолчанию показан дифф (иначе «Стало», иначе первый). Рамка диффа — 2px медь (закон меди, п. б),
 * «дышит» один раз при первом показе. Клик по кадру → open(index), страница откроет просмотрщик.
 *
 * TODO(PR7, условно): режим «Сравнить» — слайдер Было/Стало с ручкой [role=slider][data-rr-keys],
 * snap к 50%, доступен при близких пропорциях кадров. См. план редизайна dapper-yawning-kay.md, «Ретест».
 */
@Component({
  selector: 'rr-compare-stage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Shot, Icon],
  template: `
    <div class="stage">
      <!-- класс frame нужен rr-shot: по :host-context(.frame:hover) он показывает лупу -->
      <button
        type="button"
        class="stage__frame frame"
        [class.stage__frame--diff]="frame().kind === 'diff'"
        [class.stage__frame--attn]="frame().kind === 'diff' && !attnDone()"
        [attr.aria-label]="frame().label + ' · ' + zoomOpen"
        (click)="open.emit(current())"
        (animationend)="onAnimEnd($event)"
      >
        @for (f of frames(); track f.kind) {
          @if (f === frame()) {
            <rr-shot class="stage__shot fade-in" [variant]="f.variant" [src]="f.src" [zoom]="true" />
          }
        }
      </button>
      @if (frame().kind === 'diff' && hint()) {
        <div class="stage__hint meta"><rr-icon name="compare" [size]="14" /> {{ hint() }}</div>
      }
      <div class="stage__tabs" role="tablist">
        @for (f of frames(); track f.kind; let i = $index) {
          <button
            type="button"
            class="tab"
            role="tab"
            [attr.aria-selected]="i === current()"
            [class.tab--on]="i === current()"
            [class.tab--diff]="f.kind === 'diff'"
            [disabled]="busy()"
            (click)="selected.set(i)"
          >
            <span class="tab__thumb"><rr-shot [variant]="f.variant" [src]="f.src" /></span>
            <span class="tab__label">{{ f.label }}</span>
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .stage {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
    }
    .stage__frame {
      position: relative;
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      border-radius: var(--rr-r-md);
      cursor: zoom-in;
      text-align: left;
      overflow: hidden;
      color: inherit;
      font: inherit;
    }
    .stage__frame rr-shot {
      aspect-ratio: 16 / 10;
    }
    .stage__shot {
      animation: rr-fade-in var(--dur) var(--ease) 1;
    }
    /* закон меди (б): рамка кадра «Дифф» */
    .stage__frame--diff {
      box-shadow: 0 0 0 2px var(--rr-accent-2-text);
    }
    .stage__frame--attn {
      animation: rr-diff-attn 600ms var(--ease) 2;
    }
    .stage__frame:focus-visible {
      outline: 2px solid var(--rr-focus);
      outline-offset: 2px;
    }
    .stage__hint {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--rr-accent-2-text);
      font-weight: var(--fw-semibold);
    }
    .stage__tabs {
      display: flex;
      flex-wrap: wrap;
      gap: var(--sp-3);
    }
    .tab {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 4px;
      border: 0;
      background: transparent;
      border-radius: var(--rr-r-xs);
      cursor: pointer;
      color: var(--rr-ink-2);
      font: inherit;
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      text-align: left;
    }
    .tab__thumb {
      display: block;
      width: 120px;
      height: 75px;
      border-radius: var(--rr-r-xs);
      overflow: hidden;
      border: 1px solid var(--rr-line);
      background: var(--rr-thumb-bg);
    }
    .tab__thumb rr-shot {
      width: 100%;
      height: 100%;
      aspect-ratio: auto;
      border: 0;
      border-radius: 0;
    }
    .tab--on {
      color: var(--rr-ink);
      font-weight: var(--fw-semibold);
    }
    .tab--on .tab__thumb {
      box-shadow: 0 0 0 2px var(--rr-accent);
    }
    .tab--diff.tab--on .tab__thumb {
      box-shadow: 0 0 0 2px var(--rr-accent-2-text);
    }
    .tab:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .tab:focus-visible {
      outline: 2px solid var(--rr-focus);
      outline-offset: 2px;
    }
    @media (max-width: 900px) {
      .tab__thumb {
        width: 88px;
        height: 55px;
      }
    }
  `,
})
export class CompareStage {
  readonly frames = input.required<StageFrame[]>();
  /** Идёт «Сравниваем кадры…» — табы неактивны. */
  readonly busy = input(false);
  /** Подпись под диффом, напр. CARD.diffHint. */
  readonly hint = input<string | null>(null);

  /** Индекс выбранного кадра в frames — страница откроет просмотрщик. */
  readonly open = output<number>();

  protected readonly zoomOpen = CARD.zoomOpen;
  protected readonly selected = signal<number | null>(null);
  protected readonly attnDone = signal(false);

  /** По умолчанию дифф, иначе «Стало», иначе первый. */
  private readonly defaultIndex = computed(() => {
    const fs = this.frames();
    const diff = fs.findIndex((f) => f.kind === 'diff');
    if (diff >= 0) return diff;
    const retest = fs.findIndex((f) => f.kind === 'retest');
    return retest >= 0 ? retest : 0;
  });
  protected readonly current = computed(() => {
    const i = this.selected();
    return i !== null && i < this.frames().length ? i : this.defaultIndex();
  });
  protected readonly frame = computed(() => this.frames()[this.current()] ?? this.frames()[0]);

  /** Только своё «дыхание»: fade-in кадра тоже всплывает сюда. */
  protected onAnimEnd(e: AnimationEvent): void {
    if (e.animationName === 'rr-diff-attn') this.attnDone.set(true);
  }

  constructor() {
    // новый набор кадров — сбрасываем ручной выбор, дифф снова «дышит»
    effect(() => {
      this.frames();
      this.selected.set(null);
      this.attnDone.set(false);
    });
  }
}
