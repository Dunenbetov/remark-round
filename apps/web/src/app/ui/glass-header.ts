import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { APP_NAME, NAV, PRESENCE_DEMO, ROLE_TITLE } from '../core/copy';
import type { Role } from '../core/models';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { PresencePill } from './presence-pill';

type Section = 'journal' | 'documents' | 'import' | 'dev';

const TONE_BY_ROLE: Record<Role, 'accent' | 'wait' | 'work'> = { pm: 'accent', admin: 'accent', business: 'wait', developer: 'work' };

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
      @if (!brandOnly() && projectId()) {
        <nav class="hdr__nav" aria-label="Разделы">
          @if (role() === 'developer') {
            <a class="hdr__pill hdr__pill--on" [routerLink]="link('dev')">{{ nav.dev }}</a>
          } @else {
            <a class="hdr__pill" [class.hdr__pill--on]="section() === 'documents'" [routerLink]="link('documents')">{{ nav.documents }}</a>
            <a class="hdr__pill" [class.hdr__pill--on]="section() === 'journal'" [routerLink]="link('r', roundParam())">{{ nav.journal }}</a>
            <a class="hdr__pill" [class.hdr__pill--on]="section() === 'import'" [routerLink]="link('r', roundParam(), 'import')">{{ nav.import }}</a>
          }
        </nav>
      }
      <div class="hdr__right">
        @if (!brandOnly() && role() === 'pm' && presence()) {
          <rr-presence-pill class="hdr__presence" [name]="presenceDemo.name" [roleGenitive]="presenceDemo.roleGenitive" />
        }
        @if (!brandOnly() && role() === 'business' && projectId()) {
          <a class="btn btn--primary hdr__add" [routerLink]="link('r', roundParam(), 'remarks', 'new')">{{ nav.addRemark }}</a>
        }
        @if (user(); as u) {
          <div class="hdr__user">
            <button
              type="button"
              class="avatar"
              [class.avatar--wait]="tone() === 'wait'"
              [class.avatar--work]="tone() === 'work'"
              [attr.aria-label]="u.name"
              aria-haspopup="menu"
              [attr.aria-expanded]="menuOpen()"
              (click)="menuOpen.set(!menuOpen())"
            >
              {{ initial() }}
            </button>
            @if (menuOpen()) {
              <div class="menu paper" role="menu">
                <div class="menu__who">
                  <div class="menu__name">{{ u.name }}</div>
                  <div class="meta">{{ u.email }}@if (role()) { · {{ roleTitle[role()!] }}}</div>
                </div>
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
    .menu__who {
      padding: 6px 10px 8px;
    }
    .menu__name {
      font-weight: 600;
    }
    .menu__item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
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
    .menu__item--out {
      border-top: 1px solid var(--rr-line);
      border-radius: 0 0 8px 8px;
      color: var(--rr-ink-soft);
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

  private readonly session = inject(SessionService);
  private readonly store = inject(RemarksStore);
  private readonly router = inject(Router);

  protected readonly appName = APP_NAME;
  protected readonly nav = NAV;
  protected readonly roleTitle = ROLE_TITLE;
  protected readonly presenceDemo = PRESENCE_DEMO;
  protected readonly menuOpen = signal(false);

  protected readonly user = this.session.user;
  protected readonly projectId = this.store.projectId;
  protected readonly role = computed<Role | null>(() => this.session.roleIn(this.projectId() ?? this.session.currentProjectId()));
  protected readonly tone = computed(() => (this.role() ? TONE_BY_ROLE[this.role()!] : 'accent'));
  protected readonly initial = computed(() => (this.user()?.name ?? '?').charAt(0).toUpperCase());
  protected readonly title = computed(() => (this.role() ? ROLE_TITLE[this.role()!] : APP_NAME));
  protected readonly roundParam = computed(() => this.store.roundNumber() ?? 'latest');
  protected readonly subtitle = computed(() => {
    const name = this.store.projectName() || this.session.membership(this.session.currentProjectId())?.projectName || '';
    const round = this.store.roundNumber();
    const base = [name, round ? `Раунд ${round}` : null].filter(Boolean).join(' · ');
    return this.extra() ? `${base} · ${this.extra()}` : base;
  });

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
    return ['/p', this.projectId() ?? this.session.currentProjectId() ?? '', ...parts];
  }

  protected logout(): void {
    this.session.logout();
    this.menuOpen.set(false);
    void this.router.navigateByUrl('/login');
  }
}
