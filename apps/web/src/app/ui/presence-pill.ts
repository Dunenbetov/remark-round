import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { User } from '../core/models';
import { PRESENCE } from '../core/copy';

/** Пилюля присутствия «Смотрит: Айгерим · принимает работу». Появляется за 150 мс. */
@Component({
  selector: 'rr-presence-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'presence glass glass--pill' },
  template: `
    <span class="presence__avatar" aria-hidden="true">{{ user().initial }}</span>
    <span class="presence__text">{{ text() }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 32px;
      padding: 0 12px 0 6px;
      width: max-content;
      animation: presence-in 150ms ease-out;
    }
    .presence__avatar {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: var(--rr-pill-ok-bg);
      color: var(--rr-pill-ok-ink);
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .presence__text {
      font-size: 13px;
      color: var(--rr-ink-soft);
      white-space: nowrap;
    }
    @keyframes presence-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
    }
  `,
})
export class PresencePill {
  readonly user = input.required<User>();
  readonly text = computed(() => PRESENCE.watching(this.user().name, this.user().roleGenitive));
}
