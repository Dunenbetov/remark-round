import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { APP_NAME } from './copy';

/** «Вход — RemarkRound», «Журнал — RemarkRound». Страницы с данными уточняют заголовок сами через Title. */
@Injectable({ providedIn: 'root' })
export class RrTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page ? `${page} — ${APP_NAME}` : APP_NAME);
  }
}
