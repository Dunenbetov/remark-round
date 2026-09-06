import type { RemarkStatus, VerdictCode } from '@remarkround/db';

/**
 * Русские подписи для выгрузки раунда (docs/ui/COPY.md, apps/web/src/app/core/copy.ts — те же слова, что видит человек
 * на экране). Коды на экран не выходят; здесь они нужны, потому что xlsx для заказчика собирает сервер.
 */
export const STATUS_LABEL_RU: Record<RemarkStatus, string> = {
  imported: 'Получено',
  needs_human_parse: 'Допишите строку журнала',
  triaging: 'Разбираем',
  awaiting_pm: 'Ждёт решения руководителя приёмки',
  defect: 'В работе',
  change_request: 'Новое желание',
  unspecified: 'Нужно решение заказчика',
  duplicate: 'Повтор',
  cannot_tell: 'Не хватает скрина',
  ready_for_retest: 'Можно смотреть снова',
  awaiting_business_close: 'Ждёт закрытия',
  closed: 'Закрыто',
  reopened: 'Открыли снова',
};

export const VERDICT_LABEL_RU: Record<VerdictCode, string> = {
  defect: 'В работу разработчикам',
  change_request: 'Новое желание, не в этом ТЗ',
  unspecified: 'В документах нет ответа — решает заказчик',
  duplicate: 'Повтор',
  cannot_tell: 'Не хватает скрина',
  rejected_binding: 'Не та цитата из ТЗ',
};

/** Статусы, в которых замечание больше ничего не ждёт: только с ними раунд можно закрыть. */
export const TERMINAL_STATUSES: ReadonlySet<RemarkStatus> = new Set<RemarkStatus>(['closed', 'change_request', 'duplicate']);
