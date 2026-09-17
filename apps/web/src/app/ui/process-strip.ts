import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RemarkStatus, Role } from '../core/models';
import { PROCESS } from '../core/copy';

type StripMode = 'loop' | 'static';

/** Узел схемы по статусу замечания (docs/STATUS.md): 0 Замечание · 1 Разбор · 2 Решение · 3 В работе · 4 Проверка · 5 Закрыто. */
const NODE_BY_STATUS: Record<RemarkStatus, number> = {
  imported: 0,
  needs_human_parse: 0,
  cannot_tell: 0,
  reopened: 0,
  triaging: 1,
  awaiting_pm: 2,
  unspecified: 2,
  change_request: 2,
  duplicate: 2,
  defect: 3,
  ready_for_retest: 4,
  awaiting_business_close: 4,
  closed: 5,
};

/** Узлы, где действует роль — полоса «здесь вы». */
const NODES_BY_ROLE: Partial<Record<Role, readonly number[]>> = { business: [0, 4, 5], pm: [2], developer: [3] };

interface Node {
  index: number;
  label: string;
  you: boolean;
  now: boolean;
}

/**
 * Схема пути замечания в шесть узлов. Вся подсветка считается от одного числа --rr-p (зарегистрированное
 * свойство, styles/motion.css): в режиме loop его крутит анимация rr-strip-progress (токен «№» едет от узла
 * к узлу, пройденные остаются залитыми, подпись под схемой меняется), в режиме static оно равно узлу
 * текущего статуса — «где сейчас это замечание». Hover/фокус ставят цикл на паузу; reduced-motion —
 * статичный кадр, где все узлы пройдены.
 */
@Component({
  selector: 'rr-process-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'strip',
    '[class.strip--loop]': "mode() === 'loop'",
    '[class.strip--static]': "mode() === 'static'",
    '[class.strip--compact]': 'compact()',
    '[style.--rr-p]': "mode() === 'static' ? currentNode() : null",
  },
  template: `
    <ol class="nodes" [attr.aria-label]="copy.title">
      @for (n of nodes(); track n.index; let last = $last) {
        <li class="node" [class.node--you]="n.you" [class.node--now]="n.now" [style.--k]="n.index" [attr.aria-current]="n.now ? 'step' : null">
          @if (!last) {
            <span class="node__line" aria-hidden="true"><span class="node__fill"></span></span>
          }
          <span class="node__dot" aria-hidden="true"><span class="node__core"></span></span>
          <span class="node__label">{{ n.label }}</span>
          @if (n.you) {
            <span class="node__you" aria-hidden="true"></span>
            <span class="visually-hidden">{{ copy.you }}</span>
          }
          @if (n.now) {
            <span class="visually-hidden">{{ copy.now }}</span>
          }
        </li>
      }
    </ol>
    @if (mode() === 'loop') {
      <span class="token n-serif" aria-hidden="true">№</span>
      <div class="captions" aria-hidden="true">
        @for (c of copy.captions; track $index) {
          <span class="caption" [style.--k]="$index">{{ c }}</span>
        }
      </div>
    }
  `,
  styles: `
    :host {
      --strip-dot: 20px;
      --strip-n: 6;
      position: relative;
      display: block;
      padding: var(--sp-2) 0 0;
    }
    :host(.strip--loop) {
      animation: rr-strip-progress var(--rr-strip-cycle) var(--rr-ease-in-out) infinite forwards;
    }
    :host(.strip--loop:hover),
    :host(.strip--loop:focus-within) {
      animation-play-state: paused;
    }
    .nodes {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      align-items: flex-start;
    }
    .node {
      position: relative;
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding-bottom: 8px;
      /* 0 — не дошли, 1 — пройден; плавный подъём за полшага до прихода токена */
      --lit: clamp(0, calc(var(--rr-p, 0) - var(--k) + 1), 1);
    }
    /* связка к следующему узлу: серая линия и заливка, растущая вместе с --rr-p */
    .node__line {
      position: absolute;
      top: calc(var(--strip-dot) / 2 - 1px);
      left: 50%;
      width: 100%;
      height: 2px;
      background: var(--rr-line);
      border-radius: 1px;
      overflow: hidden;
    }
    .node__fill {
      display: block;
      height: 100%;
      background: var(--rr-accent);
      transform-origin: left;
      transform: scaleX(clamp(0, calc(var(--rr-p, 0) - var(--k)), 1));
    }
    .node__dot {
      position: relative;
      z-index: 1;
      width: var(--strip-dot);
      height: var(--strip-dot);
      border-radius: 50%;
      border: 1.5px solid var(--rr-line-strong);
      background: var(--rr-surface);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    .node__core {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: var(--rr-accent);
      opacity: var(--lit);
    }
    .node__label {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      color: color-mix(in srgb, var(--rr-ink) calc(var(--lit) * 100%), var(--rr-ink-3));
    }
    .node--now .node__label {
      font-weight: var(--fw-semibold);
    }
    /* текущий статус в static-режиме — кольцо вокруг узла */
    :host(.strip--static) .node--now .node__dot {
      border-color: var(--rr-accent);
      box-shadow: 0 0 0 4px var(--rr-accent-soft);
    }
    /* полоса под узлами, где действует эта роль */
    .node__you {
      position: absolute;
      bottom: 0;
      left: 50%;
      width: 28px;
      height: 3px;
      margin-left: -14px;
      border-radius: 2px;
      background: var(--rr-accent);
    }
    /* токен «№» едет по центрам узлов */
    .token {
      position: absolute;
      top: calc(var(--sp-2) + var(--strip-dot) / 2);
      left: calc((var(--rr-p, 0) + 0.5) * 100% / var(--strip-n));
      transform: translate(-50%, -50%);
      z-index: 2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--rr-surface-raised);
      color: var(--rr-accent-text);
      border: 1px solid var(--rr-line-strong);
      box-shadow: var(--rr-shadow-2);
      font-size: var(--fs-13);
      font-weight: 600;
      line-height: 1;
    }
    /* подписи-этапы: видна та, у которой токен (±полшага — crossfade) */
    .captions {
      position: relative;
      height: var(--lh-14);
      margin-top: var(--sp-1);
      text-align: center;
    }
    .caption {
      position: absolute;
      left: 0;
      right: 0;
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      color: var(--rr-ink-2);
      opacity: clamp(0, calc(1 - abs(var(--rr-p, 0) - var(--k)) * 2), 1);
    }
    /* компактный вариант — в шапке карточки: «где сейчас это замечание» */
    :host(.strip--compact) {
      --strip-dot: 8px;
      padding-top: 0;
    }
    :host(.strip--compact) .nodes {
      gap: var(--sp-5);
      align-items: center;
    }
    :host(.strip--compact) .node {
      flex: 0 0 auto;
      flex-direction: row;
      align-items: center;
      gap: 8px;
      padding-bottom: 0;
    }
    :host(.strip--compact) .node__line,
    :host(.strip--compact) .node__you {
      display: none;
    }
    :host(.strip--compact) .node__dot {
      border-width: 1.5px;
    }
    :host(.strip--compact) .node__label {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      letter-spacing: 0;
    }
    :host(.strip--compact.strip--static) .node--now .node__dot {
      border-color: var(--rr-accent);
      box-shadow: 0 0 0 3px var(--rr-accent-2-soft);
    }
    :host(.strip--compact.strip--static) .node--now .node__core {
      background: var(--rr-accent-2-text);
      opacity: 1;
    }
    :host(.strip--compact) .node--now .node__label {
      color: var(--rr-accent-text);
    }
    @media (prefers-reduced-motion: reduce) {
      /* цикл гасится глобально; токен прячем — остаётся схема с пройденными узлами */
      .token {
        display: none;
      }
    }
    @media (max-width: 900px) {
      /* шесть подписей в 330px не помещаются: в цикле этап называет подпись под схемой, в static — только текущий узел */
      .node__label {
        font-size: var(--fs-12);
        line-height: var(--lh-12);
      }
      :host(.strip--loop) .node__label,
      :host(.strip--static) .node:not(.node--now) .node__label {
        display: none;
      }
      .caption {
        font-size: var(--fs-13);
      }
    }
  `,
})
export class ProcessStrip {
  readonly mode = input<StripMode>('static');
  /** Статус замечания для static-режима; null — ничего не подсвечено. */
  readonly current = input<RemarkStatus | null>(null);
  /** Роль — подчёркиваем узлы, где действует человек. */
  readonly role = input<Role | null>(null);
  readonly compact = input(false);

  protected readonly copy = PROCESS;

  protected readonly currentNode = computed(() => {
    const s = this.current();
    return s ? NODE_BY_STATUS[s] : -1;
  });

  protected readonly nodes = computed<Node[]>(() => {
    const you = new Set(this.role() ? (NODES_BY_ROLE[this.role()!] ?? []) : []);
    const now = this.mode() === 'static' ? this.currentNode() : -1;
    return this.copy.nodes.map((label, index) => ({ index, label, you: you.has(index), now: index === now }));
  });
}
