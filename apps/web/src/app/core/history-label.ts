import { HISTORY_ACTION, NOTIFY, VERDICT_LABEL } from './copy';
import type { RemarkStatus, VerdictCode } from './models';

/** Переход замечания: строка истории карточки или событие уведомления. */
export interface HistoryEvent {
  action: string;
  fromStatus?: RemarkStatus | null;
  toStatus: RemarkStatus;
}

/** Подпись перехода в «Истории» карточки (ADR 011). Одна на карточку и колокольчик. */
export function historyLabel(e: HistoryEvent): string {
  // Закрытие сразу после «Готово» — без нового кадра, заказчик проверил сам (ADR 010)
  if (e.action === 'close' && e.fromStatus === 'ready_for_retest') return HISTORY_ACTION['close_checked']!;
  // Отмена ретеста (в том числе «Заменить кадр «Стало»») — не остановка разбора
  if (e.action === 'cancel' && (e.fromStatus === 'ready_for_retest' || e.fromStatus === 'awaiting_business_close')) return HISTORY_ACTION['cancel_retest']!;
  // «Кто кому направил»: решение PM называет вариант — «В работу разработчикам», «Новое желание…»
  if (e.action === 'verdict' && e.toStatus in VERDICT_LABEL) return `${HISTORY_ACTION['verdict']}: ${VERDICT_LABEL[e.toStatus as VerdictCode]}`;
  return HISTORY_ACTION[e.action] ?? e.action;
}

/** Фраза уведомления: как в истории, кроме `proposal` — руководителю приёмки важно, что разбор готов. */
export function notifyHeadline(e: HistoryEvent): string {
  return e.action === 'proposal' ? NOTIFY.proposal : historyLabel(e);
}
