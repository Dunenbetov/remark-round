/**
 * Все русские строки интерфейса. Источник — docs/ui/COPY.md (дословно) и дизайн RemarkRound.dc.html.
 * Синонимы запрещены: не Approve/Reject/Submit/Ticket.
 */
import type { DocumentKind, DocumentStatus, Phase, RemarkStatus, Role, Side, VerdictCode } from './models';

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
  stop: 'Остановить',
  awaitingShot: 'Ждём скрин',
  awaitingNewShot: 'Ждём, прикрепите новый кадр',
  inDevWith: (name: string) => `В работе у ${name}`,
  /** Фаза для того, кто не принимает решение на этой карточке. */
  awaitingPmOther: 'Ждём решения руководителя приёмки',
  awaitingBusinessOther: 'Ждём решения заказчика',
  closedAt: (name: string, at: string) => `Закрыто · ${name} · ${at}`,
  /** Ссылка на трейс прогона (Langfuse) — служебная, только PM. */
  trace: 'Трейс в Langfuse',
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
  /** Заголовки групп кнопок PM (редизайн «Инбокс приёмки»). */
  groups: { work: 'Это работа', notWork: 'Это не работа', needData: 'Нужны данные' },
  addComment: 'Добавить комментарий',
  next: (n: number, title: string) => `Следующее: № ${n} · ${title}`,
  nextShort: (n: number) => `Следующее → № ${n}`,
  nextNow: 'Решение уйдёт сразу',
  queueEmpty: 'Очередь пуста',
  toJournal: 'Вернуться в журнал',
  /** Подсказка клавиш под панелью — по режиму панели (DecisionMode в ui/decision-panel.ts). */
  keysHint: {
    'pm-full': '1–5 — решение · → следующее · Esc — отменить',
    'pm-two': '1–2 — решение · → следующее · Esc — отменить',
    'dev-advice': '1–5 — совет · C — комментарий · → следующее',
    attach: 'U — прикрепить скрин · → следующее',
    retest: '1 — закрыть · 2 — не исправлено · → следующее · Esc — отменить',
    'retest-wait': 'U — прикрепить новый кадр · → следующее',
    disabled: 'Кнопки станут доступны, когда черновик будет готов.',
    record: '→ следующее',
  } satisfies Record<'disabled' | 'pm-full' | 'pm-two' | 'dev-advice' | 'attach' | 'retest' | 'retest-wait' | 'record', string>,
  keysHintDev: '1 — готово · → следующее',
  /** Совет разработчика (режим dev-advice) и бейдж у варианта PM. Совет — не решение. */
  adviseTitle: 'Ваш совет',
  adviseEyebrow: 'Посоветуйте руководителю приёмки',
  adviseHint: 'Совет — не решение: руководитель приёмки увидит его рядом с вариантом, решает он.',
  yourAdvice: (label: string) => `Ваш совет: ${label}`,
  changeAdvice: 'Изменить',
  retractAdvice: 'Убрать',
  advises: (n: number, name: string) => (n === 1 ? `${name} советует` : `${n} ${plural(n, 'разработчик', 'разработчика', 'разработчиков')} советуют`),
  adviceMatched: 'Совет совпал ✓',
  adviceDiffered: (label: string) => `Ваш совет был: ${label}`,
  /** Цифра чернильного отсчёта перед отправкой решения. */
  seconds: (n: number) => String(n),
};

/** Очередь разбора: рельс слева от карточки и шаг «Начать разбор» в журнале. */
export const QUEUE = {
  title: 'Ждут вас',
  dev: 'В работе',
  of: (i: number, n: number) => `${i} из ${n}`,
  start: 'Начать разбор',
  prev: 'Предыдущее',
  next: 'Следующее',
  empty: 'Очередь пуста',
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
  /** Дифф построен, но про претензию ли красное — решает человек (пояснение модели — фаза 6). */
  diffReady: 'Кадры сравнили, разница на диффе.',
  linkDuplicate: (n: number) => `Связать с №${n}`,
  where: 'Где:',
  addedBy: (name: string) => `Автор: ${name}`,
  fixedBy: (name: string) => `Исправлено: ${name}`,
  /** «Business (заказчик)» — роль в скобках рядом с именем, когда она известна. */
  withRole: (name: string, role: string) => `${name} (${role})`,
  back: '← Журнал раунда',
  backDev: '← В работу',
  frame: 'Кадр',
  viewerClose: 'Закрыть',
  awaitingPmNote: 'Решение принимает руководитель приёмки.',
  zoomOpen: 'Открыть кадр',
  fromJournal: (id: string) => `Из журнала · ${id}`,
  severity: 'Важность:',
  /** Карточка строки без описания: ячейки из файла как есть, человек дописывает. */
  fixRowHint: 'Ячейки из файла оставили как есть. Опишите, что не так и где — и запустим разбор.',
  /** Блок улик и сцена сравнения (редизайн). */
  saidBy: 'Со слов заказчика',
  whatWrong: 'Что не так',
  noShotShort: 'Скрина нет',
  diffHint: 'Разница подсвечена',
  compare: 'Сравнить Было/Стало',
  measuring: 'Измеряем кадры…',
  /** Вид разработчика: цитата и действие вместо черновика. */
  specRequires: 'Что требует ТЗ',
  /** Бейдж у черновика, когда прогон шёл правилами без модели (LLM_MODE=rules или ключ не задан). */
  draftByRules: 'по правилам, без модели',
  /** Повтор претензии: подпись у карточки и кнопка у закрытого замечания (business). */
  originOf: (number: number, round: number) => `Повтор претензии №${number} из раунда ${round}`,
  reopenedIn: (number: number, round: number) => `Открыто снова: №${number} в раунде ${round}`,
  reopenIn: (round: number) => `Открыть снова в раунде ${round}`,
  reopenNoRound: 'Чтобы открыть снова, сначала создайте новый раунд',
  whatToDo: 'Что сделать',
  showFullDraft: 'Показать разбор целиком',
  hideFullDraft: 'Свернуть',
  pasteHint: 'перетащите, нажмите или Ctrl+V',
  toJournal: 'К журналу',
  attachNewFrameLong: 'Прикрепите новый кадр этого экрана',
  attachShotLong: 'Прикрепите скрин этого экрана',
};

/** Подпись штампа на закрытой карточке — короче STATUS_LABEL, в один удар. */
export const STAMP_LABEL = {
  defect: 'В работу',
  change_request: 'Новое желание',
  unspecified: 'Нет ответа в ТЗ',
  cannot_tell: 'Нужен скрин',
  rejected_binding: 'Не та цитата',
  duplicate: 'Повтор',
  closed: 'Закрыто',
  ready: 'Готово',
} as const;

export const JOURNAL = {
  columns: ['№', 'Суть', 'Итог', 'Статус'] as const,
  chips: ['Ждут меня', 'Все', 'В работе', 'Новые желания', 'На ретесте', 'Закрыто', 'Дописать из журнала'] as const,
  summary: (total: number, waiting: number) => `${total} ${plural(total, 'замечание', 'замечания', 'замечаний')}, ${waiting} ${waiting === 1 ? 'ждёт' : 'ждут'} вас`,
  emptyFilter: 'Нет строк, которые нужно дописать.',
  /** Тайлы раунда над таблицей и их подписи. */
  tiles: { mine: 'Ждут вас', work: 'В работе', retest: 'На ретесте', closed: 'Закрыто', all: 'Все' },
  tileSub: {
    work: 'у разработчика',
    retest: 'ждут кадр',
    closed: (n: number, total: number) => `из ${total}`,
    all: (round: number) => `Раунд ${round}`,
  },
  groups: { mine: 'Ждут вас', rest: 'Остальные' },
  fixBanner: (n: number) => `${n} ${plural(n, 'строку', 'строки', 'строк')} из журнала нужно дописать`,
  fixBannerCta: 'Дописать',
  showAll: 'Показать все',
  restCount: (n: number) => `Остальные ${n} ${plural(n, 'замечание', 'замечания', 'замечаний')}`,
  allDone: 'Здесь пусто — всё разобрано',
  /** «Итог» для заказчика: только ненулевые части через « · ». */
  businessBreakdown: (close: number, frame: number, shot: number) =>
    [close > 0 ? `${close} закрыть` : '', frame > 0 ? `${frame} новый кадр` : '', shot > 0 ? `${shot} скрин` : ''].filter(Boolean).join(' · '),
  waitingPm: 'Ждём первое замечание заказчика',
  startFrom: 'Начните с «Ждут вас»: слева — что заметил заказчик, справа — ваше решение.',
  explain: {
    pm: 'Слева — что заметил заказчик, справа — ваше решение.',
    business: 'Ваши замечания и то, что нужно закрыть после исправления.',
  },
  /** Новый проект: раундов ещё нет (фаза 11). */
  noRounds: 'Раундов пока нет.',
  noRoundsHint: 'Раунд — одна сдача: журнал замечаний, решения и ретест. Создайте первый и загрузите ТЗ в «Документы».',
  noRoundsOther: 'Раундов пока нет. Их создаёт руководитель приёмки или заказчик.',
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
  skip: 'К содержимому',
  sections: 'Разделы',
  menu: 'Меню',
  project: 'Проект',
  round: 'Раунд',
  contextLabel: 'Проект и раунд',
  howItWorks: 'Как это работает',
  themeToDark: 'Включить тёмную тему',
  themeToLight: 'Включить светлую тему',
  /** Аккаунты и участники (фаза 11) */
  team: 'Участники',
  profile: 'Профиль',
  admin: 'Администрирование',
  allProjects: 'Все проекты',
  newProject: 'Создать проект',
  newRound: 'Новый раунд',
  closeRound: (n: number) => `Закрыть раунд ${n}`,
  reopenRound: (n: number) => `Открыть раунд ${n} снова`,
  exportRound: (n: number) => `Выгрузить раунд ${n} (.xlsx)`,
  roundClosedNow: (n: number) => `Раунд ${n} закрыт`,
  roundReopenedNow: (n: number) => `Раунд ${n} снова открыт`,
};

/** Служебные подписи (добавлены при переработке UI, см. docs/ui/COPY.md). */
export const COMMON = {
  undo: 'Отменить',
  retry: 'Повторить',
  loading: 'Загружаем…',
  close: 'Закрыть',
  next: 'Далее',
};

export const ERROR = {
  load: 'Не удалось загрузить',
  request: 'Ошибка запроса',
  offline: 'Нет соединения с интернетом — проверьте сеть и повторите',
  network: 'Сервер не отвечает — повторите через минуту',
  unauthorized: 'Сессия истекла — войдите снова',
  forbidden: 'Нет доступа к этому действию',
  notFound: 'Не найдено — возможно, это уже удалили или у вас нет доступа',
  conflict: 'Карточка изменилась параллельно — мы её обновили, проверьте и повторите',
  tooLarge: 'Файл слишком большой',
  invalid: 'Проверьте заполненные поля',
  tooMany: 'Слишком много запросов — подождите минуту',
  server: (requestId?: string) => `Внутренняя ошибка на сервере${requestId ? ` (код обращения ${requestId})` : ''} — сообщите руководителю приёмки`,
};

export const ROUND = {
  label: (n: number) => `Раунд ${n}`,
  closed: 'закрыт',
  /** Одна пилюля в шапке: «Раунд 1 · закрыт · 6». */
  item: (n: number, status: 'open' | 'closed', count: number) => `Раунд ${n} · ${status === 'closed' ? 'закрыт' : 'открыт'} · ${count}`,
};

export const TITLE = {
  journal: (n: number | null) => (n ? `Журнал · Раунд ${n}` : 'Журнал'),
  remark: (n: number, title: string) => `№ ${n} · ${title}`,
};

export const VIEWER = {
  zoomIn: 'Увеличить',
  zoomOut: 'Уменьшить',
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

/** Короткое имя роли для подписи рядом с человеком: «Business (заказчик)». */
export const ROLE_SHORT: Record<Role, string> = {
  business: 'заказчик',
  pm: 'руководитель приёмки',
  developer: 'разработчик',
  admin: 'админ',
};

export const LOGIN_EXTRA = { demoPassword: 'пароль remarkround' };

export const EMPTY = {
  noSpec: 'Сначала загрузите ТЗ — без него разбирать замечания не будем.',
  noRemarks: 'Замечаний пока нет. Добавьте с экрана или загрузите журнал по шаблону.',
  needShot: 'Для претензии про цвет или вёрстку нужен скрин.',
  importUnparsed: 'Эти строки не разобрали. Допишите сами — мы ничего не выдумываем.',
  devEmpty: 'Пока ничего не передали в работу.',
  noAccess: 'Нет доступа',
  noAccessHint: 'Этот проект не ваш. Попросите доступ у руководителя приёмки.',
  toMyProject: 'К моему проекту',
  toMyProjects: 'К моим проектам',
  signedAs: (name: string, role: string) => `Вы вошли как ${name} · ${role}`,
};

export const DEV_QUEUE = {
  subtitle: 'Сюда не попадают желания и дыры в ТЗ, пока руководитель приёмки не решил иначе.',
  groups: { todo: 'В работе', review: 'Ждут проверки заказчика', advisory: 'Сейчас у руководителя приёмки' },
  counts: (todo: number, review: number, advisory = 0) =>
    [`${todo} в работе`, `${review} ${review === 1 ? 'ждёт' : 'ждут'} проверки заказчика`, advisory > 0 ? `${advisory} на приёмке` : ''].filter(Boolean).join(' · '),
  allDone: 'Всё передано на проверку',
  /** Подпись «Как должно быть:» в meta карточки очереди. */
  expected: 'Как должно быть:',
  /** Группа «на приёмке»: это ещё не работа, но можно посоветовать PM, что выбрать. */
  advisoryQueue: 'На приёмке',
  advisoryHint: 'Это ещё не работа: решает руководитель приёмки. Откройте карточку и посоветуйте, что выбрали бы вы.',
  advise: 'Посоветовать',
  yourAdvice: 'Ваш совет:',
};

/** Подсказка-строка под заголовком страницы; закрывается и запоминается в ui-state. */
export const HINT = {
  journal: {
    pm: 'Начните с «Ждут вас»: слева — что заметил заказчик, справа — ваше решение.',
    business: 'В «Ждут вас» — то, что нужно закрыть или дополнить. Остальное разбирает руководитель приёмки.',
  },
  card: {
    pm: 'Слева улики, в центре черновик с цитатой из ТЗ, справа — одна кнопка вашего решения. Клавиши 1–5.',
    business: 'Здесь видно, что нашлось в ТЗ и что решил руководитель приёмки.',
    developer: 'Что требует ТЗ и что сделать. Когда готово — одна кнопка.',
  },
  close: 'Понятно',
};

/** Лента шагов прогона на карточке (короткие имена фаз). */
/** Схема «Как идёт замечание» (ui/process-strip.ts): шесть узлов и подписи под токеном в loop-режиме. */
export const PROCESS = {
  title: 'Как идёт замечание',
  nodes: ['Замечание', 'Разбор', 'Решение', 'В работе', 'Проверка', 'Закрыто'] as const,
  captions: [
    'Заказчик замечает и добавляет — с экрана или из журнала',
    'Ищем место в ТЗ, смотрим скрин, готовим черновик',
    'Руководитель приёмки решает: работа или новое желание',
    'Разработчик исправляет и нажимает «Готово»',
    'Заказчик прикладывает новый кадр — сравниваем «Было» и «Стало»',
    'Заказчик закрывает замечание',
  ] as const,
  stepByStep: 'По шагам',
  collapse: 'Свернуть',
  expand: 'Развернуть',
  you: 'Здесь действуете вы',
  now: 'Сейчас здесь',
};

export type TourIllustration = 'add' | 'steps' | 'keys' | 'queue' | 'dropzone' | 'stamp' | 'tile';

export interface TourStep {
  /** Узел схемы подсвечивается по этому статусу. */
  status: RemarkStatus;
  title: string;
  text: string;
  illustration: TourIllustration;
}

/** Тур «Как это работает» для бизнеса и PM (ui/onboarding-tour.ts). Без жаргона: ни «триаж», ни «RAG», ни «LLM». */
export const TOUR = {
  title: 'Как это работает',
  skip: 'Пропустить',
  next: 'Дальше',
  back: 'Назад',
  start: 'Начать работу',
  of: (i: number, n: number) => `${i} из ${n}`,
  or: 'или',
  illo: {
    journal: 'Журнал по шаблону — каждая строка станет замечанием',
    queueTitle: 'Фильтр клиентов сбрасывается при обновлении',
    queueMeta: 'Где: Список клиентов · Как должно быть: фильтр переживает обновление страницы',
    dropzone: 'Прикрепите новый кадр этого экрана',
    dropzoneHint: 'перетащите, нажмите или Ctrl+V',
  },
  business: {
    steps: [
      {
        status: 'imported',
        title: 'Вы замечаете — мы записываем',
        text: 'Опишите, что не так, где и как должно быть, приложите скрин. Или загрузите журнал по шаблону — каждая строка станет замечанием.',
        illustration: 'add',
      },
      {
        status: 'triaging',
        title: 'Мы ищем место в ТЗ',
        text: 'Разбор идёт сам: найдём пункт ТЗ, посмотрим скрин, подготовим черновик. Если скрина не хватает — попросим прикрепить.',
        illustration: 'steps',
      },
      {
        status: 'awaiting_pm',
        title: 'Решает руководитель приёмки',
        text: 'Он видит вашу претензию, цитату из ТЗ и черновик — и решает, работа это или новое желание. Иногда спросит вас: «В документах нет ответа — решите вы».',
        illustration: 'keys',
      },
      {
        status: 'ready_for_retest',
        title: 'Разработчик исправил — вы проверяете',
        text: 'Когда появится «Можно смотреть снова», прикрепите новый кадр того же экрана. Мы сравним «Было» и «Стало» и подсветим разницу.',
        illustration: 'dropzone',
      },
      {
        status: 'awaiting_business_close',
        title: 'Закрываете только вы',
        text: 'Если исправлено — «Закрыть: исправлено». Если нет — «Не исправлено», и замечание вернётся разработчику. Всё, что ждёт вас, собрано в тайле «Ждут вас».',
        illustration: 'stamp',
      },
    ] satisfies TourStep[],
  },
  pm: {
    steps: [
      {
        status: 'imported',
        title: 'Заказчик замечает',
        text: 'Замечания приходят с экрана или из журнала. Вам ничего не нужно делать, пока не готов черновик.',
        illustration: 'add',
      },
      {
        status: 'triaging',
        title: 'Мы готовим дело',
        text: 'Цитата из ТЗ, факты со скрина, черновик разбора и похожие замечания раунда. Модель ничего не решает — только собирает улики.',
        illustration: 'steps',
      },
      {
        status: 'awaiting_pm',
        title: 'Ваше решение — одна кнопка',
        text: 'Слева улики, в центре черновик, справа пять кнопок тремя группами: это работа · это не работа · нужны данные. Клавиши 1–5, пять секунд на «Отменить».',
        illustration: 'keys',
      },
      {
        status: 'defect',
        title: 'Разработчик видит только принятое',
        text: 'В его очередь попадает лишь то, что вы назвали работой. Желания и дыры в ТЗ остаются в журнале.',
        illustration: 'queue',
      },
      {
        status: 'awaiting_business_close',
        title: 'Закрывает заказчик',
        text: 'После исправления заказчик сверяет кадры и закрывает замечание. Журнал показывает, где сейчас каждая строка; начинайте с «Ждут вас».',
        illustration: 'tile',
      },
    ] satisfies TourStep[],
  },
};

export const PHASE_STEPS = {
  retrieving: 'Документы',
  vision: 'Скрин',
  binding: 'Место в ТЗ',
  drafting: 'Черновик',
} as const;

export const IMPORT = {
  title: 'Журнал замечаний из файла',
  drop: 'Перетащите файл журнала сюда',
  dropHint: '.xlsx или .csv по шаблону',
  dropOver: 'Отпустите, чтобы загрузить',
  template: 'Скачать шаблон журнала',
  upload: 'Загрузить файл',
  after: (fileName: string) => `После загрузки · ${fileName}`,
  summary: (parsed: number, total: number, bad: number) =>
    `Разобрали ${parsed} из ${total}. ${capitalize(numWord(bad, 'f'))} ${plural(bad, 'строку', 'строки', 'строк')} нужно дописать.`,
  rowPlaceholder: 'Опишите, что не так и где',
  rowLink: (row: number, n: number) => `строка ${row} → №${n}`,
  /** «Строка 4: пустое описание — допишите сами.» (docs/ui/03-import.md) */
  rowReason: (row: number, reason: string) => `Строка ${row}: ${reason} — допишите сами.`,
  linkNotFetched: 'скрин по ссылке из файла не загружаем — прикрепите на карточке',
  uploading: 'Загружаем журнал…',
  save: 'Сохранить строки',
  received: 'Получено',
  /** Редизайн: колонки 5/7 до загрузки — шаблон слева, как работает справа. */
  subtitle: (round: number) => `Строки станут замечаниями раунда ${round}. Строки без описания попросим дописать.`,
  templateTitle: 'Что в шаблоне',
  templateColumns: ['№', 'Где', 'Что не так', 'Как должно быть', 'Важность', 'Скрин'] as const,
  templateExample: [
    ['J-01', 'Профиль', 'Кнопка «Сохранить» серая', 'синяя по ТЗ', 'высокая', 'ссылка'],
    ['J-02', 'Оплата', '', '', '', ''],
  ] as const,
  templateEmptyNote: '(пусто) → «Допишите строку журнала»',
  howTitle: 'Как это работает',
  steps: (round: number) => [
    `Каждая строка станет замечанием раунда ${round}`,
    'Разбор запустится сам: цитата из ТЗ, черновик, решение',
    'Пустые строки допишете здесь',
  ],
  uploadOther: 'Загрузить другой',
  groups: { fix: 'Допишите', parsed: 'Разобраны' },
  toJournal: 'К журналу раунда',
  allParsed: (n: number) => `Разобрали ${n} из ${n}`,
  formats: 'xlsx · csv',
};

export const DOCUMENTS = {
  title: 'Пакет документов проекта',
  upload: 'Загрузить документ',
  columns: ['Тип', 'Дата', 'Страниц', 'Статус'] as const,
  pages: (n: number) => `${n} стр`,
  subtitle: 'Без ТЗ замечания не разбираем: цитаты для черновиков берём отсюда.',
  whyTitle: 'Зачем документы',
  why: ['Без ТЗ замечания не разбираем', 'Цитата на карточке — из этих файлов', 'Протокол уточняет ТЗ и снимает споры'],
  chunks: (n: number) => `${n} ${plural(n, 'фрагмент', 'фрагмента', 'фрагментов')}`,
  /** Русские имена типов документа; раньше жили в remarks.store.ts как DOC_LABEL. */
  kinds: {
    spec: 'ТЗ',
    protocol: 'Протокол',
    addendum: 'Доп. соглашение',
    journal_source: 'Журнал',
  } satisfies Record<DocumentKind, string>,
  uploadTitle: 'Загрузить',
  dropHint: 'Перетащите PDF, DOCX или MD — или нажмите',
  kindLabel: 'Тип',
  searchTitle: 'Проверить, что найдётся',
  searchPlaceholder: 'Например: цвет кнопки «Сохранить»',
  searchEmpty: 'Ничего похожего в документах нет',
  searchDisabled: 'Поиск заработает, когда появится ТЗ',
  emptySlot: 'Доп. соглашение — если было',
  retryUpload: 'Загрузите файл ещё раз',
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
  subtitle: 'Опишите, что не так, и приложите скрин — мы найдём место в ТЗ.',
  nextTitle: 'Что будет дальше',
  nextText: 'Найдём место в ТЗ → посмотрим скрин → подготовим черновик → решение примет руководитель приёмки',
  remove: 'Убрать',
  dropTitle: 'Перетащите скрин, нажмите или Ctrl+V',
  roundClosed: (n: number) => `Раунд ${n} закрыт — добавляйте в открытый раунд`,
  /** Строка «назад» над заголовком; стрелка — иконкой, не символом. */
  back: 'Журнал',
  required: 'обязательно',
};

export const LOGIN = {
  pageTitle: 'Вход',
  showPassword: 'Показать пароль',
  hidePassword: 'Скрыть пароль',
  email: 'E-mail',
  password: 'Пароль',
  submit: 'Войти',
  unknown: 'Такого пользователя нет',
  demoHint: 'Демо-входы:',
  /** Левая колонка входа: три строки лида и три шага; карточки ролей заполняют форму. */
  lead: ['Заказчик замечает.', 'Мы находим место в ТЗ.', 'Вы решаете, работа ли это.'],
  tryAs: 'Кто вы в демо',
  roles: [
    { email: 'business@remarkround.dev', name: 'Business', role: 'business', does: 'добавляет замечания, закрывает ретест' },
    { email: 'pm@remarkround.dev', name: 'PM', role: 'pm', does: 'выносит вердикт по черновику с цитатой ТЗ' },
    { email: 'developer@remarkround.dev', name: 'Developer', role: 'developer', does: 'видит только принятые поломки' },
  ] satisfies ReadonlyArray<{ email: string; name: string; role: Role; does: string }>,
  steps: ['Замечание', 'Цитата из ТЗ', 'Решение человека'],
  noAccount: 'Нет аккаунта?',
  toRegister: 'Зарегистрироваться',
  inviteOnly: 'Аккаунт появляется по ссылке приглашения от руководителя приёмки.',
};

// ---------- Аккаунты и участники (фаза 11, ADR 005) ----------

/** Сторона при регистрации и в приглашении; в проекте роль ставит руководитель приёмки. */
export const ROLE_SIDE: Record<Side, string> = { business: 'Заказчик', pm: 'Руководитель приёмки', developer: 'Разработчик' };
export const SIDES: readonly Side[] = ['business', 'pm', 'developer'];
export const SIDE_DOES: Record<Side, string> = {
  business: 'добавляет замечания, закрывает ретест',
  pm: 'решает, работа ли это; создаёт проекты и зовёт участников',
  developer: 'видит только принятые поломки',
};

export const REGISTER = {
  pageTitle: 'Регистрация',
  name: 'Имя',
  email: 'E-mail',
  password: 'Пароль',
  passwordHint: 'Не короче 8 знаков',
  who: 'Кто вы',
  submit: 'Зарегистрироваться',
  haveAccount: 'Уже есть аккаунт?',
  toLogin: 'Войти',
  taken: 'Этот e-mail уже зарегистрирован — войдите.',
  invalid: 'Проверьте поля: имя, e-mail и пароль не короче 8 знаков.',
  invited: (project: string, role: string) => `Вас пригласили в проект «${project}» — ${role.toLowerCase()}`,
  invitedBy: (name: string) => `Пригласил: ${name}`,
  inviteGone: 'Ссылка приглашения не действует. Попросите у руководителя приёмки новую.',
  closed: 'Регистрация только по ссылке приглашения. Попросите её у руководителя приёмки вашего проекта.',
  closedTitle: 'Нужна ссылка приглашения',
  lead: ['Заказчик замечает.', 'Мы находим место в ТЗ.', 'Человек решает, работа ли это.'],
};

export const PROJECTS = {
  title: 'Ваши проекты',
  open: 'Открыть',
  waitingTitle: 'Вас ещё не добавили в проект',
  waitingHint: (email: string) => `Попросите руководителя приёмки добавить вас: вы зарегистрированы как ${email}. Как только добавят — откроем проект сами.`,
  refresh: 'Проверить сейчас',
  createTitle: 'Создать проект',
  nameLabel: 'Название проекта',
  namePlaceholder: 'Например: Клиентский кабинет',
  create: 'Создать проект',
  createHint: 'Вы станете руководителем приёмки этого проекта. Участников добавите на странице «Участники».',
  onlyPm: 'Право создавать проекты выдаёт администратор.',
};

/** Администрирование инстанса (ADR 006): люди и проекты поперёк тенантов; только для ADMIN_EMAILS. */
export const ADMIN = {
  title: 'Администрирование',
  subtitle: 'Люди и проекты всей установки. Роли внутри проекта меняет его руководитель приёмки на странице «Участники».',
  usersTitle: 'Люди',
  projectsTitle: 'Проекты',
  columns: ['Имя', 'E-mail', 'Проекты', 'Право создавать проекты', 'Состояние'] as const,
  projectColumns: ['Проект', 'Участников', 'Создан'] as const,
  canCreate: 'может создавать проекты',
  cannotCreate: 'не может создавать проекты',
  grant: 'Выдать право',
  revokeRight: 'Снять право',
  active: 'активен',
  disabled: (date: string) => `отключён ${date}`,
  disable: 'Отключить',
  enable: 'Включить',
  disableHint: 'Вход, токены и открытые вкладки перестанут работать сразу. Участие в проектах сохраняется.',
  revokeSessions: 'Завершить сессии',
  revoked: (name: string) => `Сессии ${name} завершены — он войдёт заново`,
  you: 'это вы',
  admin: 'администратор',
  noProjects: 'без проектов',
  disabledSelf: 'Себя отключить нельзя.',
  empty: 'Пока никого, кроме вас.',
};

export const TEAM = {
  title: 'Участники',
  subtitle: 'Роль — на проект: один человек в разных проектах может быть на разных сторонах.',
  columns: ['Имя', 'E-mail', 'Роль'] as const,
  addTitle: 'Добавить участника',
  emailLabel: 'E-mail',
  roleLabel: 'Кто в этом проекте',
  add: 'Добавить',
  addedMember: (name: string) => `${name} — в проекте`,
  addedInvitation: (email: string) => `Приглашение для ${email} создано — скопируйте ссылку и отправьте сами`,
  invitationsTitle: 'Приглашения',
  invitationsHint: 'Ссылку отправьте сами — писем мы не шлём. В проект попадает только тот, кто пришёл по ссылке; регистрация на этот e-mail без ссылки ничего не даёт. Ссылка живёт неделю и показывается один раз: потеряли — выпустите новую, прежняя перестанет работать.',
  copyLink: 'Скопировать ссылку',
  newLink: 'Новая ссылка',
  linkReady: 'Ссылка готова — скопируйте её сейчас, второй раз мы её не покажем',
  copied: 'Скопировано',
  revoke: 'Отозвать',
  changeRole: 'Сменить роль',
  remove: 'Убрать из проекта',
  removed: (name: string) => `Убрали ${name} из проекта`,
  lastPm: 'Единственный руководитель приёмки — сначала назначьте другого.',
  you: 'это вы',
  empty: 'Пока только вы. Добавьте заказчика и разработчика по e-mail.',
  expires: (date: string) => `ссылка до ${date}`,
};

export const PROFILE = {
  title: 'Профиль',
  name: 'Имя',
  save: 'Сохранить',
  saved: 'Сохранено',
  who: 'Кто вы',
  whoHint: 'Подсказка для приглашений. Роль в каждом проекте назначает руководитель приёмки.',
  passwordTitle: 'Сменить пароль',
  current: 'Текущий пароль',
  next: 'Новый пароль',
  repeat: 'Ещё раз',
  change: 'Сменить пароль',
  changed: 'Пароль изменён. На других устройствах нужно войти заново.',
  wrongCurrent: 'Текущий пароль не подходит',
  mismatch: 'Пароли не совпадают',
};

export const JOIN = {
  title: 'Приглашение в проект',
  lead: (project: string, role: string) => `Вас зовут в проект «${project}» — ${role.toLowerCase()}`,
  by: (name: string) => `Пригласил: ${name}`,
  accept: 'Войти в проект',
  accepting: 'Добавляем вас в проект…',
  gone: 'Ссылка не действует. Попросите новую у руководителя приёмки.',
  signedAs: (email: string) => `Вы вошли как ${email}`,
  register: 'Зарегистрироваться',
  login: 'Уже есть аккаунт? Войти',
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
