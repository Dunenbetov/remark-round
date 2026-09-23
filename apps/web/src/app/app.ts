import { Component, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterOutlet } from '@angular/router';
import { AccountService } from './core/account.service';
import { AttentionService } from './core/attention.service';
import { BadgedTitle } from './core/badged-title';
import { NotificationsStore } from './core/notifications.store';
import { OnboardingTour } from './ui/onboarding-tour';
import { UndoBar } from './ui/undo-bar';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UndoBar, OnboardingTour],
  // Одна вежливая живая область на приложение: «ждёт вас» для экранного диктора (AttentionService)
  template: `<router-outlet /><rr-undo-bar /><rr-onboarding-tour />
    <div class="visually-hidden" aria-live="polite" aria-atomic="true">{{ attention.live() }}</div>`,
})
export class App {
  protected readonly attention = inject(AttentionService);

  constructor() {
    const account = inject(AccountService);
    // Уведомления живут с момента входа, а не с первого открытия колокольчика: сокет, сверка, число во вкладке
    const notifications = inject(NotificationsStore);
    const title = inject(Title);
    effect(() => {
      const count = notifications.badge();
      if (title instanceof BadgedTitle) title.setCount(count);
      this.attention.setBadge(count);
    });
    // Вернулись на вкладку — membership могли измениться (добавили в проект, сменили роль)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void account.refresh();
      });
    }
  }
}
