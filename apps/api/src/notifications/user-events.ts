import { Injectable } from '@nestjs/common';
import type { NotificationView } from './notification.view';

/** docs/WS.md, персональная комната `user:{id}` (ADR 016): сервер → клиент. Сокет — только толчок, правда — строки в БД. */
export type UserEvent =
  | { type: 'notification.new'; items: NotificationView[]; unread: number }
  | { type: 'notification.read'; unread: number; ids?: string[]; remarkId?: string; all?: true }
  /** Состояние могло разойтись (убрали из проекта, сменили роль): клиент перечитывает список по REST. */
  | { type: 'notification.sync' };

export type UserListener = (userId: string, event: UserEvent) => void;

/**
 * Шина личных событий, как RunEvents для комнаты замечания: NotificationsService пишет сюда, WS-гейтвей раздаёт
 * в комнату `user:{id}`. В памяти процесса — один инстанс API (docs/ARCHITECTURE.md «Один инстанс API»).
 */
@Injectable()
export class UserEvents {
  private readonly listeners = new Set<UserListener>();

  emit(userId: string, event: UserEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(userId, event);
      } catch {
        /* слушатель не должен ронять запись */
      }
    }
  }

  on(fn: UserListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
