import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OnboardingTour } from './ui/onboarding-tour';
import { UndoBar } from './ui/undo-bar';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UndoBar, OnboardingTour],
  template: `<router-outlet /><rr-undo-bar /><rr-onboarding-tour />`,
})
export class App {}
