import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { COMMON, IMPORT } from '../core/copy';
import { Icon, type IconName } from './icons';

/** band — строка 64px, горизонтально; tall — min-height 220; wide — 16:10, вертикально. */
export type DropSize = 'band' | 'tall' | 'wide';

const EDITABLE = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

/**
 * Зона загрузки файла: перетащить, нажать, Ctrl+V. Вся зона — <label> над скрытым input[type=file],
 * поэтому клик в любую точку открывает выбор. С `paste` слушает document: картинка из буфера → file,
 * но не мешает вставке текста в поля. Успешный drop/paste — короткая вспышка рамки (rr-diff-attn).
 */
@Component({
  selector: 'rr-drop-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <label
      class="dz"
      [class.dz--over]="over()"
      [class.dz--busy]="busy()"
      [class.dz--disabled]="disabled()"
      [class.dz--flash]="flash()"
      [attr.data-size]="size()"
      (dragenter)="onDragOver($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="over.set(false)"
      (drop)="onDrop($event)"
      (animationend)="onAnimEnd($event)"
    >
      <input
        #input
        type="file"
        class="visually-hidden"
        [accept]="accept()"
        [disabled]="disabled() || busy()"
        (change)="onPick($event)"
      />
      <span class="dz__icon"><rr-icon [name]="icon()" [size]="22" /></span>
      <span class="dz__text">
        <span class="dz__title">{{ busy() ? uploading : over() ? dropOver : title() }}</span>
        @if (hint()) {
          <span class="dz__hint meta">{{ hint() }}</span>
        }
      </span>
      @if (buttonLabel()) {
        <span class="btn btn--secondary btn--sm dz__btn">{{ buttonLabel() }}</span>
      }
      @if (busy()) {
        <span class="dz__spin" aria-hidden="true"></span>
      }
    </label>
  `,
  styles: `
    :host {
      display: block;
    }
    .dz {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--sp-2);
      width: 100%;
      padding: var(--sp-5);
      text-align: center;
      border: 1px dashed var(--rr-line-strong);
      border-radius: var(--rr-r-lg);
      background: var(--rr-surface-2);
      color: var(--rr-ink);
      cursor: pointer;
      box-sizing: border-box;
      transition:
        border-color 160ms var(--ease),
        background-color 160ms var(--ease),
        transform 160ms var(--rr-ease-out),
        box-shadow 160ms var(--ease);
    }
    [data-size='wide'] {
      aspect-ratio: 16 / 10;
    }
    [data-size='tall'] {
      min-height: 220px;
    }
    [data-size='band'] {
      flex-direction: row;
      justify-content: flex-start;
      min-height: 64px;
      padding: var(--sp-3) var(--sp-4);
      text-align: left;
    }
    .dz:hover {
      border-color: var(--rr-ink-3);
    }
    .dz--over,
    .dz:has(:focus-visible) {
      border-style: solid;
      border-color: var(--rr-accent);
      background: var(--rr-accent-soft);
      transform: scale(1.01);
    }
    .dz:has(:focus-visible) {
      outline: 2px solid var(--rr-focus);
      outline-offset: 2px;
    }
    .dz--busy {
      cursor: progress;
      color: var(--rr-ink-2);
    }
    .dz--disabled {
      cursor: default;
      opacity: 0.6;
    }
    .dz--flash {
      animation: rr-diff-attn 260ms var(--ease) 1;
    }
    .dz__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: var(--rr-r-pill);
      border: 1px solid var(--rr-line);
      background: var(--rr-surface);
      color: var(--rr-ink-2);
      flex: none;
    }
    [data-size='band'] .dz__icon {
      width: 36px;
      height: 36px;
    }
    .dz__text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .dz__title {
      font-weight: var(--fw-medium);
    }
    /* кнопка — только визуальный намёк: клик ловит весь label */
    .dz__btn {
      margin-top: var(--sp-2);
      pointer-events: none;
    }
    [data-size='band'] .dz__btn {
      margin: 0 0 0 auto;
    }
    .dz__spin {
      position: absolute;
      top: var(--sp-4);
      right: var(--sp-4);
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid var(--rr-ink-2);
      border-right-color: transparent;
      animation: rr-spin 0.8s linear infinite;
    }
  `,
})
export class DropZone {
  readonly title = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly accept = input('image/*');
  readonly busy = input(false);
  readonly disabled = input(false);
  readonly size = input<DropSize>('wide');
  /** Слушать Ctrl+V на document (кроме фокуса в полях ввода). */
  readonly paste = input(false);
  readonly icon = input<IconName>('image');
  readonly buttonLabel = input<string | null>(null);

  readonly file = output<File>();

  protected readonly over = signal(false);
  protected readonly flash = signal(false);
  protected readonly dropOver = IMPORT.dropOver;
  protected readonly uploading = COMMON.loading;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const handler = (e: ClipboardEvent) => this.onPaste(e);
    let bound = false;
    const unbind = () => {
      if (!bound) return;
      document.removeEventListener('paste', handler);
      bound = false;
    };
    // подписка живёт, пока paste() === true; снимаем при destroy и при выключении
    effect((onCleanup) => {
      if (!this.paste() || typeof document === 'undefined') return;
      document.addEventListener('paste', handler);
      bound = true;
      onCleanup(unbind);
    });
    destroyRef.onDestroy(unbind);
  }

  protected onAnimEnd(e: AnimationEvent): void {
    if (e.animationName === 'rr-diff-attn') this.flash.set(false);
  }

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    if (!this.disabled() && !this.busy()) this.over.set(true);
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.over.set(false);
    if (this.disabled() || this.busy()) return;
    const f = e.dataTransfer?.files?.[0];
    if (f && this.ok(f)) this.take(f);
  }

  protected onPick(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) this.file.emit(f);
    input.value = '';
  }

  private onPaste(e: ClipboardEvent): void {
    if (this.disabled() || this.busy()) return;
    const t = document.activeElement;
    if (t instanceof Element && t.matches(EDITABLE)) return;
    const f = Array.from(e.clipboardData?.files ?? []).find((x) => this.ok(x));
    if (!f) return;
    e.preventDefault();
    this.take(f);
  }

  private take(f: File): void {
    this.flash.set(true);
    this.file.emit(f);
  }

  /** Подходит ли файл под accept: image/* — по MIME, иначе по списку расширений. */
  private ok(f: File): boolean {
    const accept = this.accept().trim();
    if (!accept || accept === '*/*') return true;
    if (accept === 'image/*') return f.type.startsWith('image/');
    const name = f.name.toLowerCase();
    return accept
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .some((a) => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : f.type === a));
  }
}
