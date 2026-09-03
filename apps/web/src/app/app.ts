import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UndoBar } from './ui/undo-bar';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UndoBar],
  template: `<router-outlet /><rr-undo-bar />`,
})
export class App {}
