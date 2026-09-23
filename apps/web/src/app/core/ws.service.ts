import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import type { JoinAck, Phase, Presence, Remark, ServerEvent } from './models';
import { SessionService } from './session.service';

/** Тот же путь, что у REST: nginx и dev-прокси проксируют одно место (apps/api/src/gateway). */
const WS_PATH = '/api/v1/ws';

/** Сервер выкинул сокет (смена пароля, отключение): одна попытка с токеном из сессии через столько. */
const RETRY_AFTER_KICK_MS = 2000;
/** Не чаще одной такой попытки за это время — чтобы «выкинул → вошёл → выкинул» не стало циклом. */
const KICK_RETRY_WINDOW_MS = 30_000;

type CommandAck = { ok: true; remark: Remark } | { ok: false; status: number; message: string };
type ServerEventType = ServerEvent['type'];
type EventOf<T extends ServerEventType> = Extract<ServerEvent, { type: T }>;

/** События комнаты замечания — уходят подписчикам join(). */
const ROOM_EVENTS = new Set<string>(['run.phase', 'run.token', 'run.citations', 'run.proposal', 'run.persisted', 'run.cancelled', 'run.failed', 'presence', 'remark.advice']);
/** События личной комнаты `user:{id}` (ADR 016) — уходят подписчикам on(). */
const USER_EVENTS = new Set<string>(['notification.new', 'notification.read', 'notification.sync']);

interface RoomJoin {
  projectId: string;
  remarkId: string;
  onEvent: (e: ServerEvent) => void;
  onJoined?: (ack: JoinAck) => void;
}

/**
 * Один сокет на вкладку (docs/WS.md), тот же JWT. Сервер сам кладёт сокет в личную комнату `user:{id}` (уведомления),
 * карточка входит в комнату замечания через join(). Комнаты и подписчики живут в реестре сервиса, а не на сокете:
 * после смены токена или переподключения они переезжают на новый сокет сами. Нет сокета — карточка ходит REST.
 */
@Injectable({ providedIn: 'root' })
export class WsService {
  private readonly session = inject(SessionService);
  private socket: Socket | null = null;
  private token: string | null = null;
  private readonly _connected = signal(false);
  readonly connected = computed(() => this._connected());

  private readonly rooms = new Set<RoomJoin>();
  private readonly listeners = new Map<string, Set<(e: ServerEvent) => void>>();
  private readonly connectFns = new Set<() => void>();
  private kickTimer: ReturnType<typeof setTimeout> | undefined;
  private lastKickRetry = 0;

  constructor() {
    // Выход — закрыть сокет; новый токен (вход другим человеком, смена пароля) — переподключиться, если сокет уже нужен
    effect(() => {
      const token = this.session.token();
      untracked(() => {
        if (!token) this.dispose();
        else if (this.socket && token !== this.token) this.open(token);
      });
    });
  }

  /** Подключиться сейчас (после входа): личная комната нужна и без открытой карточки. */
  connect(): void {
    this.ensure();
  }

  /** Подписка на событие сервера (уведомления) до вызова возвращённой функции; переживает смену сокета. */
  on<T extends ServerEventType>(type: T, fn: (e: EventOf<T>) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    const handler = fn as (e: ServerEvent) => void;
    set.add(handler);
    return () => void set.delete(handler);
  }

  /** Каждое подключение, включая переподключение: момент сверить состояние по REST. */
  onConnect(fn: () => void): () => void {
    this.connectFns.add(fn);
    return () => void this.connectFns.delete(fn);
  }

  /**
   * Войти в комнату: события до вызова возвращённой функции. После реконнекта и смены токена join повторяется сам.
   * `onJoined` получает ack: текущий прогон и кто ещё смотрит карточку.
   */
  join(projectId: string, remarkId: string, onEvent: (e: ServerEvent) => void, onJoined?: (ack: JoinAck) => void): () => void {
    const socket = this.ensure();
    if (!socket) return () => undefined;
    const entry: RoomJoin = { projectId, remarkId, onEvent, onJoined };
    this.rooms.add(entry);
    if (socket.connected) this.emitJoin(socket, entry);
    return () => {
      if (!this.rooms.delete(entry)) return;
      const current = this.socket;
      // Та же карточка могла войти ещё раз (новый join раньше старого leave) — тогда комнату не покидаем
      const stillThere = [...this.rooms].some((r) => r.remarkId === remarkId);
      if (current?.connected && !stillThere) current.emit('leave', { remarkId });
    };
  }

  /** Команда в комнату с ack; если сокета нет — `fallback` (REST). Ошибка сервера — как HttpErrorResponse для стора. */
  async command(event: 'verdict.approve' | 'verdict.reject_binding' | 'run.cancel', body: Record<string, unknown>, fallback: () => Promise<Remark>): Promise<Remark> {
    const socket = this.ensure();
    if (!socket?.connected) return fallback();
    const ack = await new Promise<CommandAck | null>((resolve) => {
      socket.timeout(15000).emit(event, body, (err: Error | null, res: CommandAck) => resolve(err ? null : res));
    });
    if (!ack) return fallback();
    if (!ack.ok) throw { status: ack.status, error: { message: ack.message } };
    return ack.remark;
  }

  private ensure(): Socket | null {
    const token = this.session.token();
    if (!token) {
      this.dispose();
      return null;
    }
    if (this.socket && this.token === token) return this.socket;
    this.open(token);
    return this.socket;
  }

  /** Новый сокет с этим токеном; реестр комнат и подписчиков остаётся — join повторится на connect. */
  private open(token: string): void {
    this.close();
    this.token = token;
    const socket = io({ path: WS_PATH, auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      if (this.socket !== socket) return;
      this._connected.set(true);
      for (const room of this.rooms) this.emitJoin(socket, room);
      for (const fn of [...this.connectFns]) fn();
    });
    socket.on('disconnect', (reason) => {
      if (this.socket !== socket) return;
      this._connected.set(false);
      // Сервер закрыл сокет сам — клиент socket.io в этом случае не переподключается
      if (reason === 'io server disconnect') this.retryAfterKick(socket);
    });
    // Отказ middleware (токен не принят) — сам клиент не повторяет, и мы тоже: сокета нет, работает REST
    socket.on('connect_error', () => {
      if (this.socket === socket) this._connected.set(false);
    });
    socket.onAny((type: string, payload: unknown) => {
      if (this.socket === socket) this.dispatch(type, payload);
    });
    this.socket = socket;
  }

  private dispatch(type: string, payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const event = { ...(payload as object), type } as ServerEvent;
    if (ROOM_EVENTS.has(type)) {
      for (const room of [...this.rooms]) room.onEvent(event);
      return;
    }
    if (!USER_EVENTS.has(type)) return;
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }

  private emitJoin(socket: Socket, room: RoomJoin): void {
    socket.emit('join', { projectId: room.projectId, remarkId: room.remarkId }, (ack: JoinAck) => {
      if (this.rooms.has(room)) room.onJoined?.(ack);
    });
  }

  /** Одна попытка через 2 с, токен — из сессии (после смены пароля он уже новый), без REST. */
  private retryAfterKick(socket: Socket): void {
    if (Date.now() - this.lastKickRetry < KICK_RETRY_WINDOW_MS) return;
    this.lastKickRetry = Date.now();
    clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => {
      if (this.socket !== socket || socket.connected) return;
      const token = this.session.token();
      if (!token) return;
      if (token !== this.token) this.open(token);
      else socket.connect();
    }, RETRY_AFTER_KICK_MS);
  }

  private close(): void {
    clearTimeout(this.kickTimer);
    const socket = this.socket;
    this.socket = null;
    this.token = null;
    this._connected.set(false);
    if (socket) {
      socket.offAny();
      socket.removeAllListeners();
      socket.disconnect();
    }
  }

  /** Выход: сокет закрыт; подписчики сервисов остаются и получат события следующего входа. */
  private dispose(): void {
    this.close();
  }
}

export function initialPhase(remark: Pick<Remark, 'runMode'>): Phase {
  return remark.runMode === 'retest' ? 'diffing' : 'retrieving';
}

export type { Presence };
