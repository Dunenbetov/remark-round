import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RemarkStatus, Role } from '../core/models';
import { PillTone, STATUS_TONE, statusLabelFor } from '../core/copy';

/**
 * Статус-пилюля. Код статуса — только в data-status, на экране русская подпись. Точка = цвет + форма.
 * `role` — кто смотрит: «Ждёт вашего решения» видит только тот, от кого ждут решения, остальным — чьего (20.09).
 */
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
  readonly role = input<Role | null>(null);
  readonly label = input<string>();
  readonly toneOverride = input<PillTone>();
  readonly pulse = input(false);
  readonly dot = input(false);

  readonly text = computed(() => this.label() ?? (this.status() ? statusLabelFor(this.status()!, this.role()) : ''));
  readonly tone = computed<PillTone>(() => this.toneOverride() ?? (this.status() ? STATUS_TONE[this.status()!] : 'muted'));
}
