import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { APP_NAME, NAV, ROLE_TITLE } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { PresencePill } from './presence-pill';

type Section = 'journal' | 'documents' | 'import' | 'dev';

/**
 * Стеклянная липкая шапка: роль крупно, проект · раунд, нав-пилюли по роли,
 * справа пилюля присутствия (PM) или «Добавить замечание» (бизнес) и аватар.
 */
@Component({
  selector: 'rr-glass-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PresencePill],
  template: `
    <header class="hdr glass" [class.hdr--brand]="brandOnly()">
      <div class="hdr__left">
        @if (brandOnly()) {
          <div class="serif hdr__brand">{{ appName }}</div>
        } @else {
          <div class="h-role hdr__role">{{ title() }}</div>
          <div class="meta hdr__sub">{{ subtitle() }}</div>
          @if (compact()) {
            <div class="meta hdr__sub hdr__sub--compact">{{ compact() }}</div>
          }
        }
      </div>
      @if (!brandOnly()) {
        <nav class="hdr__nav" aria-label="Разделы">
          @if (role() === 'developer') {
            <a class="hdr__pill hdr__pill--on" [routerLink]="link('dev')">{{ nav.dev }}</a>
          } @else {
            <a class="hdr__pill" [class.hdr__pill--on]="section() === 'documents'" [routerLink]="link('documents')">{{ nav.documents }}</a>
            <a class="hdr__pill" [class.hdr__pill--on]="section() === 'journal'" [routerLink]="link('r', round)">{{ nav.journal }}</a>
            <a class="hdr__pill" [class.hdr__pill--on]="section() === 'import'" [routerLink]="link('r', round, 'import')">{{ nav.import }}</a>
          }
        </nav>
      }
      <div class="hdr__right">
        @if (!brandOnly() && role() === 'pm' && presence() && watcher(); as w) {
          <rr-presence-pill class="hdr__presence" [user]="w" />
        }
        @if (!brandOnly() && role() === 'business') {
          <a class="btn btn--primary hdr__add" [routerLink]="link('r', round, 'remarks', 'new')">{{ nav.addRemark }}</a>
        }
        @if (user(); as u) {
          <div class="hdr__user">
            <button
              type="button"
              class="avatar"
              [class.avatar--wait]="u.tone === 'wait'"
              [class.avatar--work]="u.tone === 'work'"
              [attr.aria-label]="u.name"
              aria-haspopup="menu"
              [attr.aria-expanded]="menuOpen()"
              (click)="menuOpen.set(!menuOpen())"
            >
              {{ u.initial }}
            </button>
            @if (menuOpen()) {
              <div class="menu paper" role="menu">
                <div class="meta menu__title">{{ nav.switchUser }}</div>
                @for (person of session.users; track person.id) {
                  <button type="button" class="menu__item" role="menuitem" [class.menu__item--on]="person.id === u.id" (click)="switchTo(person.id)">
                    <span class="avatar avatar--sm" [class.avatar--wait]="person.tone === 'wait'" [class.avatar--work]="person.tone === 'work'">{{ person.initial }}</span>
                    <span>{{ person.name }}<span class="meta"> · {{ roleTitle[person.role] }}</span></span>
                  </button>
                }
                <button type="button" class="menu__item menu__item--out" role="menuitem" (click)="logout()">{{ nav.logout }}</button>
              </div>
            }
          </div>
        }
      </div>
    </header>
  `,
  styles: `
    :host {
      display: block;
      position: sticky;
      top: 16px;
      z-index: 5;
      width: min(var(--rr-container), 100% - 32px);
      margin: 16px auto 0;
    }
    .hdr {
      height: 72px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 0 24px;
    }
    .hdr__left {
      min-width: 0;
    }
    .hdr__role,
    .hdr__sub {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hdr__sub--compact {
      display: none;
    }
    .hdr__brand {
      font-size: 22px;
      line-height: 28px;
    }
    .hdr__nav {
      display: flex;
      gap: 4px;
    }
    .hdr__pill {
      height: 32px;
      padding: 0 14px;
      border-radius: 999px;
      font-size: 14px;
      line-height: 32px;
      color: var(--rr-ink);
      text-decoration: none;
      white-space: nowrap;
    }
    .hdr__pill:hover {
      background: rgba(31, 27, 22, 0.04);
      color: var(--rr-ink);
    }
    .hdr__pill--on,
    .hdr__pill--on:hover {
      background: rgba(31, 27, 22, 0.07);
      font-weight: 600;
    }
    .hdr__right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .hdr__user {
      position: relative;
    }
    .menu {
      position: absolute;
      right: 0;
      top: 40px;
      min-width: 260px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      z-index: 6;
    }
    .menu__title {
      padding: 6px 10px 4px;
    }
    .menu__item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 6px 10px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      text-align: left;
      cursor: pointer;
      color: var(--rr-ink);
    }
    .menu__item:hover {
      background: var(--rr-surface-2);
    }
    .menu__item--on {
      font-weight: 600;
    }
    .menu__item--out {
      margin-top: 4px;
      border-top: 1px solid var(--rr-line);
      border-radius: 0 0 8px 8px;
      color: var(--rr-ink-soft);
    }
    .avatar--sm {
      width: 24px;
      height: 24px;
      font-size: 11px;
    }
    @media (max-width: 720px) {
      :host {
        top: 12px;
        margin: 12px auto 0;
        width: calc(100% - 24px);
      }
      .hdr {
        height: 56px;
        padding: 0 16px;
      }
      .hdr__role {
        font-size: 18px;
        line-height: 24px;
      }
      .hdr__nav,
      .hdr__presence,
      .hdr__add {
        display: none;
      }
      .hdr__sub--compact {
        display: block;
      }
      .hdr__sub--compact + .hdr__sub,
      .hdr__left:has(.hdr__sub--compact) .hdr__sub:not(.hdr__sub--compact) {
        display: none;
      }
    }
  `,
})
export class GlassHeader {
  /** Хвост подзаголовка, например «12 замечаний, 4 ждут вас». */
  readonly extra = input<string | null>(null);
  /** Подзаголовок для узкого экрана, например «Раунд 2 · № 12». */
  readonly compact = input<string | null>(null);
  readonly presence = input(true);
  readonly brandOnly = input(false);

  protected readonly session = inject(SessionService);
  private readonly store = inject(RemarksStore);
  private readonly router = inject(Router);

  protected readonly appName = APP_NAME;
  protected readonly nav = NAV;
  protected readonly roleTitle = ROLE_TITLE;
  protected readonly round = this.store.round.number;
  protected readonly menuOpen = signal(false);

  protected readonly user = this.session.user;
  protected readonly role = this.session.role;
  protected readonly title = computed(() => (this.role() ? ROLE_TITLE[this.role()!] : APP_NAME));
  protected readonly subtitle = computed(() => {
    const base = `${this.store.project.name} · Раунд ${this.round}`;
    return this.extra() ? `${base} · ${this.extra()}` : base;
  });
  /** Кто ещё смотрит: для PM — бизнес (мок присутствия). */
  protected readonly watcher = computed(() => this.session.users.find((u) => u.role === 'business') ?? null);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly section = computed<Section>(() => {
    const url = this.url();
    if (url.includes('/documents')) return 'documents';
    if (url.includes('/import')) return 'import';
    if (url.includes('/dev')) return 'dev';
    return 'journal';
  });

  protected link(...parts: (string | number)[]): unknown[] {
    return ['/p', this.store.project.id, ...parts];
  }

  protected switchTo(userId: string): void {
    this.session.switchTo(userId);
    this.menuOpen.set(false);
    void this.router.navigateByUrl('/');
  }

  protected logout(): void {
    this.session.logout();
    this.menuOpen.set(false);
    void this.router.navigateByUrl('/login');
  }
}
