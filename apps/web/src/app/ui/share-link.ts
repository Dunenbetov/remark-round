import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { SHARE } from '../core/copy';
import { Icon } from './icons';

/**
 * Ссылка, которую человек отправляет сам (ADR 013 «без почты»): приглашение /join, смена пароля /reset.
 * Поле только для чтения (выделяется целиком), «Скопировать» с откатом на выделение, Telegram и WhatsApp —
 * обычными ссылками в новой вкладке, «Поделиться…» — только там, где есть navigator.share (телефоны).
 * Токен сервер отдаёт один раз, поэтому ссылка всегда видна текстом: буфер обмена может быть недоступен.
 */
@Component({
  selector: 'rr-share-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="sl">
      <input #field class="input sl__url" type="text" readonly [value]="url()" [attr.aria-label]="copy.urlLabel" (focus)="selectAll()" (click)="selectAll()" />
      <div class="sl__actions">
        <button type="button" class="btn btn--secondary btn--sm" (click)="copyUrl()">
          <rr-icon [name]="copied() ? 'check' : 'copy'" [size]="16" />
          {{ copied() ? copy.copied : copy.copy }}
        </button>
        <a class="btn btn--secondary btn--sm" [href]="telegramHref()" target="_blank" rel="noopener noreferrer" [attr.aria-label]="copy.telegramAria + ' ' + copy.newTab">
          <rr-icon name="send" [size]="16" />
          {{ copy.telegram }}
        </a>
        <a class="btn btn--secondary btn--sm" [href]="whatsappHref()" target="_blank" rel="noopener noreferrer" [attr.aria-label]="copy.whatsappAria + ' ' + copy.newTab">
          <rr-icon name="message" [size]="16" />
          {{ copy.whatsapp }}
        </a>
        @if (canShare) {
          <button type="button" class="btn btn--secondary btn--sm" [attr.aria-label]="copy.shareAria" (click)="share()">
            <rr-icon name="share" [size]="16" />
            {{ copy.share }}
          </button>
        }
      </div>
      @if (note() || failed()) {
        <p class="meta sl__note">{{ failed() ? copy.copyFailed : note() }}</p>
      }
      <span class="visually-hidden" role="status">{{ copied() ? copy.copied : '' }}</span>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .sl {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--sp-2);
      min-width: 0;
    }
    .sl__url {
      flex: 1 1 260px;
      min-width: 0;
      text-overflow: ellipsis;
      font-size: var(--fs-13);
    }
    .sl__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--sp-2);
    }
    .sl__note {
      flex-basis: 100%;
      margin: 0;
    }
    @media (max-width: 900px) {
      .sl__url {
        flex-basis: 100%;
      }
      .sl__actions .btn {
        flex: 1 1 auto;
      }
    }
  `,
})
export class ShareLink {
  readonly url = input.required<string>();
  /** Текст сообщения рядом со ссылкой: «Приглашение в RemarkRound: проект «X», роль — заказчик». */
  readonly text = input.required<string>();
  /** Строка под кнопками: срок ссылки и т. п. */
  readonly note = input<string | null>(null);

  protected readonly copy = SHARE;
  protected readonly copied = signal(false);
  protected readonly failed = signal(false);
  protected readonly canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected readonly telegramHref = computed(() => `https://t.me/share/url?url=${encodeURIComponent(this.url())}&text=${encodeURIComponent(this.text())}`);
  protected readonly whatsappHref = computed(() => `https://wa.me/?text=${encodeURIComponent(`${this.text()} ${this.url()}`)}`);

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected selectAll(): void {
    this.field().nativeElement.select();
  }

  protected async copyUrl(): Promise<void> {
    this.failed.set(false);
    try {
      await navigator.clipboard.writeText(this.url());
      this.flashCopied();
    } catch {
      // Буфер недоступен (http без TLS, iframe): выделяем поле и пробуем старый путь, иначе — копировать руками
      this.selectAll();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      if (ok) this.flashCopied();
      else this.failed.set(true);
    }
  }

  protected async share(): Promise<void> {
    try {
      await navigator.share({ text: this.text(), url: this.url() });
    } catch {
      // Человек закрыл системное окно (AbortError) — ничего не делаем, ссылка остаётся на экране
    }
  }

  private flashCopied(): void {
    this.copied.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.copied.set(false), 2000);
  }
}
