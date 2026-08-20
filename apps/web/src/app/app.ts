import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <div class="shell">
      <header class="shell__header">
        <h1 class="shell__logo">RemarkRound</h1>
      </header>
      <main class="shell__main">
        <p class="shell__status">сервис поднят</p>
      </main>
    </div>
  `,
})
export class App {}
