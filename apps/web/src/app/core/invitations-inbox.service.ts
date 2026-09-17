import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import type { InboxInvitation } from './models';
import { SessionService } from './session.service';

/** Как часто спрашиваем колокольчик, пока вкладка видна. */
const POLL_MS = 60_000;

/**
 * Колокольчик приглашений (ADR 013 «без почты»): приглашения на e-mail вошедшего человека — GET /auth/invitations.
 * Грузим при появлении сессии (в т. ч. сразу после входа), раз в минуту, при возврате на вкладку; при выходе — пусто.
 * Ответ, пришедший уже после смены человека, отбрасываем: чужие приглашения не должны мелькнуть.
 */
@Injectable({ providedIn: 'root' })
export class InvitationsInboxService {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  private readonly _items = signal<InboxInvitation[]>([]);
  readonly items = this._items.asReadonly();
  readonly count = computed(() => this._items().length);

  private readonly userId = computed(() => this.session.user()?.id ?? null);
  private timer: ReturnType<typeof setInterval> | undefined;
  private loading: { userId: string; done: Promise<void> } | null = null;

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => {
        this._items.set([]);
        if (id) this.start();
        else this.stop();
      });
    });

    const onFocus = () => void this.refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  /** Перечитать сейчас; параллельные вызовы (focus + visibilitychange) сливаются в один запрос. */
  refresh(): Promise<void> {
    const id = this.userId();
    if (!id) return Promise.resolve();
    if (this.loading?.userId === id) return this.loading.done;
    const current = {
      userId: id,
      done: this.api
        .myInvitations()
        .then((list) => {
          if (this.userId() === id) this._items.set(list);
        })
        .catch(() => {
          // Сеть или старый сервер без ручки: колокольчик просто молчит до следующей попытки
        })
        .finally(() => {
          if (this.loading === current) this.loading = null;
        }),
    };
    this.loading = current;
    return current.done;
  }

  /** Принятое, отклонённое или уже недействительное — убрать из списка без перезапроса. */
  remove(id: string): void {
    this._items.update((list) => list.filter((x) => x.id !== id));
  }

  private start(): void {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, POLL_MS);
  }

  private stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
