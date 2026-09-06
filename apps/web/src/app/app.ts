import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AccountService } from './core/account.service';
import { OnboardingTour } from './ui/onboarding-tour';
import { UndoBar } from './ui/undo-bar';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UndoBar, OnboardingTour],
  template: `<router-outlet /><rr-undo-bar /><rr-onboarding-tour />`,
})
export class App {
  constructor() {
    const account = inject(AccountService);
    // Вернулись на вкладку — membership могли измениться (добавили в проект, сменили роль)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void account.refresh();
      });
    }
  }
}
