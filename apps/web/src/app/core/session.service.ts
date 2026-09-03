import { Injectable, computed, signal } from '@angular/core';
import type { Membership, Role, Session, User } from './models';

const STORAGE_KEY = 'rr.session';
const PROJECT_KEY = 'rr.project';

/** Сессия из POST /auth/login: токен, пользователь, его membership по проектам. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly _session = signal<Session | null>(readStored());

  readonly session = this._session.asReadonly();
  readonly user = computed<User | null>(() => this._session()?.user ?? null);
  readonly token = computed(() => this._session()?.accessToken ?? null);
  readonly memberships = computed<Membership[]>(() => this._session()?.memberships ?? []);
  readonly isLoggedIn = computed(() => this._session() !== null);
  private readonly preferred = signal<string | null>(readPreferred());
  /** Текущий проект: выбранный в шапке, иначе первый membership. */
  readonly currentProjectId = computed(() => {
    const list = this.memberships();
    return (list.find((m) => m.projectId === this.preferred()) ?? list[0])?.projectId ?? null;
  });

  selectProject(projectId: string): void {
    this.preferred.set(projectId);
    try {
      localStorage.setItem(PROJECT_KEY, projectId);
    } catch {
      /* приватный режим */
    }
  }

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

function readPreferred(): string | null {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
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
