import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { JournalChip } from '../core/copy';

export type TileTone = 'accent-2' | 'work' | 'wait' | 'ok' | 'muted';

export interface Tile {
  /** Значение фильтра журнала, которое включает тайл. */
  chip: JournalChip;
  label: string;
  count: number;
  sub?: string | null;
  tone: TileTone;
  /** Кнопка внутри тайла («Начать разбор»); показывается при count > 0. */
  cta?: string | null;
}

/**
 * Сводка раунда = фильтры: пять тайлов «Ждут вас · В работе · На ретесте · Закрыто · Все».
 * Клик по тайлу — фильтр (повторный по активному — «Все»); активный поднят и подчёркнут полосой тона.
 * Тайл «Ждут вас» — индиго-объект экрана, его число и кнопка — аква (закон аквы).
 *
 * Раскладка — grid-области: подпись / число + кнопка «Начать разбор» справа от него / подстрока
 * («1 закрыть · 2 новый кадр») отдельной строкой. Кнопка стоит в потоке и ничего не перекрывает;
 * зона клика фильтра растянута на весь тайл через ::after (как .row-link), кнопка поверх неё (.act).
 */
@Component({
  selector: 'rr-round-tiles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tiles', role: 'group' },
  template: `
    @for (t of tiles(); track t.chip; let i = $index) {
      <div class="tile paper paper--lift rise" [class.tile--on]="t.chip === active()" [attr.data-tone]="t.tone" [style.--i]="i">
        <button type="button" class="tile__hit" [attr.aria-pressed]="t.chip === active()" [attr.aria-label]="hitLabel(t)" (click)="pick.emit(t.chip)">
          <span class="eyebrow tile__label">{{ t.label }}</span>
        </button>
        <span class="tile__count num" [class.tile__count--zero]="t.count === 0" aria-hidden="true">{{ t.count }}</span>
        @if (t.sub) {
          <span class="tile__sub" aria-hidden="true">{{ t.sub }}</span>
        }
        @if (t.cta && t.count > 0) {
          <button type="button" class="btn btn--primary btn--sm tile__cta act" (click)="start.emit(t.chip)">{{ t.cta }}</button>
        }
        <span class="tile__marker" aria-hidden="true"></span>
      </div>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: var(--sp-3);
    }
    .tile[data-tone='accent-2'] {
      grid-column: span 2;
      min-height: 140px;
      background: linear-gradient(180deg, var(--rr-accent-2nd), var(--rr-accent) 60%, var(--rr-accent-deep));
    }
    .tile {
      min-height: 112px;
    }
    /* остальные тайлы тише: без тени, только hairline */
    .tile:not([data-tone='accent-2']) {
      box-shadow: none;
      border-color: var(--rr-line);
    }
    .tile:not([data-tone='accent-2']):hover {
      transform: none;
      box-shadow: var(--rr-shadow-1);
    }
    .tile {
      position: relative;
      min-height: 88px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'label label'
        'count cta'
        'sub sub';
      column-gap: var(--sp-3);
      row-gap: 2px;
      align-items: center;
      align-content: start;
      padding: var(--sp-4) var(--sp-5);
      overflow: hidden;
    }
    /* кнопка-фильтр: подпись в потоке, зона клика — весь тайл */
    .tile__hit {
      grid-area: label;
      justify-self: start;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--rr-ink);
      text-align: left;
      cursor: pointer;
      font: inherit;
      min-width: 0;
    }
    .tile__hit::after {
      content: '';
      position: absolute;
      inset: 0;
    }
    .tile__hit:focus-visible {
      outline: none;
    }
    .tile:has(.tile__hit:focus-visible) {
      outline: 2px solid var(--rr-focus);
      outline-offset: -2px;
    }
    .tile__label {
      color: var(--rr-ink-2);
    }
    .tile__count {
      grid-area: count;
      font-family: var(--rr-serif);
      font-size: var(--rr-fs-40);
      line-height: var(--rr-lh-40);
      font-weight: var(--fw-bold);
      letter-spacing: -0.05em;
      transition: color var(--dur) var(--ease);
    }
    /* тайл «Ждут вас» — индиго-объект журнала: белый текст, число аквой, кнопка аквой */
    .tile[data-tone='accent-2'] {
      background: linear-gradient(170deg, var(--rr-accent-2nd), var(--rr-accent) 60%, var(--rr-accent-hover));
      border-color: transparent;
      color: var(--rr-accent-ink);
      box-shadow: var(--rr-shadow-ink), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    }
    .tile[data-tone='accent-2'] .tile__label,
    .tile[data-tone='accent-2'] .tile__sub {
      color: rgba(255, 255, 255, 0.72);
    }
    .tile[data-tone='accent-2'] .tile__hit {
      color: inherit;
    }
    .tile[data-tone='accent-2'] .tile__count {
      font-size: 72px;
      line-height: 68px;
      margin-top: 2px;
    }
    .tile[data-tone='accent-2'] .tile__cta {
      align-self: end;
    }
    .tile[data-tone='accent-2'] .tile__count:not(.tile__count--zero) {
      color: var(--rr-accent-ink);
    }
    .tile[data-tone='accent-2'] .tile__count--zero {
      color: rgba(255, 255, 255, 0.5);
    }
    .tile[data-tone='accent-2'] .tile__cta {
      background: var(--rr-surface);
      color: var(--rr-accent);
      border-color: transparent;
      box-shadow: 0 10px 24px -12px rgba(0, 0, 0, 0.4);
      min-height: 40px;
      padding: 9px var(--sp-5);
    }
    .tile[data-tone='accent-2'] .tile__cta:hover:not(:disabled) {
      background: var(--rr-accent-2);
      color: var(--rr-accent);
    }
    .tile[data-tone='accent-2'] .tile__marker {
      display: none;
    }
    .tile[data-tone='accent-2']:has(.tile__hit:focus-visible) {
      outline-color: var(--rr-accent-2);
    }
    .tile__count--zero {
      color: var(--rr-ink-3);
    }
    .tile__sub {
      grid-area: sub;
      min-width: 0;
      color: var(--rr-ink-3);
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tile__cta {
      grid-area: cta;
      justify-self: end;
      align-self: center;
    }
    /* нижняя полоса тона: у активного растёт слева направо */
    .tile__marker {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 3px;
      background: var(--rr-line-strong);
      transform: scaleX(0);
      transform-origin: left;
      transition: transform var(--dur) var(--rr-ease-out);
    }
    .tile[data-tone='accent-2'] .tile__marker {
      background: var(--rr-accent-2);
    }
    .tile[data-tone='work'] .tile__marker {
      background: var(--rr-work-dot);
    }
    .tile[data-tone='wait'] .tile__marker {
      background: var(--rr-wait-dot);
    }
    .tile[data-tone='ok'] .tile__marker {
      background: var(--rr-ok-dot);
    }
    .tile[data-tone='muted'] .tile__marker {
      background: var(--rr-ink-3);
    }
    .tile--on {
      transform: translateY(-1px);
      box-shadow: var(--rr-shadow-2);
    }
    .tile--on .tile__marker {
      transform: scaleX(1);
    }
    @media (max-width: 1279px) {
      :host {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
    @media (max-width: 900px) {
      :host {
        display: flex;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        padding-bottom: var(--sp-1);
      }
      .tile {
        flex: 0 0 160px;
        scroll-snap-align: start;
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas:
          'label'
          'count'
          'sub'
          'cta';
      }
      .tile__cta {
        justify-self: start;
        margin-top: var(--sp-2);
      }
    }
  `,
})
export class RoundTiles {
  readonly tiles = input.required<Tile[]>();
  readonly active = input<JournalChip | null>(null);
  readonly pick = output<JournalChip>();
  readonly start = output<JournalChip>();

  /** Подпись кнопки-фильтра для читалок: «Ждут вас · 3 · 1 закрыть · 2 новый кадр». */
  protected hitLabel(t: Tile): string {
    return [t.label, String(t.count), t.sub ?? ''].filter(Boolean).join(' · ');
  }
}
