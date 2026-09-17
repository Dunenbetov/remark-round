import { Injectable, inject, signal } from '@angular/core';
import type { Role } from './models';
import { UiStateService } from './ui-state.service';

/** Тур есть только у нетехнических ролей: разработчику всё видно по одной кнопке. */
type TourRole = 'business' | 'pm';

export interface TourState {
  role: TourRole;
  step: number;
}

/**
 * Онбординг «Как это работает»: тур по шагам для бизнеса и PM. Открывается сам один раз при первом
 * заходе в журнал (ключ rr.hint.tour.<role>), потом — из меню аватара и ссылки «По шагам» в журнале.
 * Сам диалог — ui/onboarding-tour.ts (смонтирован в app.ts); здесь только состояние.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly ui = inject(UiStateService);
  readonly state = signal<TourState | null>(null);
  /** Кто открыл тур — туда вернём фокус при закрытии. */
  private opener: HTMLElement | null = null;

  open(role: TourRole, step = 0, opener?: HTMLElement | null): void {
    this.opener = opener ?? (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
    this.state.set({ role, step });
  }

  goTo(step: number): void {
    const s = this.state();
    if (s) this.state.set({ ...s, step });
  }

  /** Закрыть и запомнить: больше сам не всплывает. */
  close(): void {
    const s = this.state();
    if (!s) return;
    this.ui.dismissHint(`tour.${s.role}`);
    this.state.set(null);
    const opener = this.opener;
    this.opener = null;
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
  }

  seen(role: TourRole): boolean {
    return this.ui.hintSeen(`tour.${role}`);
  }

  /** Первый заход в журнал бизнеса или PM — тур один раз. */
  maybeAutoOpen(role: Role | null): void {
    if (role !== 'business' && role !== 'pm') return;
    if (this.state() || this.seen(role)) return;
    this.open(role, 0, null);
  }
}
