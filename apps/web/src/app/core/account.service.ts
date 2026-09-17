import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { homeUrl } from './guards';
import type { Session } from './models';
import { QueueService } from './queue.service';
import { SessionService } from './session.service';

/**
 * Вход, выход и обновление сессии (фаза 11). Стоит над ApiService и SessionService — иначе цикл:
 * ApiService берёт токен из SessionService. Membership обновляются через GET /auth/me при старте,
 * при возврате на вкладку и опросом страницы ожидания — человеку не нужно перелогиниваться после того,
 * как его добавили в проект.
 */
@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly queue = inject(QueueService);
  private readonly router = inject(Router);
  private refreshing: Promise<boolean> | null = null;

  /** GET /auth/me → сессия. false — не залогинен или запрос не удался (401 уже разлогинил ApiService). */
  refresh(): Promise<boolean> {
    if (!this.session.isLoggedIn()) return Promise.resolve(false);
    this.refreshing ??= this.api
      .me()
      .then((me) => {
        this.session.patch({ user: me.user, memberships: me.memberships });
        return true;
      })
      .catch(() => false)
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /** После входа или регистрации: чужой снимок очереди на этой машине — не наш. */
  applyLogin(result: Session): void {
    this.queue.clear();
    this.session.set(result);
  }

  logout(): void {
    this.queue.clear();
    this.session.logout();
    void this.router.navigateByUrl('/login');
  }

  home(): string {
    return homeUrl(this.session);
  }
}
