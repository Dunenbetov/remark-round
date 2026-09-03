import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, inject, input, output, signal } from '@angular/core';

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  /** Есть значение → пункт-переключатель (menuitemradio) с галочкой. */
  selected?: boolean;
  separatorBefore?: boolean;
}

export interface MenuHead {
  title: string;
  meta?: string;
}

/**
 * Выпадающее меню: клик снаружи и Esc закрывают (фокус возвращается на кнопку),
 * стрелки / Home / End ходят по пунктам, Tab закрывает. Одна реализация для проекта, раунда и аватара.
 */
@Component({
  selector: 'rr-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'rr-menu',
    '(document:click)': 'onDocClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    <button
      #trigger
      type="button"
      [class]="triggerClass()"
      [attr.aria-label]="label() || null"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
      (keydown.arrowdown)="openAt($event, 'first')"
      (keydown.arrowup)="openAt($event, 'last')"
    >
      <ng-content />
    </button>
    @if (open()) {
      <div class="menu" [class.menu--start]="align() === 'start'" role="menu" (keydown)="onKey($event)">
        @if (head(); as h) {
          <div class="menu__head">
            <div class="menu__title">{{ h.title }}</div>
            @if (h.meta) {
              <div class="meta">{{ h.meta }}</div>
            }
          </div>
        }
        @for (it of items(); track it.id) {
          @if (it.separatorBefore) {
            <div class="menu__sep" role="separator"></div>
          }
          <button
            type="button"
            class="menu__item"
            [class.menu__item--on]="it.selected"
            [attr.role]="it.selected === undefined ? 'menuitem' : 'menuitemradio'"
            [attr.aria-checked]="it.selected === undefined ? null : it.selected"
            tabindex="-1"
            (click)="choose(it.id)"
          >
            <span class="menu__label">{{ it.label }}</span>
            @if (it.hint) {
              <span class="menu__hint meta">{{ it.hint }}</span>
            }
            @if (it.selected) {
              <svg class="menu__check" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 8.5l3 3 7-7" />
              </svg>
            }
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
    }
    .menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      min-width: 240px;
      max-width: min(360px, calc(100vw - 24px));
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      z-index: var(--z-menu);
      background: var(--rr-surface-raised);
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-xl);
      box-shadow: var(--rr-shadow-2);
      animation: rr-menu-in var(--dur-fast) var(--ease);
    }
    .menu--start {
      left: 0;
      right: auto;
    }
    @keyframes rr-menu-in {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    .menu__head {
      padding: 8px 10px 10px;
    }
    .menu__title {
      font-weight: var(--fw-semibold);
    }
    .menu__sep {
      height: 1px;
      margin: 4px 2px;
      background: var(--rr-line);
    }
    .menu__item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 36px;
      padding: 6px 10px;
      border: 0;
      border-radius: var(--rr-r-md);
      background: transparent;
      text-align: left;
      cursor: pointer;
      color: var(--rr-ink);
    }
    .menu__item:hover,
    .menu__item:focus-visible {
      background: var(--rr-surface-2);
      outline: none;
    }
    .menu__item--on {
      font-weight: var(--fw-medium);
    }
    .menu__label {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .menu__hint {
      white-space: nowrap;
    }
    .menu__check {
      color: var(--rr-accent-text);
      flex: none;
    }
  `,
})
export class Menu {
  readonly items = input.required<MenuItem[]>();
  readonly head = input<MenuHead | null>(null);
  readonly label = input<string>('');
  readonly align = input<'start' | 'end'>('end');
  readonly triggerClass = input('');
  readonly pick = output<string>();

  protected readonly open = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected toggle(): void {
    if (this.open()) this.close(false);
    else this.show('first');
  }

  protected openAt(e: Event, where: 'first' | 'last'): void {
    e.preventDefault();
    this.show(where);
  }

  protected choose(id: string): void {
    this.close(true);
    this.pick.emit(id);
  }

  protected onDocClick(e: Event): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.close(false);
  }

  protected onEscape(): void {
    if (this.open()) this.close(true);
  }

  protected onKey(e: KeyboardEvent): void {
    const items = this.itemEls();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        return go(i + 1);
      case 'ArrowUp':
        return go(i - 1);
      case 'Home':
        return go(0);
      case 'End':
        return go(items.length - 1);
      case 'Tab':
        this.close(false);
        return;
    }
  }

  private show(where: 'first' | 'last'): void {
    this.open.set(true);
    afterNextRender(
      () => {
        const items = this.itemEls();
        const selected = items.find((b) => b.getAttribute('aria-checked') === 'true');
        (selected ?? (where === 'first' ? items[0] : items[items.length - 1]))?.focus();
      },
      { injector: this.injector },
    );
  }

  private close(refocus: boolean): void {
    this.open.set(false);
    if (refocus) this.host.nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
  }

  private itemEls(): HTMLButtonElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.menu__item'));
  }
}
