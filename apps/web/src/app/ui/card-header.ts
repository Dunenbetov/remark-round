import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import type { Presence, RemarkStatus } from '../core/models';
import { PRESENCE, PillTone, ROLE_GENITIVE } from '../core/copy';
import { StatusPill } from './status-pill';
import { Stamp } from './stamp';

export interface HeaderStamp {
  label: string;
  tone: PillTone;
}

type ShownPresence = Presence & { leaving?: boolean };

/**
 * Шапка карточки: серифный «№», заголовок, пилюля статуса, штамп решения справа;
 * под ними — мета и «Смотрит: …» (присутствие приходит с rr-rise, уходит за 140 мс).
 */
@Component({
  selector: 'rr-card-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusPill, Stamp],
  template: `
    <header class="ch">
      <div class="ch__row">
        <span class="n-display ch__n" style="view-transition-name: remark-n">№ {{ number() }}</span>
        <h1 class="ch__title">{{ title() }}</h1>
        @if (status()) {
          <rr-status-pill class="ch__pill" [status]="status()!" [dot]="true" />
        }
        @if (stamp(); as s) {
          <rr-stamp class="ch__stamp" [label]="s.label" [tone]="s.tone" />
        }
      </div>
      <div class="ch__sub">
        @if (meta()) {
          <span class="meta">{{ meta() }}</span>
        }
        @for (p of shown(); track p.userId) {
          <span class="ch__who meta" [class.ch__who--leaving]="p.leaving" aria-live="polite">
            <span class="ch__ava" [attr.data-role]="p.role">{{ p.name.charAt(0) }}</span>
            {{ watching(p.name, roleGenitive[p.role]) }}
          </span>
        }
      </div>
    </header>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--sp-5);
    }
    .ch__row {
      display: flex;
      align-items: baseline;
      gap: var(--sp-3);
      flex-wrap: wrap;
    }
    .ch__n {
      color: var(--rr-ink-2);
    }
    .ch__title {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: 600;
      letter-spacing: -0.01em;
      min-width: 0;
    }
    .ch__pill {
      align-self: center;
    }
    /* пилюля статуса в шапке — размер md */
    ::ng-deep .ch__pill .pill {
      height: 28px;
      padding: 0 12px;
    }
    .ch__stamp {
      margin-left: auto;
      align-self: center;
    }
    .ch__sub {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      flex-wrap: wrap;
      margin-top: 6px;
    }
    .ch__who {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 8px 2px 2px;
      border-radius: 999px;
      background: var(--rr-surface-2);
      animation: rr-rise var(--dur) var(--rr-ease-out) both;
      transition:
        opacity 140ms var(--rr-ease-in),
        transform 140ms var(--rr-ease-in);
    }
    .ch__who--leaving {
      opacity: 0;
      transform: translateX(8px);
    }
    .ch__ava {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      color: var(--rr-accent-ink);
      background: var(--rr-accent);
    }
    /* закон меди (е): единственная заливка с текстом — аватар роли business */
    .ch__ava[data-role='business'] {
      background: var(--rr-accent-2);
    }
    :host-context([data-theme='dark']) .ch__ava[data-role='business'] {
      color: var(--rr-ink-inverse);
    }
    .ch__ava[data-role='developer'] {
      background: var(--rr-work-dot);
    }
    @media (max-width: 900px) {
      .ch__n,
      .ch__title {
        font-size: var(--fs-18);
        line-height: var(--lh-18);
      }
      .ch__n {
        font-size: 28px;
        line-height: 32px;
      }
    }
  `,
})
export class CardHeader {
  readonly number = input.required<number>();
  readonly title = input.required<string>();
  /** null → пилюлю не рендерить. */
  readonly status = input<RemarkStatus | null>(null);
  readonly meta = input<string>('');
  readonly presence = input<Presence[]>([]);
  readonly stamp = input<HeaderStamp | null>(null);

  protected readonly watching = PRESENCE.watching;
  protected readonly roleGenitive = ROLE_GENITIVE;

  /** Присутствие с уходом: исчезнувшие помечаются leaving и удаляются через 140 мс. */
  protected readonly shown = signal<ShownPresence[]>([]);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    effect(() => {
      const next = this.presence();
      untracked(() => this.sync(next));
    });
    inject(DestroyRef).onDestroy(() => {
      for (const t of this.timers.values()) clearTimeout(t);
      this.timers.clear();
    });
  }

  private sync(next: Presence[]): void {
    const list: ShownPresence[] = [];
    // текущие: кто остался — обновить, кто ушёл — пометить leaving
    for (const p of this.shown()) {
      const fresh = next.find((n) => n.userId === p.userId);
      if (fresh) {
        const t = this.timers.get(p.userId);
        if (t) {
          clearTimeout(t);
          this.timers.delete(p.userId);
        }
        list.push({ ...fresh });
      } else {
        if (!p.leaving) this.scheduleRemove(p.userId);
        list.push({ ...p, leaving: true });
      }
    }
    // новые — в конец, появятся с rr-rise
    for (const n of next) {
      if (!list.some((p) => p.userId === n.userId)) list.push({ ...n });
    }
    this.shown.set(list);
  }

  private scheduleRemove(userId: string): void {
    this.timers.set(
      userId,
      setTimeout(() => {
        this.timers.delete(userId);
        this.shown.update((list) => list.filter((p) => p.userId !== userId));
      }, 140),
    );
  }
}
