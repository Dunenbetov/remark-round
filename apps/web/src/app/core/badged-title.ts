import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

/**
 * Заголовок вкладки с числом непрочитанного: «(3) Журнал · Раунд 2 — RemarkRound». Подменяет Title в app.config.ts,
 * поэтому RrTitleStrategy и страницы, уточняющие заголовок, ставят его как раньше, а число добавляется здесь.
 */
@Injectable()
export class BadgedTitle extends Title {
  private base: string;
  private count = 0;

  constructor() {
    super(inject(DOCUMENT));
    this.base = super.getTitle();
  }

  override getTitle(): string {
    return this.base;
  }

  override setTitle(title: string): void {
    this.base = title;
    this.apply();
  }

  /** Непрочитанные уведомления и приглашения; 0 — заголовок без числа. */
  setCount(count: number): void {
    if (count === this.count) return;
    this.count = count;
    this.apply();
  }

  private apply(): void {
    super.setTitle(this.count > 0 ? `(${this.count}) ${this.base}` : this.base);
  }
}
