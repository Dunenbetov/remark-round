import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type IconName =
  | 'plus'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'arrow-left'
  | 'arrow-right'
  | 'check'
  | 'close'
  | 'search'
  | 'upload'
  | 'paperclip'
  | 'image'
  | 'zoom-in'
  | 'zoom-out'
  | 'sun'
  | 'moon'
  | 'document'
  | 'file-text'
  | 'compare'
  | 'warning'
  | 'info'
  | 'external'
  | 'undo'
  | 'keyboard';

/** Общие фрагменты: контур лупы и лист с загнутым углом. */
const LENS = 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13M20 20l-4.6-4.6';
const PAGE = 'M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5L14 3zM14 3v4.5h4.5';

/**
 * Иконки — один <path d> на имя для viewBox 0 0 24 24 (stroke currentColor 1.75, round caps/joins, fill none).
 * Круги нарисованы двумя дугами, точки — отрезком h.01: так не нужен innerHTML и санитайзер.
 */
export const ICONS: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-left': 'm15 6-6 6 6 6',
  'arrow-left': 'M19 12H5m7-7-7 7 7 7',
  'arrow-right': 'M5 12h14m-7-7 7 7-7 7',
  check: 'm5 12.5 4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6 6 18',
  search: LENS,
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  paperclip:
    'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
  image:
    'M5 4h14a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5 4zM9 8a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 1 0 0-2.5m11.5 8-4.5-4.5-8 8',
  'zoom-in': `${LENS}M10.5 8v5M8 10.5h5`,
  'zoom-out': `${LENS}M8 10.5h5`,
  sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z',
  document: PAGE,
  'file-text': `${PAGE}M9 12h6M9 16h6`,
  compare: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM12 3v18',
  warning: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 11v5M12 8h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5',
  undo: 'M8 4 4 8l4 4M4 8h10a5 5 0 0 1 0 10h-3',
  keyboard:
    'M3 7a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17zM7 9.5h.01M11 9.5h.01M15 9.5h.01M17 9.5h.01M7 13h.01M11 13h.01M15 13h.01M17 13h.01M8 16.5h8',
};

/** Штриховая иконка. По умолчанию декоративная (aria-hidden); с label — role="img" + aria-label. */
@Component({
  selector: 'rr-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-hidden]': 'label() ? null : "true"',
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label()',
  },
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
  >
    <path [attr.d]="d()" />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  readonly label = input<string | null>(null);

  protected readonly d = computed(() => ICONS[this.name()]);
}
