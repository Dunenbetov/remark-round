/**
 * Все русские строки интерфейса. Источник — docs/ui/COPY.md (дословно) и дизайн RemarkRound.dc.html.
 * Синонимы запрещены: не Approve/Reject/Submit/Ticket.
 */
import type { DocumentStatus, Phase, RemarkStatus, Role, VerdictCode } from './models';

export const APP_NAME = 'RemarkRound';
export const TAGLINE = 'Журнал замечаний как дело из улик';

export const ROLE_TITLE: Record<Role, string> = {
  business: 'Вы принимаете работу',
  pm: 'Вы решаете, работа ли это',
  developer: 'Вам передали в работу',
  admin: 'Настройка проекта',
};

export const STATUS_LABEL: Record<RemarkStatus, string> = {
  imported: 'Получено',
  needs_human_parse: 'Допишите строку журнала',
  triaging: 'Разбираем',
  awaiting_pm: 'Ждёт вашего решения',
  defect: 'В работе',
  change_request: 'Новое желание',
  unspecified: 'Нужно ваше решение',
  duplicate: 'Повтор',
  cannot_tell: 'Не хватает скрина',
  ready_for_retest: 'Можно смотреть снова',
  awaiting_business_close: 'Ждёт закрытия',
  closed: 'Закрыто',
  reopened: 'Открыли снова',
};

export type PillTone = 'wait' | 'work' | 'muted' | 'ok' | 'danger';

export const STATUS_TONE: Record<RemarkStatus, PillTone> = {
  imported: 'muted',
  needs_human_parse: 'danger',
  triaging: 'work',
  awaiting_pm: 'wait',
  defect: 'work',
  change_request: 'muted',
  unspecified: 'wait',
  duplicate: 'muted',
  cannot_tell: 'wait',
  ready_for_retest: 'work',
  awaiting_business_close: 'wait',
  closed: 'ok',
  reopened: 'wait',
};

export const PHASE_TEXT: Record<Phase, string> = {
  retrieving: 'Смотрим документы проекта…',
  vision: 'Смотрим скрин…',
  binding: 'Ищем место в ТЗ…',
  rebinding: 'Ищем другое место в ТЗ…',
  drafting: 'Готовим черновик…',
  awaiting_pm: 'Ждём вашего решения',
  diffing: 'Сравниваем кадры…',
  awaiting_business_close: 'Ждём, подтвердите исправление',
  persisted: 'Записали решение',
  failed: 'Не получилось разобрать. Можно запустить снова',
};

export const PHASE_EXTRA = {
  retry: 'Запустить снова',
  awaitingShot: 'Ждём скрин',
  awaitingNewShot: 'Ждём, прикрепите новый кадр',
  inDevWith: (name: string) => `В работе у ${name}`,
  /** Фаза для того, кто не принимает решение на этой карточке. */
  awaitingPmOther: 'Ждём решения руководителя приёмки',
  awaitingBusinessOther: 'Ждём решения заказчика',
  closedAt: (name: string, at: string) => `Закрыто · ${name} · ${at}`,
};

/** Пояснение диффа в мок-ретесте (дизайн, артборд 5). */
export const RETEST_EXPLANATION = 'Красное на диффе: область кнопки «Сохранить», теперь синяя. Остальное без изменений.';

/** Кнопки решения PM — порядок канонический, сверху вниз. */
export const PM_VERDICTS: ReadonlyArray<{ code: VerdictCode; label: string; primary?: boolean }> = [
  { code: 'defect', label: 'В работу разработчикам', primary: true },
  { code: 'change_request', label: 'Новое желание, не в этом ТЗ' },
  { code: 'unspecified', label: 'В документах нет ответа — решите вы' },
  { code: 'cannot_tell', label: 'Не хватает скрина' },
  { code: 'rejected_binding', label: 'Не та цитата из ТЗ' },
];

export const VERDICT_LABEL: Record<VerdictCode, string> = {
  defect: 'В работу разработчикам',
  change_request: 'Новое желание, не в этом ТЗ',
  unspecified: 'В документах нет ответа — решите вы',
  duplicate: 'Повтор',
  cannot_tell: 'Не хватает скрина',
  rejected_binding: 'Не та цитата из ТЗ',
};

export const DECISION = {
  title: 'Ваше решение',
  commentLabel: 'Комментарий (необязательно, для «не та цитата» — обязательно)',
  commentLabelShort: 'Комментарий (необязательно)',
  commentRequired: 'Для «не та цитата» нужен комментарий: где в ТЗ искать.',
  waitDraft: 'Кнопки станут доступны, когда черновик будет готов.',
  waitFrame: 'Кнопки станут доступны после нового кадра.',
  onlyBusinessCloses: 'Закрыть замечание может только тот, кто принимает работу.',
  record: 'Решение:',
  change: 'Изменить решение',
  closeFixed: 'Закрыть: исправлено',
  notFixed: 'Не исправлено',
  attachShot: 'Прикрепить скрин',
  attachFooterHint: 'Любая страница с футером, целиком.',
  attachNewFrame: 'Прикрепите новый кадр этого экрана.',
  readyForRetest: 'Готово, можно смотреть снова',
  closedRecord: 'Закрыто',
};

export const CARD = {
  evidence: 'Улики',
  draft: 'Черновик разбора',
  seen: 'На скрине видно:',
  openDocument: 'Открыть документ',
  noShot: 'Скрина нет',
  refuse: 'Не могу разобрать. Пришлите скрин этого экрана.',
  refuseWhy: 'Для претензии про цвет или вёрстку нужен скрин: без него не сравнить с ТЗ.',
  before: 'Было',
  after: 'Стало',
  diff: 'Дифф',
  compareHint: 'Сравним новый кадр с этим и покажем дифф.',
  likelyAddressed: 'Похоже, исправлено.',
  likelyUnchanged: 'Похоже, не изменилось.',
  cannotCompare: 'Не могу сравнить кадры.',
  linkDuplicate: (n: number) => `Связать с №${n}`,
  where: 'Где:',
  addedBy: (name: string) => `Добавила ${name}`,
  fixedBy: (name: string) => `Исправил ${name}`,
  back: '← Журнал раунда',
  backDev: '← В работу',
  frame: 'Кадр',
  viewerClose: 'Закрыть',
  awaitingPmNote: 'Решение принимает руководитель приёмки.',
};

export const JOURNAL = {
  columns: ['№', 'Суть', 'Скрин', 'Черновик', 'Статус'] as const,
  chips: ['Ждут меня', 'Все', 'В работе', 'Новые желания', 'На ретесте', 'Дописать из журнала'] as const,
  summary: (total: number, waiting: number) => `${total} ${plural(total, 'замечание', 'замечания', 'замечаний')}, ${waiting} ${waiting === 1 ? 'ждёт' : 'ждут'} вас`,
  emptyFilter: 'Нет строк, которые нужно дописать.',
};

export type JournalChip = (typeof JOURNAL.chips)[number];

export const NAV = {
  documents: 'Документы',
  journal: 'Журнал',
  import: 'Импорт',
  dev: 'В работу',
  addRemark: 'Добавить замечание',
  logout: 'Выйти',
  switchUser: 'Сменить пользователя',
};

export const PRESENCE = {
  watching: (name: string, roleGenitive: string) => `Смотрит: ${name} · ${roleGenitive}`,
};

export const ROLE_GENITIVE: Record<Role, string> = {
  business: 'принимает работу',
  pm: 'решает, работа ли это',
  developer: 'разработчик',
  admin: 'настраивает проект',
};

/** Присутствие до фазы 6 (WS presence) — демо-значение для экранов PM. */
export const PRESENCE_DEMO = { initial: 'А', name: 'Айгерим', roleGenitive: 'принимает работу' };

export const LOGIN_EXTRA = { demoPassword: 'пароль remarkround' };

export const EMPTY = {
  noSpec: 'Сначала загрузите ТЗ — без него разбирать замечания не будем.',
  noRemarks: 'Замечаний пока нет. Добавьте с экрана или загрузите журнал по шаблону.',
  needShot: 'Для претензии про цвет или вёрстку нужен скрин.',
  importUnparsed: 'Эти строки не разобрали. Допишите сами — мы ничего не выдумываем.',
  devEmpty: 'Пока ничего не передали в работу.',
  noAccess: 'Нет доступа',
};

export const DEV_QUEUE = {
  subtitle: 'Сюда не попадают желания и дыры в ТЗ, пока руководитель приёмки не решил иначе.',
};

export const IMPORT = {
  title: 'Журнал замечаний из файла',
  drop: 'Перетащите файл журнала сюда',
  dropHint: '.xlsx или .csv по шаблону',
  template: 'Скачать шаблон журнала',
  upload: 'Загрузить файл',
  after: (fileName: string) => `После загрузки · ${fileName}`,
  summary: (parsed: number, total: number, bad: number) =>
    `Разобрали ${parsed} из ${total}. ${capitalize(numWord(bad, 'f'))} ${plural(bad, 'строку', 'строки', 'строк')} нужно дописать.`,
  rowPlaceholder: 'Опишите, что не так и где',
  rowLink: (row: number, n: number) => `строка ${row} → №${n}`,
  save: 'Сохранить строки',
  received: 'Получено',
};

export const DOCUMENTS = {
  title: 'Пакет документов проекта',
  upload: 'Загрузить документ',
  columns: ['Тип', 'Дата', 'Страниц', 'Статус'] as const,
  pages: (n: number) => `${n} стр`,
};

export const DOC_STATUS_LABEL: Record<DocumentStatus, string> = {
  uploaded: 'Загружено',
  parsed: 'Читаем документ…',
  indexed: 'Готово к поиску',
  failed: 'Не удалось',
};

export const DOC_STATUS_TONE: Record<DocumentStatus, PillTone> = {
  uploaded: 'muted',
  parsed: 'wait',
  indexed: 'ok',
  failed: 'danger',
};

export const NEW_REMARK = {
  title: 'Новое замечание',
  what: 'Что не так',
  whatPlaceholder: 'Например: на странице «Профиль компании» кнопка «Сохранить» серая, хотя поля заполнены',
  where: 'Где',
  wherePlaceholder: 'Страница или экран',
  expected: 'Как должно быть',
  expectedPlaceholder: 'Если знаете: как по ТЗ или по договорённости',
  attach: 'Прикрепить скрин',
  replace: 'Заменить',
  cancel: 'Отмена',
  save: 'Сохранить',
  shotMeta: 'profil-kompanii.png · 1440×900',
};

export const LOGIN = {
  email: 'E-mail',
  password: 'Пароль',
  submit: 'Войти',
  unknown: 'Такого пользователя нет',
  demoHint: 'Демо-входы:',
};

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

function numWord(n: number, gender: 'f' | 'm'): string {
  const f = ['ноль', 'одну', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять'];
  const m = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять'];
  const words = gender === 'f' ? f : m;
  return n >= 0 && n < words.length ? words[n]! : String(n);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
