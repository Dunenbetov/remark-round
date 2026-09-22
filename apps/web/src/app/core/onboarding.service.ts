import { Injectable, inject, signal } from '@angular/core';
import { TOUR, type TourRole } from './copy';
import type { Role } from './models';
import { UiStateService } from './ui-state.service';

/** Версия тура в ключе подсказки: новая версия всплывает один раз и у тех, кто закрыл прежнюю. */
const TOUR_KEY_VERSION = 'v2';

export interface TourState {
  role: TourRole;
  step: number;
}

/** Есть ли у роли тур (copy.ts → TOUR.roles): единственная проверка для меню, автооткрытия и диалога. */
export function hasTour(role: Role | null): role is TourRole {
  return role !== null && role in TOUR.roles;
}

/**
 * Онбординг «Как это работает»: три шага про участок роли. Открывается сам один раз при первом заходе
 * на домашнюю страницу роли (журнал — заказчику и руководителю приёмки, очередь — разработчику),
 * ключ rr.hint.<userId>.tour.<версия>.<роль>; потом — из меню аватара.
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
    this.ui.dismissHint(hintKey(s.role));
    this.state.set(null);
    const opener = this.opener;
    this.opener = null;
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
  }

  /** Первый заход роли с туром — тур один раз. */
  maybeAutoOpen(role: Role | null): void {
    if (!hasTour(role) || this.state() || this.ui.hintSeen(hintKey(role))) return;
    this.open(role, 0, null);
  }
}

function hintKey(role: TourRole): string {
  return `tour.${TOUR_KEY_VERSION}.${role}`;
}
