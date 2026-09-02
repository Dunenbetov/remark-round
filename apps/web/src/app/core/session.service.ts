import { Injectable, computed, signal } from '@angular/core';
import type { Membership, Role, Session, User } from './models';

const STORAGE_KEY = 'rr.session';

/** Сессия из POST /auth/login: токен, пользователь, его membership по проектам. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly _session = signal<Session | null>(readStored());

  readonly session = this._session.asReadonly();
  readonly user = computed<User | null>(() => this._session()?.user ?? null);
  readonly token = computed(() => this._session()?.accessToken ?? null);
  readonly memberships = computed<Membership[]>(() => this._session()?.memberships ?? []);
  readonly isLoggedIn = computed(() => this._session() !== null);
  /** Текущий проект: пока один на пользователя, берём первый membership. */
  readonly currentProjectId = computed(() => this.memberships()[0]?.projectId ?? null);

  set(session: Session): void {
    this._session.set(session);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* приватный режим */
    }
  }

  logout(): void {
    this._session.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* приватный режим */
    }
  }

  membership(projectId: string | null | undefined): Membership | null {
    if (!projectId) return null;
    return this.memberships().find((m) => m.projectId === projectId) ?? null;
  }

  roleIn(projectId: string | null | undefined): Role | null {
    return this.membership(projectId)?.role ?? null;
  }

  isMember(projectId: string): boolean {
    return this.membership(projectId) !== null;
  }
}

function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return parsed.accessToken && parsed.user && Array.isArray(parsed.memberships) ? (parsed as Session) : null;
  } catch {
    return null;
  }
}
