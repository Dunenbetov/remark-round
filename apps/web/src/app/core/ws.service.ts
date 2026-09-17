import { Injectable, computed, inject, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import type { JoinAck, Phase, Presence, Remark, ServerEvent } from './models';
import { SessionService } from './session.service';

/** Тот же путь, что у REST: nginx и dev-прокси проксируют одно место (apps/api/src/gateway). */
export const WS_PATH = '/api/v1/ws';

export type CommandAck = { ok: true; remark: Remark } | { ok: false; status: number; message: string };

const SERVER_EVENTS = new Set(['run.phase', 'run.token', 'run.citations', 'run.proposal', 'run.persisted', 'run.cancelled', 'run.failed', 'presence', 'remark.advice']);

/**
 * Комната замечания (docs/WS.md): один сокет на вкладку, тот же JWT, join по remarkId.
 * Сервер шлёт фазы прогона, клиент — вердикты и run.cancel в тот же run. Нет сокета — карточка ходит REST.
 */
@Injectable({ providedIn: 'root' })
export class WsService {
  private readonly session = inject(SessionService);
  private socket: Socket | null = null;
  private token: string | null = null;
  private readonly _connected = signal(false);
  readonly connected = computed(() => this._connected());

  /**
   * Войти в комнату: события до вызова возвращённой функции. После реконнекта join повторяется сам.
   * `onJoined` получает ack: текущий прогон и кто ещё смотрит карточку.
   */
  join(projectId: string, remarkId: string, onEvent: (e: ServerEvent) => void, onJoined?: (ack: JoinAck) => void): () => void {
    const socket = this.ensure();
    if (!socket) return () => undefined;
    const handler = (type: string, payload: unknown): void => {
      if (SERVER_EVENTS.has(type) && payload && typeof payload === 'object') onEvent({ ...(payload as object), type } as ServerEvent);
    };
    const doJoin = (): void => {
      socket.emit('join', { projectId, remarkId }, (ack: JoinAck) => onJoined?.(ack));
    };
    socket.onAny(handler);
    socket.on('connect', doJoin);
    if (socket.connected) doJoin();
    return () => {
      socket.offAny(handler);
      socket.off('connect', doJoin);
      if (socket.connected) socket.emit('leave', { remarkId });
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
    this.dispose();
    this.token = token;
    const socket = io({ path: WS_PATH, auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => this._connected.set(true));
    socket.on('disconnect', () => this._connected.set(false));
    socket.on('connect_error', () => this._connected.set(false));
    this.socket = socket;
    return socket;
  }

  private dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.token = null;
    this._connected.set(false);
  }
}

export function initialPhase(remark: Pick<Remark, 'runMode'>): Phase {
  return remark.runMode === 'retest' ? 'diffing' : 'retrieving';
}

export type { Presence };
