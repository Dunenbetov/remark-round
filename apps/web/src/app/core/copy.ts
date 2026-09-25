/**
 * Все русские строки интерфейса в одном месте.
 * Синонимы запрещены: не Approve/Reject/Submit/Ticket.
 */
import type { DocumentKind, DocumentStatus, Phase, RemarkStatus, Role, Side, VerdictCode } from './models';

export const APP_NAME = 'RemarkRound';

export const ROLE_TITLE: Record<Role, string> = {
  business: 'Вы принимаете работу',
  pm: 'Вы решаете, работа ли это',
  developer: 'Вам передали в работу',
  admin: 'Настройка проекта',
};

/** Ключи совпадают с STATUS_LABEL_RU сервера (apps/api/src/remarks/labels.ts, проверяет labels.contract.spec); тексты — «вы» только на экране. */
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

/**
 * Те же статусы для того, от кого решения не ждут: заказчик после «Добавить замечание» видит не «Ждёт вашего решения»,
 * а чьего именно. Тексты — как в xlsx сервера (STATUS_LABEL_RU).
 */
export const OTHER_STATUS_LABEL: Partial<Record<RemarkStatus, string>> = {
  awaiting_pm: 'Ждёт решения руководителя приёмки',
  unspecified: 'Нужно решение заказчика',
};

/** Подпись статуса для того, кто смотрит: «вашего» — только адресату решения, остальным — чьего. */
export function statusLabelFor(status: RemarkStatus, role: Role | null | undefined): string {
  const mine = (status === 'awaiting_pm' && role === 'pm') || (status === 'unspecified' && role === 'business');
  return (mine ? undefined : OTHER_STATUS_LABEL[status]) ?? STATUS_LABEL[status];
}

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
  /** ready_for_retest (ADR 010): заказчик закрывает сам или прикладывает новый кадр для сравнения. */
  awaitingCheck: 'Проверьте: закройте или прикрепите новый кадр',
  awaitingCheckOther: 'Ждём проверки заказчика',
  inDevWith: (name: string) => `В работе у ${name}`,
  /** Фаза для того, кто не принимает решение на этой карточке. */
  awaitingPmOther: 'Ждём решения руководителя приёмки',
  awaitingBusinessOther: 'Ждём решения заказчика',
  closedAt: (name: string, at: string) => `Закрыто · ${name} · ${at}`,
  /** Ссылка на трейс прогона (Langfuse) — служебная, только PM. */
  trace: 'Трейс в Langfuse',
};

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
  waitFrame: 'Кнопки станут доступны, когда сравним кадры.',
  onlyBusinessCloses: 'Закрыть замечание может только тот, кто принимает работу.',
  /** retest-check (ADR 010): закрыть можно сразу, вернуть — только с новым кадром. */
  checkHint: 'Проверили на стенде — закройте. Не исправлено — прикрепите новый кадр, покажем дифф.',
  notFixedNeedsFrame: 'Вернуть разработчику можно только с новым кадром.',
  closeCommentLabel: 'Комментарий к закрытию (необязательно)',
  commentWithClose: 'Уйдёт вместе с закрытием.',
  closedWithoutFrame: 'Проверено заказчиком, без нового кадра',
  closedAfterRetest: 'После ретеста: новый кадр и дифф',
  record: 'Решение:',
  change: 'Изменить решение',
  closeFixed: 'Закрыть: исправлено',
  notFixed: 'Не исправлено',
  attachShot: 'Прикрепить скрин',
  attachFooterHint: 'Любая страница с футером, целиком.',
  attachNewFrame: 'Прикрепите новый кадр этого экрана.',
  readyForRetest: 'Готово, можно смотреть снова',
  closedRecord: 'Закрыто',
  /** Заголовки групп кнопок PM. */
  groups: { work: 'Это работа', notWork: 'Это не работа', needData: 'Нужны данные' },
  addComment: 'Добавить комментарий',
  /** Комментарий — часть решения, а не отдельная запись: отдельной кнопки «отправить» у него нет. */
  commentWithVerdict: 'Уйдёт вместе с решением — выберите вариант выше.',
  commentWithAdvice: 'Уйдёт вместе с советом — выберите вариант выше.',
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
    retest: '1 — закрыть · 2 — не исправлено · C — комментарий · → следующее · Esc — отменить',
    'retest-check': '1 — закрыть · U — новый кадр · C — комментарий · → следующее · Esc — отменить',
    'retest-wait': '→ следующее',
    disabled: 'Кнопки станут доступны, когда черновик будет готов.',
    record: '→ следующее',
  } satisfies Record<'disabled' | 'pm-full' | 'pm-two' | 'dev-advice' | 'attach' | 'retest' | 'retest-check' | 'retest-wait' | 'record', string>,
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

/** Группы кнопок PM: заголовок и коды в каноническом порядке (ui/decision-panel.ts и тур). */
export const PM_VERDICT_GROUPS: ReadonlyArray<{ key: 'work' | 'notWork' | 'needData'; title: string; codes: readonly VerdictCode[] }> = [
  { key: 'work', title: DECISION.groups.work, codes: ['defect'] },
  { key: 'notWork', title: DECISION.groups.notWork, codes: ['change_request', 'unspecified'] },
  { key: 'needData', title: DECISION.groups.needData, codes: ['cannot_tell', 'rejected_binding'] },
];

/** Кнопки PM по группам с клавишей 1–5 по каноническому порядку PM_VERDICTS. */
export function pmVerdictGroups() {
  return PM_VERDICT_GROUPS.map((g) => ({
    key: g.key,
    title: g.title,
    verdicts: g.codes.map((code) => {
      const i = PM_VERDICTS.findIndex((v) => v.code === code);
      return { ...PM_VERDICTS[i]!, key: i + 1 };
    }),
  }));
}

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
  /** Заголовки левой колонки — шаги строки пути: «Замечание», на ретесте и в ожидании нового кадра — «Проверка». */
  columnRemark: 'Замечание',
  columnCheck: 'Проверка',
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
  /** Заказчик до решения: черновика и цитат ему не показываем (ADR 007) — вместо пустой колонки объяснение. */
  customerWaiting: 'Разбор готов и ждёт руководителя приёмки. Что нашли в документах и что решили — появится здесь вместе с решением.',
  /** Цитаты из ТЗ нет: место, которое подтверждало бы замечание, не нашлось (20.09). */
  noSpecCitation: 'В ТЗ опоры не нашли: места, которое описывало бы этот экран, в тексте нет.',
  zoomOpen: 'Открыть кадр',
  fromJournal: (id: string) => `Из журнала · ${id}`,
  severity: 'Важность:',
  /** Карточка строки без описания: ячейки из файла как есть, человек дописывает. */
  fixRowHint: 'Ячейки из файла оставили как есть. Опишите, что не так и где — и запустим разбор.',
  /** Блок «что прислал заказчик» и сцена сравнения (редизайн). */
  saidBy: 'Что написал заказчик',
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
  history: 'История',
  historyEmpty: 'Пока пусто',
  historySystem: 'RemarkRound',
  /** Кадр действия в истории: открыть в просмотрщике; заменённый помечен, но в истории остаётся (ADR 011). */
  historyShot: { original: 'кадр', retest: 'новый кадр', diff: 'дифф' } as Record<'original' | 'retest' | 'diff', string>,
  historyShotReplaced: 'заменён',
  reopenedIn: (number: number, round: number) => `Открыто снова: №${number} в раунде ${round}`,
  reopenIn: (round: number) => `Открыть снова в раунде ${round}`,
  reopenNoRound: 'Чтобы открыть снова, сначала создайте новый раунд',
  whatToDo: 'Что сделать',
  showFullDraft: 'Показать разбор целиком',
  hideFullDraft: 'Свернуть',
  pasteHint: 'перетащите, нажмите или Ctrl+V',
  toJournal: 'К журналу',
  attachNewFrameLong: 'Прикрепите новый кадр этого экрана',
  /** Ошиблись кадром ретеста: новый кадр вместо прежнего, сравнение заново; прежний остаётся в истории (ADR 011). */
  replaceAfter: 'Заменить кадр «Стало»',
  replaceAfterHint: 'Прежний кадр останется в истории, кадры сравним заново',
  /** Кадры сравниваются попиксельно (ADR 002): другой размер — сравнить не выйдет, говорим это до загрузки. */
  sameSizeHint: (w: number, h: number) => `Того же размера, что первый кадр (${w}×${h}), иначе сравнить не выйдет`,
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
    retest: 'ждут проверки',
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
  businessBreakdown: (close: number, check: number, shot: number) =>
    [close > 0 ? `${close} закрыть` : '', check > 0 ? `${check} проверить` : '', shot > 0 ? `${shot} скрин` : ''].filter(Boolean).join(' · '),
  waitingPm: 'Ждём первое замечание заказчика',
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
  /** Причина серого «Новый раунд»: «сначала решите 10 в раунде 2». */
  newRoundBlocked: (pending: number, rounds: number[]) => `сначала решите ${pending} ${rounds.length > 1 ? `в раундах ${rounds.join(', ')}` : `в раунде ${rounds[0]}`}`,
  closeRound: (n: number) => `Закрыть раунд ${n}`,
  reopenRound: (n: number) => `Открыть раунд ${n} снова`,
  exportRound: (n: number) => `Выгрузить раунд ${n} (.xlsx)`,
  /** Журнал всего проекта (ADR 011): раунды, замечания, история. */
  exportJournal: 'Выгрузить весь журнал (.xlsx)',
  roundClosedNow: (n: number) => `Раунд ${n} закрыт`,
  roundReopenedNow: (n: number) => `Раунд ${n} снова открыт`,
  /** Страница «Раунды» (ADR 011). */
  allRounds: 'Все раунды',
};

/** Страница «Раунды» и плашка закрытого раунда в журнале (ADR 011). */
export const ROUNDS = {
  title: 'Раунды',
  subtitle: 'Каждая сдача со всеми решениями: откройте журнал раунда или выгрузите в Excel с историей.',
  exportJournal: 'Выгрузить журнал (.xlsx)',
  exportRound: 'Выгрузить (.xlsx)',
  exportRoundAria: (n: number) => `Выгрузить раунд ${n} (.xlsx)`,
  columns: ['№', 'Раунд', 'Замечания', ''] as const,
  label: (n: number) => `Раунд ${n}`,
  open: (date: string) => `идёт с ${date}`,
  closed: (date: string, who: string) => [date ? `закрыт ${date}` : 'закрыт', who].filter(Boolean).join(' · '),
  counts: (r: { remarks: number; closed?: number; changeRequests?: number; duplicates?: number; pending: number }) =>
    [
      `${r.remarks} ${plural(r.remarks, 'замечание', 'замечания', 'замечаний')}`,
      r.closed ? `закрыто ${r.closed}` : '',
      r.changeRequests ? `новых желаний ${r.changeRequests}` : '',
      r.duplicates ? `повторов ${r.duplicates}` : '',
      r.pending ? `не решено ${r.pending}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  /** Плашка над журналом закрытого раунда: факт, не подсказка. */
  banner: (n: number, date: string, who: string) => [date ? `Раунд ${n} закрыт ${date}` : `Раунд ${n} закрыт`, who, 'только чтение'].filter(Boolean).join(' · '),
  empty: 'Раундов пока нет.',
  /** Пустой журнал закрытого раунда: добавить уже нельзя. */
  emptyClosed: 'В этом раунде замечаний не было.',
};

/** Служебные подписи (добавлены при переработке UI). */
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


export const EMPTY = {
  noRemarks: 'Замечаний пока нет. Добавьте с экрана или загрузите журнал из файла.',
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

/** Схема «Как идёт замечание» (ui/process-strip.ts): шесть узлов, подчёркнуты те, где действует роль. */
export const PROCESS = {
  title: 'Как идёт замечание',
  nodes: ['Замечание', 'Разбор', 'Решение', 'В работе', 'Проверка', 'Закрыто'] as const,
  you: 'Здесь действуете вы',
  now: 'Сейчас здесь',
};

export type TourIllustration = 'add' | 'steps' | 'keys' | 'tile' | 'queue' | 'ready' | 'check' | 'closed';

export interface TourStep {
  /** Узел схемы подсвечивается по этому статусу. */
  status: RemarkStatus;
  title: string;
  text: string;
  illustration: TourIllustration;
}

/** Роли с туром. Администратор инстанса в проекты не входит (ADR 006) — тура у него нет. */
export type TourRole = 'business' | 'pm' | 'developer';

/**
 * Тур «Как это работает» (ui/onboarding-tour.ts): каждой роли три шага про её участок пути.
 * Заголовок — одна строка, текст — не длиннее трёх строк при 60ch. Без жаргона: ни «триаж», ни «RAG», ни «LLM».
 */
export const TOUR = {
  title: 'Как это работает',
  skip: 'Пропустить',
  next: 'Дальше',
  back: 'Назад',
  start: 'Начать работу',
  of: (i: number, n: number) => `Шаг ${i} из ${n}`,
  or: 'или',
  /** Подпись сцены: под ней настоящий элемент экрана, без интерактива. */
  onScreen: 'На экране',
  illo: {
    queueTitle: 'Фильтр клиентов сбрасывается при обновлении',
    queueWhere: 'Список клиентов',
    queueExpected: 'фильтр переживает обновление страницы',
  },
  roles: {
    business: [
      {
        status: 'imported',
        title: 'Заметили — добавьте',
        text: 'Напишите, что не так, где и как должно быть, приложите скрин. Много замечаний сразу — загрузите журнал из файла на вкладке «Импорт».',
        illustration: 'add',
      },
      {
        status: 'awaiting_pm',
        title: 'Дальше без вас',
        text: 'Разбор идёт сам: найдём место в ТЗ, посмотрим скрин, подготовим черновик. Решает руководитель приёмки, исправляет разработчик. Если скрина не хватает, попросим.',
        illustration: 'steps',
      },
      {
        status: 'ready_for_retest',
        title: 'Проверьте и закройте',
        text: 'Появилось «Можно смотреть снова» — проверьте на стенде и закройте. Не исправлено: прикрепите новый кадр и верните разработчику. Всё ваше собрано в «Ждут вас».',
        illustration: 'check',
      },
    ],
    pm: [
      {
        status: 'triaging',
        title: 'Замечания разбираются сами',
        text: 'К каждому замечанию мы готовим цитату из ТЗ, факты со скрина и черновик решения. Модель ничего не решает, только собирает всё нужное для решения.',
        illustration: 'steps',
      },
      {
        status: 'awaiting_pm',
        title: 'Ваше решение — одна кнопка',
        text: 'Пять вариантов тремя группами: это работа, это не работа, нужны данные. Клавиши 1–5. После нажатия пять секунд можно «Отменить».',
        illustration: 'keys',
      },
      {
        status: 'defect',
        title: 'Начинайте с «Ждут вас»',
        text: 'В очередь разработчика попадает только то, что вы назвали работой. Желания и дыры в ТЗ остаются в журнале. Проверяет и закрывает заказчик.',
        illustration: 'tile',
      },
    ],
    developer: [
      {
        status: 'defect',
        title: 'В очереди только принятое',
        text: 'Сюда попадает лишь то, что руководитель приёмки назвал работой: желаний и дыр в ТЗ здесь нет. В карточке — что требует ТЗ и что сделать.',
        illustration: 'queue',
      },
      {
        status: 'ready_for_retest',
        title: 'Исправили — нажмите «Готово»',
        text: 'Кнопка «Готово, можно смотреть снова» отправляет замечание заказчику на проверку. Пять секунд можно «Отменить». Кнопки «Закрыть» у вас нет.',
        illustration: 'ready',
      },
      {
        status: 'closed',
        title: 'Закрывает заказчик',
        text: 'Заказчик проверяет на стенде и закрывает. Не исправлено — замечание вернётся к вам с новым кадром. Пока оно ждёт руководителя приёмки, можно посоветовать решение.',
        illustration: 'closed',
      },
    ],
  } satisfies Record<TourRole, TourStep[]>,
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
  /** «Строка 4: пустое описание — допишите сами.» (импорт журнала) */
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
  /** Пустые места полки: у каждого типа своя дропзона, выбирать тип отдельно не нужно. */
  slot: {
    spec: { title: 'Добавьте ТЗ', hint: 'Без него замечания не разбираем · PDF, DOCX, DOC или MD' },
    protocol: { title: 'Добавьте протокол', hint: 'Если был · PDF, DOCX, DOC или MD' },
    addendum: { title: 'Добавьте доп. соглашение', hint: 'Если было · PDF, DOCX, DOC или MD' },
  },
  newVersion: 'Новая версия',
  download: 'Скачать',
  /** Пустое место полки для тех, кто не загружает (заказчик, разработчик): документы кладёт руководитель приёмки. */
  emptySlot: {
    spec: { title: 'ТЗ ещё не загружено', hint: 'Его загружает руководитель приёмки' },
    protocol: { title: 'Протокола нет', hint: 'Если был — его загрузит руководитель приёмки' },
    addendum: { title: 'Доп. соглашения нет', hint: 'Если было — его загрузит руководитель приёмки' },
  },
  moreTitle: 'Ещё в пакете',
  searchTitle: 'Проверить, что найдётся',
  searchEmpty: 'Ничего похожего в документах нет',
  searchDisabled: 'Поиск заработает, когда появится ТЗ',
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
  where: 'Где',
  wherePlaceholder: 'Страница или экран',
  expected: 'Как должно быть',
  expectedPlaceholder: 'Если знаете: как по ТЗ или по договорённости',
  attach: 'Прикрепить скрин',
  replace: 'Заменить',
  cancel: 'Отмена',
  save: 'Сохранить',
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
  /** Карточки демо-персон приходят из GET /auth/options только на стенде (D-2); здесь — подпись пароля. */
  demoPasswordHint: (password: string) => `пароль ${password}`,
  steps: ['Замечание', 'Цитата из ТЗ', 'Решение человека'],
  noAccount: 'Нет аккаунта?',
  toRegister: 'Зарегистрироваться',
  inviteOnly: 'Аккаунт появляется по ссылке приглашения от руководителя приёмки.',
  /** Писем нет (ADR 013): ссылку для смены пароля выпускает администратор. */
  lostPassword: 'Забыли пароль? Попросите администратора прислать ссылку для смены.',
  resetDone: 'Пароль изменён — войдите с новым.',
};

/** Новый пароль по ссылке /reset/<token>, которую прислал администратор (ADR 013). */
export const RESET = {
  pageTitle: 'Новый пароль',
  password: 'Новый пароль',
  passwordHint: 'Не короче 8 знаков',
  submit: 'Сохранить пароль',
  invalid: 'Пароль не короче 8 знаков.',
  dead: 'Ссылка не действует: прошли сутки или её уже использовали. Попросите администратора прислать новую.',
  toLogin: 'Ко входу',
};

// ---------- Аккаунты и участники (фаза 11, ADR 005) ----------

/** Сторона при регистрации и в приглашении; в проекте роль ставит руководитель приёмки. */
export const ROLE_SIDE: Record<Side, string> = { business: 'Заказчик', pm: 'Руководитель приёмки', developer: 'Разработчик' };
/** Администратор инстанса (ADMIN_EMAILS, ADR 006, 17.09): скрытая роль без стороны — подпись вместо `ROLE_SIDE` в шапке и профиле. */
export const ROLE_ADMIN = 'Администратор';
export const SIDES: readonly Side[] = ['business', 'pm', 'developer'];
export const SIDE_DOES: Record<Side, string> = {
  business: 'добавляет замечания, закрывает исправленное',
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
  invitedInstance: 'Вас пригласили руководителем приёмки: после регистрации вы сможете создавать проекты и звать участников',
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
  waitingHint: (email: string) => `Попросите руководителя приёмки пригласить вас: вы зарегистрированы как ${email}. Приглашение появится в колокольчике наверху.`,
  refresh: 'Проверить сейчас',
  createTitle: 'Создать проект',
  nameLabel: 'Название проекта',
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
  inviteTitle: 'Пригласить руководителя приёмки',
  inviteHint: 'Человек без проекта: по ссылке он зарегистрируется и сможет создавать проекты и звать участников. Если e-mail уже зарегистрирован — право появится сразу.',
  inviteEmail: 'E-mail',
  invite: 'Пригласить',
  granted: (name: string) => `${name} уже зарегистрирован — право создавать проекты выдано`,
  invited: (email: string) => `Приглашение для ${email} создано. Отправьте ссылку человеку:`,
  /** Текст рядом со ссылкой в Telegram / WhatsApp. */
  inviteText: 'Приглашение в RemarkRound: руководитель приёмки — сможете создавать проекты и звать участников',
  pendingTitle: 'Ожидают ссылку',
  newLink: 'Новая ссылка',
  revoke: 'Отозвать',
  linkReady: 'Новая ссылка готова — отправьте её сейчас, второй раз мы её не покажем. Прежняя больше не работает.',
  expires: (date: string) => `ссылка до ${date}`,
  /** Смена пароля без почты (ADR 013): ссылка /reset/<token> на сутки, отправляет администратор. */
  resetLink: 'Ссылка для смены пароля',
  resetReady: (name: string) => `Ссылка для смены пароля — для ${name}. Отправьте её человеку:`,
  resetText: (name: string) => `RemarkRound: ссылка для смены пароля (${name})`,
  resetNote: (date: string) => `ссылка действует сутки — до ${date}; сработает один раз`,
  resetDisabled: 'Человек отключён — сначала включите его.',
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
  /** Писем нет (ADR 013): ссылку отправляет сам руководитель приёмки; у зарегистрированного приглашение ещё и в колокольчике. */
  addedInvitation: (email: string) => `Приглашение для ${email} создано. Отправьте ссылку человеку:`,
  addedInvitee: (name: string) => `${name} — уже в RemarkRound: приглашение ждёт в колокольчике. Ссылку можно отправить и напрямую:`,
  /** Текст рядом со ссылкой в Telegram / WhatsApp. */
  inviteText: (project: string, role: string) => `Приглашение в RemarkRound: проект «${project}», роль — ${role.toLowerCase()}`,
  invitationsTitle: 'Приглашения',
  invitationsHint: 'Ссылку отправьте сами — писем мы не шлём. У кого уже есть аккаунт, тот увидит приглашение и в колокольчике. В проект попадает только тот, кто принял приглашение. Ссылка живёт неделю и показывается один раз: потеряли — выпустите новую, прежняя перестанет работать.',
  inviteeAccount: (name: string) => `аккаунт: ${name}`,
  newLink: 'Новая ссылка',
  linkReady: 'Новая ссылка готова — отправьте её сейчас, второй раз мы её не покажем. Прежняя больше не работает.',
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
  dataTitle: 'Данные',
  projects: 'Проекты и роли',
  noProjects: 'Пока ни в одном проекте — руководитель приёмки пришлёт приглашение.',
  name: 'Имя',
  save: 'Сохранить',
  saved: 'Сохранено',
  who: 'Кто вы',
  whoHint: 'Подсказка для приглашений. Роль в каждом проекте назначает руководитель приёмки.',
  passwordTitle: 'Пароль',
  current: 'Текущий пароль',
  next: 'Новый пароль',
  repeat: 'Ещё раз',
  change: 'Сменить пароль',
  changed: 'Пароль изменён. На других устройствах нужно войти заново.',
  wrongCurrent: 'Текущий пароль не подходит',
  mismatch: 'Пароли не совпадают',
};

/** Ссылка, которую отправляют сами (ADR 013): поле, «Скопировать», Telegram, WhatsApp, системное «Поделиться…» на телефоне. */
export const SHARE = {
  urlLabel: 'Ссылка',
  copy: 'Скопировать',
  copied: 'Скопировано',
  copyFailed: 'Скопировать не вышло — ссылка выделена, скопируйте её вручную',
  telegram: 'Telegram',
  telegramAria: 'Отправить ссылку в Telegram',
  whatsapp: 'WhatsApp',
  whatsappAria: 'Отправить ссылку в WhatsApp',
  share: 'Поделиться…',
  shareAria: 'Отправить ссылку через другое приложение',
  newTab: '(откроется в новой вкладке)',
};

/** Колокольчик в шапке (ADR 013): приглашения на мой e-mail. */
export const INBOX = {
  title: 'Приглашения',
  bell: (n: number) => (n ? `Приглашения: ${n} ${plural(n, 'новое', 'новых', 'новых')}` : 'Приглашения: новых нет'),
  item: (inviter: string, project: string) => `${inviter} зовёт вас в «${project}»`,
  accept: 'Принять',
  decline: 'Отклонить',
  empty: 'Новых приглашений нет',
  gone: 'Приглашение уже не действует: его отозвали или истёк срок',
  expires: (date: string) => `до ${date}`,
};

/**
 * Уведомления о замечаниях в том же колокольчике (ADR 016). Фраза события — подпись истории карточки (core/history-label.ts),
 * кроме `proposal`: человеку важно, что разбор готов, а не что предложила модель. Без глаголов прошедшего времени с родом.
 */
export const NOTIFY = {
  title: 'Уведомления',
  /** Кнопка колокольчика: уведомления и приглашения одним числом. */
  bell: (n: number) => (n ? `Уведомления: ${n} ${plural(n, 'новое', 'новых', 'новых')}` : 'Уведомления: новых нет'),
  proposal: 'Разбор готов',
  readAll: 'Прочитать все',
  today: 'Сегодня',
  earlier: 'Раньше',
  more: 'Показать ещё',
  empty: 'Новых событий нет',
  emptyHint: 'Сюда приходят замечания, которые ждут вас, и смены их статуса.',
  sound: 'Звук',
  desktop: 'На рабочем столе',
  desktopDenied: 'Браузер запретил уведомления — разрешите их в настройках сайта',
  unreadSr: 'Новое.',
  /** Действие без человека (сравнение кадров, разбор) — как в истории. */
  system: APP_NAME,
  remark: (number: number, title: string | null, round: number) => `№ ${number} · ${title ?? `Раунд ${round}`}`,
  /** Живая область для экранного диктора: только «ждёт вас». */
  live: (headline: string, number: number) => `${headline}, № ${number}`,
  /** Текст системного уведомления: без сути замечания — его видно на экране блокировки. */
  desktopBody: (number: number, round: number, project: string) => `№ ${number} · Раунд ${round} · ${project}`,
};

export const JOIN = {
  title: 'Приглашение в проект',
  lead: (project: string, role: string) => `Вас зовут в проект «${project}» — ${role.toLowerCase()}`,
  leadInstance: 'Вас приглашают руководителем приёмки: после входа вы сможете создавать проекты и звать участников',
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

/** Подписи переходов в истории замечания (GET /remarks/:id/history). Ключи — action с сервера. */
export const HISTORY_ACTION: Record<string, string> = {
  create: 'Замечание создано',
  import: 'Импортировано из журнала',
  reopen: 'Претензия открыта снова',
  fix_row: 'Строка журнала дописана',
  attach_screenshot: 'Скрин приложен',
  triage: 'Разбор запущен',
  proposal: 'Модель предложила',
  rejected_binding: 'Не та цитата — разбор снова',
  verdict: 'Решение',
  ready_for_retest: 'Разработчик: готово',
  retest: 'Кадр для ретеста приложен',
  retest_result: 'Кадры сравнили',
  close: 'Закрыто после ретеста',
  /** Строка `close` из ready_for_retest (ADR 010): карточка подменяет подпись по fromStatus. */
  close_checked: 'Закрыто без нового кадра: заказчик проверил сам',
  not_fixed: 'Не исправлено — снова в работу',
  link_duplicate: 'Связано с оригиналом',
  reopened_as: 'Претензию предъявили снова',
  cancel: 'Разбор остановлен',
  /** Строка `cancel` ретеста (из ready_for_retest или awaiting_business_close): кадр «Стало» и дифф помечены заменёнными. */
  cancel_retest: 'Ретест отменён: кадр «Стало» снят',
  run_failed: 'Разбор не удался',
};
