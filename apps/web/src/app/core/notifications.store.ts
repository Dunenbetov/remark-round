import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { AttentionService } from './attention.service';
import { InvitationsInboxService } from './invitations-inbox.service';
import { links } from './links';
import type { NotificationEvent, NotificationView, NotificationsReadBody } from './models';
import { SessionService } from './session.service';
import { WsService } from './ws.service';

/** Страница колокольчика. */
const PAGE = 30;
/** Запасной опрос, пока сокет лежит и вкладка видна. */
const POLL_MS = 60_000;
/** Возврат во вкладку при живом сокете: сверяемся, только если прошло больше минуты. */
const STALE_MS = 60_000;

type NewEvent = Extract<NotificationEvent, { type: 'notification.new' }>;
type ReadEvent = Extract<NotificationEvent, { type: 'notification.read' }>;

/**
 * Уведомления о замечаниях (ADR 016). Правда — строка в БД, сокет — только толчок: состояние сверяем по GET /auth/notifications
 * при подключении и переподключении сокета, при открытии колокольчика и при возврате во вкладку (если сокет лежал или прошло
 * больше минуты); пока сокета нет — опрос раз в минуту. Слияние по id: повторный толчок безвреден.
 * Администратор инстанса в проектах не участвует — колокольчика у него нет.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly ws = inject(WsService);
  private readonly attention = inject(AttentionService);
  private readonly inbox = inject(InvitationsInboxService);
  private readonly router = inject(Router);

  private readonly _items = signal<NotificationView[]>([]);
  private readonly _unread = signal(0);
  private readonly _hasMore = signal(false);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  readonly items = this._items.asReadonly();
  readonly unread = this._unread.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** Первая сверка прошла: пустой список — правда, а не «ещё грузим». */
  readonly loaded = this._loaded.asReadonly();

  readonly active = computed(() => !!this.session.user() && !this.session.isInstanceAdmin());
  /** Число на колокольчике, во вкладке и на иконке: непрочитанные уведомления и приглашения. */
  readonly badge = computed(() => (this.active() ? this._unread() + this.inbox.count() : 0));

  private readonly userId = computed(() => (this.active() ? (this.session.user()?.id ?? null) : null));
  private viewingId: string | null = null;
  private lastSync = 0;
  private syncing: { userId: string; done: Promise<void> } | null = null;
  /** Сверка запрошена, пока шла другая: ответ той мог уйти раньше события — повторим после. */
  private syncAgain = false;
  /** Пришло толчком, пока шла сверка: её ответ мог быть снят раньше — не теряем до следующей. */
  private readonly pushed = new Set<string>();
  /** Следующая сверка заменяет список целиком: после `notification.sync` (убрали из проекта, сменили роль) догруженное тоже устарело. */
  private replaceNext = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => {
        this.reset();
        if (!id) return;
        this.ws.connect();
        void this.sync();
      });
    });
    // Запасной опрос — только пока сокета нет
    effect(() => {
      const on = !!this.userId() && !this.ws.connected();
      untracked(() => this.poll(on));
    });

    const offs = [
      this.ws.on('notification.new', (e) => this.onNew(e)),
      this.ws.on('notification.read', (e) => this.onRead(e)),
      this.ws.on('notification.sync', () => {
        this.replaceNext = true;
        void this.sync();
      }),
      this.ws.onConnect(() => void this.sync()),
    ];
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !this.userId()) return;
      if (!this.ws.connected() || Date.now() - this.lastSync > STALE_MS) void this.sync();
      if (this.viewingId) this.readViewing();
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      offs.forEach((off) => off());
      document.removeEventListener('visibilitychange', onVisible);
      this.poll(false);
    });
  }

  /** Сверить с сервером: первая страница заменяет свою часть списка, догруженные старые остаются. */
  sync(): Promise<void> {
    const id = this.userId();
    if (!id) return Promise.resolve();
    if (this.syncing?.userId === id) {
      this.syncAgain = true;
      return this.syncing.done;
    }
    this._loading.set(true);
    this.pushed.clear();
    const current = {
      userId: id,
      done: this.api
        .notifications({ limit: PAGE })
        .then((page) => {
          if (this.userId() !== id) return;
          this.lastSync = Date.now();
          const replace = this.replaceNext;
          this.replaceNext = false;
          const fresh = sortNewest(page.items);
          const oldest = fresh[fresh.length - 1];
          const freshIds = new Set(fresh.map((n) => n.id));
          // Старше первой страницы — то, что догрузили «Показать ещё»; внутри её окна пропавшее с сервера пропадает и тут
          const older = !replace && page.hasMore && oldest ? this._items().filter((n) => !freshIds.has(n.id) && isOlder(n, oldest)) : [];
          const pushed = this._items().filter((n) => this.pushed.has(n.id) && !freshIds.has(n.id) && !older.includes(n));
          this._items.set(pushed.length ? sortNewest([...fresh, ...pushed, ...older]) : [...fresh, ...older]);
          if (!older.length) this._hasMore.set(page.hasMore);
          this._unread.set(page.unread);
          this._loaded.set(true);
          if (this.viewingId) this.readViewing();
        })
        .catch(() => {
          // Сеть или сервер без ручки: колокольчик молчит до следующей сверки
        })
        .finally(() => {
          if (this.syncing !== current) return;
          this.syncing = null;
          this._loading.set(false);
          if (this.syncAgain) {
            this.syncAgain = false;
            void this.sync();
          }
        }),
    };
    this.syncing = current;
    return current.done;
  }

  /** «Показать ещё»: следующая страница после последнего в списке. */
  async loadMore(): Promise<void> {
    const id = this.userId();
    const last = this._items()[this._items().length - 1];
    if (!id || !last || !this._hasMore() || this._loading()) return;
    this._loading.set(true);
    try {
      const page = await this.api.notifications({ limit: PAGE, before: last.id });
      if (this.userId() !== id) return;
      this._items.set(merge(this._items(), page.items));
      this._hasMore.set(page.hasMore);
      this._unread.set(page.unread);
    } catch {
      // Не догрузилось — кнопка остаётся, можно нажать ещё раз
    } finally {
      if (this.userId() === id) this._loading.set(false);
    }
  }

  markRead(ids: string[]): Promise<void> {
    const unread = new Set(this._items().filter((n) => !n.readAt && ids.includes(n.id)).map((n) => n.id));
    if (!unread.size) return Promise.resolve();
    return this.read({ ids: [...unread] }, (n) => unread.has(n.id), unread.size);
  }

  /** Прочитать всё по замечанию. Непрочитанные могут лежать и дальше загруженной страницы — тогда тоже спрашиваем сервер. */
  markRemark(remarkId: string): Promise<void> {
    const local = this._items().filter((n) => !n.readAt && n.remark.id === remarkId).length;
    const beyondPage = this._hasMore() && this._unread() > this._items().filter((n) => !n.readAt).length;
    if (!local && !beyondPage) return Promise.resolve();
    return this.read({ remarkId }, (n) => n.remark.id === remarkId, local);
  }

  markAll(): Promise<void> {
    if (!this._unread()) return Promise.resolve();
    return this.read({ all: true }, () => true, this._unread());
  }

  /** Эта вкладка показывает карточку: её уведомления читаются сразу и не звучат. null — карточку закрыли. */
  viewing(remarkId: string | null): void {
    this.viewingId = remarkId;
    if (remarkId) this.readViewing();
  }

  /** Закрыли именно эту карточку (следующая могла уже объявить себя). */
  stopViewing(remarkId: string): void {
    if (this.viewingId === remarkId) this.viewingId = null;
  }

  /** Уведомление открывают из колокольчика или системного уведомления. */
  open(n: NotificationView): void {
    void this.markRead([n.id]);
    if (!n.remark.readable) return;
    if (this.session.isMember(n.project.id)) this.session.selectProject(n.project.id);
    void this.router.navigate(links.remark(n.project.slug, n.remark.roundNumber, n.remark.number));
  }

  private onNew(e: NewEvent): void {
    if (!this.userId() || !Array.isArray(e.items)) return;
    const known = new Set(this._items().map((n) => n.id));
    this.noteDuringSync(e.items.map((n) => n.id));
    this._items.set(merge(this._items(), e.items));
    if (typeof e.unread === 'number') this._unread.set(e.unread);
    this._loaded.set(true);
    let fresh = e.items.filter((n) => !known.has(n.id) && !n.readAt);
    // Событие по карточке, открытой в видимой вкладке, прочитано сразу и без звука
    if (this.viewingId && document.visibilityState === 'visible') {
      const seen = fresh.filter((n) => n.remark.id === this.viewingId);
      if (seen.length) {
        this.attention.seenHere(seen);
        fresh = fresh.filter((n) => n.remark.id !== this.viewingId);
        void this.markRemark(this.viewingId);
      }
    }
    if (fresh.length) this.attention.notify(sortNewest(fresh), (n) => this.open(n));
  }

  /** Прочитали в другой вкладке или на другом устройстве. */
  private onRead(e: ReadEvent): void {
    if (!this.userId()) return;
    this.noteDuringSync([]);
    const ids = e.ids ? new Set(e.ids) : null;
    const hit = (n: NotificationView): boolean => !!e.all || (ids?.has(n.id) ?? false) || (!!e.remarkId && n.remark.id === e.remarkId);
    this.applyRead(hit);
    if (typeof e.unread === 'number') this._unread.set(e.unread);
  }

  /** Оптимистично: сразу прочитано, ответ сервера уточняет число; сбой — сверка. */
  private async read(body: NotificationsReadBody, hit: (n: NotificationView) => boolean, count: number): Promise<void> {
    const id = this.userId();
    if (!id) return;
    this.applyRead(hit);
    this._unread.update((n) => Math.max(0, n - count));
    try {
      const res = await this.api.readNotifications(body);
      if (this.userId() === id) this._unread.set(res.unread);
    } catch {
      if (this.userId() === id) void this.sync();
    }
  }

  /** Толчок во время сверки: её ответ может оказаться старше толчка — сверимся ещё раз после неё. */
  private noteDuringSync(ids: string[]): void {
    if (!this.syncing) return;
    for (const id of ids) this.pushed.add(id);
    this.syncAgain = true;
  }

  private applyRead(hit: (n: NotificationView) => boolean): void {
    const at = new Date().toISOString();
    this._items.update((list) => (list.some((n) => !n.readAt && hit(n)) ? list.map((n) => (!n.readAt && hit(n) ? { ...n, readAt: at } : n)) : list));
  }

  /** Карточка открыта, но читается только видимая вкладка: в фоне человек её не видит. */
  private readViewing(): void {
    if (this.viewingId && document.visibilityState === 'visible') void this.markRemark(this.viewingId);
  }

  private reset(): void {
    this._items.set([]);
    this._unread.set(0);
    this._hasMore.set(false);
    this._loaded.set(false);
    this._loading.set(false);
    this.syncing = null;
    this.syncAgain = false;
    this.pushed.clear();
    this.replaceNext = false;
    this.lastSync = 0;
  }

  private poll(on: boolean): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!on) return;
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.sync();
    }, POLL_MS);
  }
}

/** Новые сверху: (время, id) по убыванию — тот же порядок, что у сервера. */
function isOlder(a: NotificationView, b: NotificationView): boolean {
  return a.at < b.at || (a.at === b.at && a.id < b.id);
}

function sortNewest(list: NotificationView[]): NotificationView[] {
  return [...list].sort((a, b) => (isOlder(a, b) ? 1 : isOlder(b, a) ? -1 : 0));
}

/** Слияние по id: пришедшее заменяет своё (статус замечания, прочтение), остальное остаётся. */
function merge(current: NotificationView[], incoming: NotificationView[]): NotificationView[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const n of incoming) byId.set(n.id, n);
  return sortNewest([...byId.values()]);
}
