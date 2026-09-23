import type { RemarkStatus, Role } from '@remarkround/db';

/**
 * Кому и что сообщает строка истории (ADR 016). Правило ищется по action, а не по конечному статусу: `retest` и
 * `cancel` тоже заканчиваются в `ready_for_retest`, но «можно смотреть снова» заказчику говорит только «Готово»
 * разработчика. Автор действия и отключённые люди исключаются при рассылке (NotificationsService.record), здесь их нет.
 */

/** Сторона адресата: legacy-роль `admin` в проекте получает то же, что руководитель приёмки. */
export type AudienceGroup = 'pm' | 'developer' | 'business';

/** `action` — «ждёт вас» (очередь человека), `info` — «к сведению». */
export type NotificationKind = 'action' | 'info';

export type Audience = Partial<Record<AudienceGroup, NotificationKind>>;

type Rule = (from: RemarkStatus | null, to: RemarkStatus) => Audience;

const NOBODY: Audience = {};

/** Правила по действию истории; действий вне этого списка (create, import, triage, retest, cancel …) колокольчик не знает. */
const RULES: Record<string, Rule> = {
  // Модель предложила — решение за руководителем приёмки
  proposal: (_from, to) => (to === 'awaiting_pm' ? { pm: 'action' } : NOBODY),
  verdict: (from, to) => {
    if (to === 'defect' && (from === 'awaiting_pm' || from === 'unspecified')) return { developer: 'action', business: 'info' };
    if (to === 'change_request' || to === 'duplicate') return { business: 'info' };
    if (to === 'unspecified' || to === 'cannot_tell') return { business: 'action' };
    return NOBODY;
  },
  // «Готово» разработчика: заказчик закрывает сразу или прикладывает новый кадр (ADR 010)
  ready_for_retest: (_from, to) => (to === 'ready_for_retest' ? { business: 'action' } : NOBODY),
  // Кадры сравнили: актора нет, поэтому приходит и тому заказчику, кто приложил кадр
  retest_result: (_from, to) => (to === 'awaiting_business_close' ? { business: 'action' } : NOBODY),
  not_fixed: (_from, to) => (to === 'defect' ? { developer: 'action', business: 'info' } : NOBODY),
  close: (_from, to) => (to === 'closed' ? { business: 'info' } : NOBODY),
};

/** Действия истории, о которых кто-то узнаёт из колокольчика: у каждого есть фраза в web copy.ts (labels.contract.spec). */
export const NOTIFY_ACTIONS: readonly string[] = Object.keys(RULES);

export function audience(action: string, from: RemarkStatus | null, to: RemarkStatus): Audience {
  return RULES[action]?.(from, to) ?? NOBODY;
}

export function groupOf(role: Role): AudienceGroup {
  return role === 'admin' ? 'pm' : role;
}

/** Роли проекта, которым уходит событие: сторона `pm` — это pm и legacy admin. */
export function rolesFor(a: Audience): Role[] {
  return (Object.keys(a) as AudienceGroup[]).flatMap((g): Role[] => (g === 'pm' ? ['pm', 'admin'] : [g]));
}

/** Вид уже записанной строки: из правил и роли адресата; правило с тех пор поменялось — «к сведению». */
export function kindFor(change: { action: string; fromStatus: RemarkStatus | null; toStatus: RemarkStatus }, role: Role): NotificationKind {
  return audience(change.action, change.fromStatus, change.toStatus)[groupOf(role)] ?? 'info';
}
