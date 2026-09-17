import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';

/** Физические коды клавиш (KeyboardEvent.code), которые умеет сервис. NumPad не поддерживаем. */
type KeyCode =
  | 'Digit1'
  | 'Digit2'
  | 'Digit3'
  | 'Digit4'
  | 'Digit5'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'KeyJ'
  | 'KeyK'
  | 'Escape'
  | 'KeyC'
  | 'KeyO'
  | 'KeyU'
  | 'Enter';

/** Карта «код → обработчик». Обработчик получает исходное событие (preventDefault уже вызван). */
type ShortcutMap = Partial<Record<KeyCode, (e: KeyboardEvent) => void>>;

/** Поля ввода и виджеты со своими клавишами — глобальные шорткаты там не работают. */
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [data-rr-keys]';

/** Открытые оверлеи со своей клавиатурой: просмотрщик, меню, диалог. */
const OVERLAY_SELECTOR = 'rr-shot-viewer, .menu[role="menu"], [role="dialog"]';

/** Сколько держать `pressed` для подсветки кнопки (.is-pressed). */
const PRESSED_MS = 120;

/** Элемент (или его предок) — поле ввода / виджет со своими клавишами. */
function isEditableTarget(el: Element | null): boolean {
  return !!el && typeof el.closest === 'function' && el.closest(EDITABLE_SELECTOR) !== null;
}

/**
 * Глобальные клавиши без IDE-эстетики.
 *
 * Работает от физического кода клавиши (`e.code`), поэтому цифры 1–5, стрелки, Esc и Enter одинаково
 * ходят в любой раскладке; J/K и C/O/U — тоже физические клавиши (на русской раскладке это О/Л и С/Щ/Г).
 * Модификаторы (Ctrl/Cmd/Alt/Shift) не перехватываем — системные сочетания остаются системными.
 *
 * Карты лежат в стеке: активна последняя привязанная (верх). `bind` возвращает функцию отвязки —
 * она убирает именно свою карту, где бы та ни была в стеке. Слушатель `document keydown` ставится
 * лениво при первом bind и снимается, когда стек пуст.
 *
 * Клавиша не срабатывает, если: событие уже обработано (defaultPrevented), удержание (repeat),
 * фокус или цель — поле ввода / [data-rr-keys], либо открыт оверлей (rr-shot-viewer, меню, диалог).
 */
@Injectable({ providedIn: 'root' })
export class ShortcutsService {
  private readonly stack: ShortcutMap[] = [];
  private readonly pressedSig = signal<KeyCode | null>(null);
  private pressedTimer: ReturnType<typeof setTimeout> | null = null;
  private listening = false;
  private readonly doc = typeof document !== 'undefined' ? document : null;

  /** Код только что обработанной клавиши; сбрасывается через 120 мс — для подсветки кнопки `.is-pressed`. */
  readonly pressed: Signal<KeyCode | null> = this.pressedSig.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.detach());
  }

  /** Кладёт карту на верх стека и делает её активной. Возвращает функцию отвязки. */
  bind(map: ShortcutMap): () => void {
    this.stack.push(map);
    this.attach();
    let bound = true;
    return () => {
      if (!bound) return;
      bound = false;
      const i = this.stack.lastIndexOf(map);
      if (i >= 0) this.stack.splice(i, 1);
      if (this.stack.length === 0) this.detach();
    };
  }

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

    // В полях ввода и виджетах со своими клавишами — не вмешиваемся.
    const t = e.target instanceof Element ? e.target : null;
    const a = this.doc?.activeElement ?? null;
    if (isEditableTarget(t) || isEditableTarget(a)) return;

    // У открытого оверлея своя клавиатура.
    if (this.doc?.querySelector(OVERLAY_SELECTOR)) return;

    const top = this.stack[this.stack.length - 1];
    // Некоторые виртуальные клавиатуры и автоматизация не заполняют e.code — выводим его из e.key.
    const code = (e.code || codeFromKey(e.key)) as KeyCode;
    const handler = top?.[code];
    if (!handler) return;

    e.preventDefault();
    this.flash(code);
    handler(e);
  };

  /** Подсветка: выставить код и сбросить через PRESSED_MS (предыдущий таймер очищаем). */
  private flash(code: KeyCode): void {
    if (this.pressedTimer !== null) clearTimeout(this.pressedTimer);
    this.pressedSig.set(code);
    this.pressedTimer = setTimeout(() => {
      this.pressedTimer = null;
      this.pressedSig.set(null);
    }, PRESSED_MS);
  }

  private attach(): void {
    if (this.listening || !this.doc) return;
    this.doc.addEventListener('keydown', this.onKeydown);
    this.listening = true;
  }

  private detach(): void {
    if (!this.listening || !this.doc) return;
    this.doc.removeEventListener('keydown', this.onKeydown);
    this.listening = false;
    if (this.pressedTimer !== null) {
      clearTimeout(this.pressedTimer);
      this.pressedTimer = null;
    }
  }
}

/** Фолбэк для событий без `code`: цифры, стрелки, Esc, Enter и латинские j/k. */
function codeFromKey(key: string): string {
  if (/^[1-5]$/.test(key)) return `Digit${key}`;
  if (key === 'Escape' || key === 'Enter' || key.startsWith('Arrow')) return key;
  const k = key.toLowerCase();
  return k === 'j' || k === 'k' || k === 'c' || k === 'o' || k === 'u' ? `Key${k.toUpperCase()}` : '';
}
