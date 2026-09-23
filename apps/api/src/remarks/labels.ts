import type { ProposedClass, RemarkStatus, RetestOutcome, Role, VerdictCode } from '@remarkround/db';

/**
 * Русские подписи для выгрузки раунда (docs/ui/COPY.md, apps/web/src/app/core/copy.ts — те же слова, что видит человек
 * на экране). Коды на экран не выходят; здесь они нужны, потому что xlsx для заказчика собирает сервер.
 * Контракт с фронтом: ключи STATUS_LABEL_RU и web STATUS_LABEL совпадают (labels.contract.spec); тексты могут расходиться
 * осознанно — в xlsx нет «вы» («Ждёт вашего решения» на экране → «Ждёт решения руководителя приёмки» в файле).
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

/** Что предложила модель — для истории замечания. */
export const PROPOSED_LABEL_RU: Record<ProposedClass, string> = {
  defect_candidate: 'Похоже на дефект',
  change_request_candidate: 'Похоже на новое желание',
  unspecified: 'В документах нет ответа',
  duplicate: 'Повтор',
  cannot_tell: 'Не хватает скрина',
};

/** Статусы, в которых замечание больше ничего не ждёт: только с ними раунд можно закрыть. */
export const TERMINAL_STATUSES: ReadonlySet<RemarkStatus> = new Set<RemarkStatus>(['closed', 'change_request', 'duplicate']);

/** Роль рядом с именем — как на карточке («Дана (руководитель приёмки)»). */
export const ROLE_LABEL_RU: Record<Role, string> = {
  business: 'заказчик',
  pm: 'руководитель приёмки',
  developer: 'разработчик',
  admin: 'админ',
};

/** Итог сравнения кадров от модели — не «исправлено», а пояснение для заказчика. */
export const RETEST_OUTCOME_RU: Record<RetestOutcome, string> = {
  likely_addressed: 'Похоже, исправлено',
  likely_unchanged: 'Похоже, без изменений',
  cannot_tell: 'По кадрам не понять',
};

/** Подписи действий истории — те же слова, что в разделе «История» на карточке (core/copy.ts HISTORY_ACTION). */
export const HISTORY_ACTION_RU: Record<string, string> = {
  create: 'Замечание создано',
  import: 'Импортировано из журнала',
  reopen: 'Претензия открыта снова',
  reopened_as: 'Претензию предъявили снова',
  fix_row: 'Строка журнала дописана',
  attach_screenshot: 'Скрин приложен',
  triage: 'Разбор запущен',
  proposal: 'Модель предложила',
  rejected_binding: 'Не та цитата — разбор снова',
  verdict: 'Решение',
  link_duplicate: 'Связано с оригиналом',
  ready_for_retest: 'Разработчик: готово',
  retest: 'Кадр для ретеста приложен',
  retest_result: 'Кадры сравнили',
  close: 'Закрыто после ретеста',
  not_fixed: 'Не исправлено — снова в работу',
  cancel: 'Разбор остановлен',
  run_failed: 'Разбор не удался',
};

/** Закрытие сразу после «Готово» (ADR 010): подпись строки `close` зависит от того, откуда закрыли. */
export const CLOSE_CHECKED_RU = 'Закрыто без нового кадра: заказчик проверил сам';

/** Отмена ретеста (строка `cancel` из ready_for_retest / awaiting_business_close): кадр «Стало» снят, в истории остался. */
export const CANCEL_RETEST_RU = 'Ретест отменён: кадр «Стало» снят';

export const ROUND_EVENT_RU: Record<string, string> = {
  open: 'Раунд открыт',
  close: 'Раунд закрыт',
  reopen: 'Раунд открыт снова',
};
