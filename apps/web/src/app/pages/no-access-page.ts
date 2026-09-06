import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, LOGIN, NAV, ROLE_GENITIVE } from '../core/copy';
import { homeUrl } from '../core/guards';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { BrandMark } from '../ui/brand-mark';

/**
 * Чужой проект: лист 520px по центру — бренд-знак с danger-точкой, «Нет доступа», нейтральная подсказка
 * (о проекте ничего не раскрываем), «Вы вошли как …» и выход: к своему проекту / сменить пользователя.
 * Без сессии — только «Войти». Штампа нет.
 */
@Component({
  selector: 'rr-no-access-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, BrandMark],
  template: `
    <div class="page">
      <rr-app-bar [brandOnly]="true" />
      <main id="main" class="page__body na-body">
        <div class="paper na rise">
          <rr-brand-mark [size]="40" tone="danger" />
          <h1 class="na__title">{{ empty.noAccess }}</h1>
          <p class="na__hint">{{ empty.noAccessHint }}</p>
          @if (signedAs(); as who) {
            <p class="meta na__who">{{ who }}</p>
          }
          <div class="na__actions">
            @if (hasProject()) {
              <a class="btn btn--primary" [routerLink]="home()">{{ empty.toMyProject }}</a>
              <button type="button" class="btn btn--secondary" (click)="logout()">{{ nav.switchUser }}</button>
            } @else {
              <a class="btn btn--primary" routerLink="/login">{{ loginLabel }}</a>
            }
          </div>
        </div>
      </main>
    </div>
  `,
  styles: `
    .na-body {
      align-items: center;
      justify-content: center;
      padding-bottom: var(--sp-12);
    }
    .na {
      width: min(520px, 100%);
      padding: var(--sp-10) var(--sp-6);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-4);
      text-align: center;
    }
    .na__title {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      letter-spacing: -0.01em;
    }
    .na__hint {
      margin: 0;
      font-size: var(--fs-15);
      line-height: var(--lh-15);
      color: var(--rr-ink-2);
      max-width: 40ch;
    }
    .na__who {
      margin: 0;
    }
    .na__actions {
      display: flex;
      justify-content: center;
      gap: var(--sp-2);
      flex-wrap: wrap;
      margin-top: var(--sp-2);
    }
    @media (max-width: 900px) {
      .na {
        padding: var(--sp-8) var(--sp-5);
      }
      .na__actions {
        width: 100%;
        flex-direction: column;
      }
    }
  `,
})
export class NoAccessPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly empty = EMPTY;
  protected readonly nav = NAV;
  protected readonly loginLabel = LOGIN.submit;

  protected readonly hasProject = computed(() => this.session.memberships().length > 0);
  /** Куда ведёт «К моему проекту»: очередь разработчика или последний раунд. */
  protected readonly home = computed(() => homeUrl(this.session));
  /** «Вы вошли как PM · решает, работа ли это»; без membership — только имя. */
  protected readonly signedAs = computed(() => {
    const user = this.session.user();
    if (!user) return null;
    const role = this.session.memberships()[0]?.role;
    return role ? EMPTY.signedAs(user.name, ROLE_GENITIVE[role]) : user.name;
  });

  protected logout(): void {
    this.session.logout();
    void this.router.navigateByUrl('/login');
  }
}
