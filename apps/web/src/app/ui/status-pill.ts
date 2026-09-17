import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RemarkStatus } from '../core/models';
import { PillTone, STATUS_LABEL, STATUS_TONE } from '../core/copy';

/** Статус-пилюля. Код статуса — только в data-status, на экране русская подпись. Точка = цвет + форма. */
@Component({
  selector: 'rr-status-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="pill" [class]="'pill pill--' + tone()" [attr.data-status]="status() ?? null">
    @if (pulse()) {
      <span class="dot dot--pulse" [class]="'dot dot--pulse dot--' + tone()"></span>
    } @else if (dot()) {
      <span class="dot" [class]="'dot dot--' + tone()"></span>
    }
    {{ text() }}
  </span>`,
})
export class StatusPill {
  readonly status = input<RemarkStatus>();
  readonly label = input<string>();
  readonly toneOverride = input<PillTone>();
  readonly pulse = input(false);
  readonly dot = input(false);

  readonly text = computed(() => this.label() ?? (this.status() ? STATUS_LABEL[this.status()!] : ''));
  readonly tone = computed<PillTone>(() => this.toneOverride() ?? (this.status() ? STATUS_TONE[this.status()!] : 'muted'));
}
