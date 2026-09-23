import type { Prisma, RemarkStatus, Role } from '@remarkround/db';
import { canRead, historyActor, remarkTitle } from '../remarks/remark.dto';
import { kindFor, type NotificationKind } from './audience';

/**
 * Строка колокольчика (docs/API.md, ADR 016). Только событие, статус, кто и когда: ни комментария, ни пометки
 * истории, ни предложения модели, ни совета — ни для одной роли (ADR 007). Суть замечания (`title`) — только тому,
 * кто сейчас может открыть карточку.
 */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  /** ISO 8601 — момент события (строка истории). */
  at: string;
  readAt: string | null;
  project: { id: string; name: string; slug: string };
  remark: {
    id: string;
    number: number;
    roundNumber: number;
    /** null, если адресат сейчас не может открыть карточку (разработчик и ушедшее от него замечание). */
    title: string | null;
    /** Текущий статус, не статус на момент события. */
    status: RemarkStatus;
    readable: boolean;
  };
  event: { action: string; fromStatus: RemarkStatus | null; toStatus: RemarkStatus };
  /** Кто: имя снимком на момент действия (ADR 011) и роль; null — система (граф, сравнение кадров). */
  by: { name: string; role: Role | null } | null;
}

/** Что нужно представлению — одним запросом для списка и для толчка по сокету. Поля истории — без detail и comment. */
export const NOTIFICATION_SELECT = {
  id: true,
  userId: true,
  projectId: true,
  role: true,
  readAt: true,
  createdAt: true,
  project: { select: { id: true, name: true, slug: true } },
  remark: { select: { id: true, number: true, status: true, description: true, externalId: true, round: { select: { number: true } } } },
  change: { select: { action: true, fromStatus: true, toStatus: true, userId: true, actorName: true, role: true, createdAt: true, user: { select: { name: true } } } },
} satisfies Prisma.NotificationSelect;

export type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>;

/** Роль адресата — `row.role`: список и толчок отдают только строки текущей роли человека в проекте. */
export function toNotificationView(row: NotificationRow): NotificationView {
  const readable = canRead(row.role, row.remark.status);
  const actor = historyActor(row.change);
  return {
    id: row.id,
    kind: kindFor(row.change, row.role),
    at: row.change.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    project: { id: row.project.id, name: row.project.name, slug: row.project.slug },
    remark: {
      id: row.remark.id,
      number: row.remark.number,
      roundNumber: row.remark.round.number,
      title: readable ? remarkTitle(row.remark) : null,
      status: row.remark.status,
      readable,
    },
    event: { action: row.change.action, fromStatus: row.change.fromStatus, toStatus: row.change.toStatus },
    by: actor ? { name: actor.name, role: actor.role ?? null } : null,
  };
}
