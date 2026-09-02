import { Injectable, computed, signal } from '@angular/core';
import type { Role, User } from './models';
import { USERS } from '../mock/seed';

const STORAGE_KEY = 'rr.session';

/**
 * Мок-сессия для демо: три демо-пользователя, любой пароль.
 * В фазе 1+ заменяется на JWT из POST /auth/login.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly _user = signal<User | null>(readStored());

  readonly user = this._user.asReadonly();
  readonly role = computed<Role | null>(() => this._user()?.role ?? null);
  readonly isLoggedIn = computed(() => this._user() !== null);
  readonly users: ReadonlyArray<User> = USERS;

  login(email: string): User | null {
    const normalized = email.trim().toLowerCase();
    const user = USERS.find((u) => u.email.toLowerCase() === normalized) ?? null;
    if (user) this.set(user);
    return user;
  }

  switchTo(userId: string): void {
    const user = USERS.find((u) => u.id === userId);
    if (user) this.set(user);
  }

  logout(): void {
    this._user.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* приватный режим */
    }
  }

  userById(id: string): User | undefined {
    return USERS.find((u) => u.id === id);
  }

  private set(user: User): void {
    this._user.set(user);
    try {
      localStorage.setItem(STORAGE_KEY, user.id);
    } catch {
      /* приватный режим */
    }
  }
}

function readStored(): User | null {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return USERS.find((u) => u.id === id) ?? null;
  } catch {
    return null;
  }
}
