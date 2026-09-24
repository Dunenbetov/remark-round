/**
 * Демо проекта «Клиентский кабинет»: закрытый раунд 1 (5 замечаний) и открытый раунд 2 (14 замечаний как в дизайне).
 * Кадры из fixtures/screenshots, дифф настоящий (pixelmatch), цитаты — реальные чанки проиндексированного ТЗ.
 * Правило честной карточки: кадр показывает предмет замечания, иначе кадра нет; черновик утверждает только то, что есть
 * в процитированном разделе или на кадре; пояснение ретеста описывает настоящий дифф (seed-remarks.spec проверяет).
 * У каждой карточки полная история (ADR 011): кто создал, что предложила модель, кто решил, кто исправил, кто и как
 * закрыл — с датами демо-календаря (1–12 сентября 2026, время Алматы), чтобы «Раунды», «История» и xlsx-журнал было
 * что показать. Пересоздаётся при каждом seed: это демо, а не данные заказчика.
 */
import type { PrismaClient, ProposedClass, RemarkStatus, RetestOutcome, Role, ScreenshotKind, VerdictCode } from '@remarkround/db';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DiffService } from './diff/diff.service';
import { PROPOSED_LABEL_RU, RETEST_OUTCOME_RU } from './remarks/labels';
import { StorageService } from './storage/storage.service';

const ROOT = resolve(__dirname, '../../..');
export const ROUND_ID = 'c1111111-1111-4111-8111-111111111111';
export const ROUND_ONE_ID = 'c1111111-1111-4111-8111-111111111101';

/** Время демо-календаря: день сентября 2026 и часы по Алматы (UTC+5). */
const at = (day: number, hh: number, mm = 0): Date => new Date(Date.UTC(2026, 8, day, hh - 5, mm));
const plusMin = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * 60_000);

interface FrameFiles {
  /** Кадр «было» — приложен к замечанию. */
  before: string;
  /** Кадр «стало» после исправления. */
  after: string;
  /** Кадр «стало» круга, вернувшегося «не исправлено». */
  notFixedAfter?: string;
}

/** Наборы кадров из fixtures/screenshots. Все кадры набора одного размера: иначе дифф ответит «сравнить нельзя». */
export const FRAME_SETS: Record<'save' | 'payment', FrameFiles> = {
  // Форма профиля: серая кнопка «Сохранить», после исправления синяя
  save: { before: 'before-save-gray.png', after: 'after-save-blue.png' },
  // Оплата счёта: ошибка тостом сверху; «не исправлено» — тот же тост с другим текстом; исправлено — текст под полем
  payment: { before: 'before-payment-toast.png', after: 'after-payment-under-field.png', notFixedAfter: 'after-payment-toast-other.png' },
};
export type FrameSet = keyof typeof FRAME_SETS;

interface RetestSeed {
  outcome: RetestOutcome;
  explanation: string;
}

export interface SeedRemark {
  round: 1 | 2;
  number: number;
  /** День сентября, когда замечание появилось. */
  day: number;
  description: string;
  pageOrScreen: string;
  expected?: string;
  status: RemarkStatus;
  proposedClass?: ProposedClass;
  rationale?: string[];
  visionFacts?: string;
  /** Подписи разделов чанков: «§2.1 Primary», 'protocol' — чанк «Решения, которых нет в ТЗ» протокола. */
  cite?: string[];
  /** Кадры замечания — только если кадр показывает предмет претензии. */
  frames?: FrameSet;
  verdict?: VerdictCode;
  /** Слова PM к решению — внутренние, заказчику не показываются (ADR 007). */
  verdictComment?: string;
  fixed?: boolean;
  /** Первый круг ретеста, вернувшийся «не исправлено»: кадры остаются заменёнными (ADR 011). Нужен кадр notFixedAfter. */
  notFixedRetest?: RetestSeed;
  /** Ретест с новым кадром и диффом — текущий (ждёт закрытия или закрыт после него). Нужны кадры. */
  retest?: RetestSeed;
  /** Закрыто: после ретеста (`retest`) или заказчик проверил сам, без нового кадра (ADR 010). */
  closed?: { comment?: string };
  duplicateOfNumber?: number;
  /** Повтор претензии: номер закрытого оригинала в раунде 1. */
  originNumber?: number;
  /** Совет разработчика (Developer) по замечанию, которое ждёт PM. */
  advice?: { code: VerdictCode; comment?: string };
}

const NO_BASIS = 'В бумагах нет опоры.';
const DECIDE = 'Решите вы: работа это или новое желание.';
const NEED_FRAME = 'Для претензии про цвет или вёрстку нужен скрин: без него не сравнить с ТЗ.';

export const SEED_REMARKS: SeedRemark[] = [
  // ---------- раунд 1: сдан и закрыт 5 сентября ----------
  {
    round: 1,
    number: 1,
    day: 1,
    description: 'Кнопка «Войти» не реагирует на Enter',
    pageOrScreen: 'Вход',
    expected: 'Enter отправляет форму входа',
    status: 'closed',
    proposedClass: 'unspecified',
    rationale: [NO_BASIS, `ТЗ (§3) описывает форму входа: поля email и пароль, кнопка «Войти». Про отправку формы клавишей Enter в ТЗ и протоколе ничего нет. ${DECIDE}`],
    cite: ['§3 Вход'],
    verdict: 'defect',
    verdictComment: 'Enter на форме входа ждут все пользователи, берём как поломку',
    fixed: true,
    closed: { comment: 'Проверила на стенде: Enter отправляет форму' },
  },
  {
    round: 1,
    number: 2,
    day: 1,
    description: 'Опечатка в подвале: «Обратная свзяь»',
    pageOrScreen: 'Все страницы, подвал',
    expected: '«Обратная связь»',
    status: 'closed',
    proposedClass: 'unspecified',
    rationale: [NO_BASIS, `Про тексты подвала в ТЗ и протоколе ничего нет. ${DECIDE}`],
    verdict: 'defect',
    verdictComment: 'Опечатка, чиним без обсуждения',
    fixed: true,
    closed: { comment: 'Проверила на стенде: в подвале уже «Обратная связь»' },
  },
  {
    round: 1,
    number: 3,
    day: 2,
    description: 'Хотим уведомления в Telegram',
    pageOrScreen: 'Весь кабинет',
    expected: 'Сообщение в Telegram, когда выставлен счёт',
    status: 'change_request',
    proposedClass: 'change_request_candidate',
    rationale: [
      'Похоже, это новое желание.',
      'Уведомлений в ТЗ нет. По §6 то, чего нет в документе, становится новым желанием, если заказчик явно просит новое. Здесь так: «хотим уведомления». Решите, брать ли это в работу отдельно.',
    ],
    cite: ['§6 Чего в ТЗ нет (дыры)'],
    verdict: 'change_request',
    verdictComment: 'Не в ТЗ, оценим отдельным доп. соглашением',
  },
  {
    round: 1,
    number: 4,
    day: 2,
    description: 'Счёт не скачивается в PDF',
    pageOrScreen: 'Оплата счёта',
    expected: 'Кнопка «Скачать PDF» открывает счёт',
    status: 'closed',
    proposedClass: 'unspecified',
    rationale: [NO_BASIS, `Про скачивание счёта в PDF в ТЗ и протоколе ничего нет. ${DECIDE}`],
    verdict: 'defect',
    verdictComment: 'Кнопка «Скачать PDF» на экране есть и не работает, это поломка',
    fixed: true,
    closed: { comment: 'Проверила на трёх счетах: скачивается' },
  },
  {
    round: 1,
    number: 5,
    day: 2,
    description: 'Телефон в профиле не сохраняется',
    pageOrScreen: 'Профиль компании',
    expected: 'Телефон сохраняется после «Сохранить»',
    status: 'closed',
    proposedClass: 'defect_candidate',
    rationale: [
      'Похоже, это поломка относительно ТЗ.',
      'ТЗ (§2.1) предусматривает кнопку «Сохранить» на форме профиля. Если после неё телефон не сохраняется, это похоже на поломку. Какие поля есть в профиле, ТЗ не перечисляет.',
    ],
    cite: ['§2.1 Primary'],
    verdict: 'defect',
    fixed: true,
    closed: { comment: 'Проверила на стенде: телефон сохраняется' },
  },

  // ---------- раунд 2: идёт с 7 сентября ----------
  {
    round: 2,
    number: 12,
    day: 11,
    description: 'Кнопка «Сохранить» серая',
    pageOrScreen: 'Профиль компании',
    expected: 'Синяя primary-кнопка при заполненных полях',
    status: 'awaiting_pm',
    proposedClass: 'defect_candidate',
    rationale: ['Похоже, это поломка относительно ТЗ.', 'ТЗ (§2.1) требует синюю primary-кнопку «Сохранить» на форме профиля. На кадре при заполненных полях она серая. Похожих замечаний в раунде нет.'],
    visionFacts: 'кнопка «Сохранить» серая, поля заполнены.',
    cite: ['§2.1 Primary'],
    frames: 'save',
    advice: { code: 'defect', comment: 'В ТЗ §2.1 однозначно, чиню за час' },
  },
  {
    round: 2,
    number: 13,
    day: 11,
    description: 'Хотим тёмную тему',
    pageOrScreen: 'Весь кабинет',
    expected: 'Чтобы ночью не слепило',
    status: 'awaiting_pm',
    proposedClass: 'change_request_candidate',
    rationale: ['Похоже, это новое желание.', 'ТЗ (§6) прямо относит тёмную тему к тому, чего в проекте нет. Это не поломка, а новое желание: решите, брать ли его в работу отдельно.'],
    cite: ['§6 Чего в ТЗ нет (дыры)'],
    advice: { code: 'change_request', comment: 'Тёмной темы в ТЗ нет, это отдельная задача на пару дней' },
  },
  {
    round: 2,
    number: 14,
    day: 11,
    description: 'Выгрузка в Excel',
    pageOrScreen: 'Список заказов',
    expected: 'Как в старой 1С',
    status: 'awaiting_pm',
    proposedClass: 'unspecified',
    rationale: [NO_BASIS, `Заказчик просит выгрузку в Excel. ТЗ (§6) называет выгрузку реестра в Excel среди того, чего в документе нет. Протокол о ней молчит. ${DECIDE}`],
    cite: ['§6 Чего в ТЗ нет (дыры)'],
  },
  {
    round: 2,
    number: 15,
    day: 11,
    description: 'Цвет ссылок в футере',
    pageOrScreen: 'Все страницы, футер',
    status: 'cannot_tell',
    proposedClass: 'cannot_tell',
    rationale: ['Недостаточно данных.', NEED_FRAME],
    verdict: 'cannot_tell',
  },
  {
    // Запасной ретест демо: кадры «было» и «стало» одного размера, дифф настоящий, ждёт закрытия заказчиком.
    // В истории — круг «не исправлено»: разработчик поменял текст тоста, тост остался.
    round: 2,
    number: 7,
    day: 9,
    description: 'Ошибка оплаты тостом',
    pageOrScreen: 'Оплата счёта',
    expected: 'Текст ошибки под полем, а не тостом сверху',
    status: 'awaiting_business_close',
    proposedClass: 'defect_candidate',
    rationale: [
      'Похоже, это поломка относительно ТЗ.',
      'ТЗ (§4.2) требует текст ошибки платежа под полем, красным, не тост. На кадре ошибка 500 показана красным тостом сверху, под полями текста нет. Протокол от 12.03 это подтверждает: тост с демо 11.03 считать дефектом. Похожих замечаний в раунде нет.',
    ],
    visionFacts: 'красный тост сверху «Ошибка 500: платёж не прошёл», под полями «Сумма» и «Карта» текста ошибки нет.',
    cite: ['§4.2 Ошибки', 'protocol'],
    frames: 'payment',
    verdict: 'defect',
    fixed: true,
    notFixedRetest: {
      outcome: 'likely_unchanged',
      explanation: 'Красное на диффе: только текст внутри тоста сверху. Ошибка по-прежнему показана тостом, под полем её нет, а §4.2 требует текст под полем.',
    },
    retest: {
      outcome: 'likely_addressed',
      explanation: 'Красное на диффе: тост сверху исчез, рамка поля «Карта» стала красной, под полем появился красный текст «Платёж не прошёл: ошибка 500». Так требует §4.2: ошибка под полем, не тост. Остальное без изменений.',
    },
  },
  {
    round: 2,
    number: 5,
    day: 9,
    description: 'Фильтр клиентов сбрасывается при обновлении',
    pageOrScreen: 'Список клиентов',
    expected: 'Фильтр должен переживать обновление страницы',
    status: 'defect',
    proposedClass: 'unspecified',
    rationale: [NO_BASIS, `Про фильтр списка клиентов и его сохранение в ТЗ и протоколе ничего нет. ${DECIDE}`],
    verdict: 'defect',
    verdictComment: 'Прямой нормы нет, но без этого кабинетом не пользоваться. Берём',
  },
  {
    round: 2,
    number: 3,
    day: 8,
    description: 'Сортировка списка заказов',
    pageOrScreen: 'Список заказов',
    expected: 'Сортировка по дате должна применяться',
    status: 'defect',
    proposedClass: 'unspecified',
    rationale: [NO_BASIS, `Про сортировку списка заказов в ТЗ и протоколе ничего нет. ${DECIDE}`],
    verdict: 'defect',
    verdictComment: 'Сортировка по дате на экране есть и не работает, это поломка',
  },
  {
    round: 2,
    number: 9,
    day: 9,
    description: 'Повтор №4 про поиск',
    pageOrScreen: 'Поиск',
    status: 'duplicate',
    proposedClass: 'duplicate',
    rationale: ['Похоже на повтор №4.', 'Та же претензия к поиску по клиентам, что и в №4. Отдельной работы не нужно.'],
    verdict: 'duplicate',
    duplicateOfNumber: 4,
  },
  {
    round: 2,
    number: 4,
    day: 7,
    description: 'Поиск по клиентам не находит по БИН',
    pageOrScreen: 'Поиск',
    expected: 'Поиск по БИН находит клиента',
    status: 'closed',
    proposedClass: 'unspecified',
    rationale: [NO_BASIS, `Про поиск клиентов по БИН в ТЗ и протоколе ничего нет. ${DECIDE}`],
    verdict: 'defect',
    verdictComment: 'Поиск по БИН нужен бухгалтерии каждый день, берём',
    fixed: true,
    closed: { comment: 'Проверила: клиент находится по БИН' },
  },
  {
    // Закрытие без нового кадра (ADR 010): разработчик нажал «Готово», заказчик проверяет сам
    round: 2,
    number: 8,
    day: 8,
    description: 'Шапка перекрывает форму на планшете',
    pageOrScreen: 'Профиль компании, планшет',
    expected: 'Форма видна целиком',
    status: 'ready_for_retest',
    proposedClass: 'cannot_tell',
    rationale: ['Недостаточно данных.', `${NEED_FRAME} ТЗ (§1) описывает веб-кабинет, «не мобильное приложение»; про планшет отдельной нормы нет.`],
    cite: ['§1 Назначение'],
    verdict: 'defect',
    verdictComment: 'Сама видела на планшете: шапка закрывает первое поле. Берём',
    fixed: true,
  },
  {
    round: 2,
    number: 2,
    day: 7,
    description: 'Логотип не по центру',
    pageOrScreen: 'Шапка',
    expected: 'Логотип по центру',
    status: 'ready_for_retest',
    proposedClass: 'cannot_tell',
    rationale: ['Недостаточно данных.', `${NEED_FRAME} Про логотип и шапку в ТЗ ничего нет.`],
    verdict: 'defect',
    verdictComment: 'Логотип сдвинут на всех страницах, видно и без скрина. Берём',
    fixed: true,
  },
  {
    round: 2,
    number: 6,
    day: 8,
    description: 'Пагинация пропадает на второй странице',
    pageOrScreen: 'Список заказов',
    status: 'ready_for_retest',
    proposedClass: 'unspecified',
    rationale: [NO_BASIS, `Про постраничный вывод списка заказов в ТЗ и протоколе ничего нет. ${DECIDE}`],
    verdict: 'defect',
    verdictComment: 'Без пагинации список заказов не просмотреть. Берём',
    fixed: true,
  },
  {
    round: 2,
    number: 1,
    day: 7,
    description: 'Не открывается профиль',
    pageOrScreen: 'Профиль компании',
    expected: 'Профиль открывается по ссылке',
    status: 'closed',
    proposedClass: 'defect_candidate',
    rationale: ['Похоже, это поломка относительно ТЗ.', 'ТЗ (§1) включает профиль в кабинет: «вход, профиль, оплата счетов». Профиль, который не открывается по ссылке, похож на поломку.'],
    cite: ['§1 Назначение'],
    verdict: 'defect',
    fixed: true,
    closed: { comment: 'Проверила: профиль открывается' },
  },
  {
    // Повтор претензии: в раунде 1 телефон закрыли, заказчик снова видит ту же проблему (docs/STATUS.md closed → reopened)
    round: 2,
    number: 10,
    day: 7,
    description: 'Телефон в профиле не сохраняется',
    pageOrScreen: 'Профиль компании',
    expected: 'Телефон сохраняется после «Сохранить»',
    status: 'awaiting_pm',
    proposedClass: 'duplicate',
    rationale: ['Похоже на повтор закрытого замечания.', 'Та же претензия, что № 5 раунда 1. Её закрыли 4 сентября: заказчик проверил на стенде, без нового кадра. Решите, работа ли это снова.'],
    originNumber: 5,
  },
];

interface People {
  pm: { id: string; name: string };
  business: { id: string; name: string };
  developer: { id: string; name: string };
}

type Who = 'pm' | 'business' | 'developer' | null;

interface HistoryRow {
  action: string;
  fromStatus: RemarkStatus | null;
  toStatus: RemarkStatus;
  who: Who;
  createdAt: Date;
  detail?: string;
  comment?: string;
  shot?: 'original' | 'retest0' | 'diff0' | 'retest' | 'diff';
}

/**
 * Путь замечания до его статуса — те же действия и в том же порядке, что пишет RemarksService: создано → разбор →
 * предложение модели → решение PM → «Готово» → ретест(ы) → закрытие. Время растёт от дня создания.
 */
export function timeline(r: SeedRemark): { rows: HistoryRow[]; closedAt: Date | null; verdictAt: Date | null; supersededAt: Date | null } {
  const rows: HistoryRow[] = [];
  const created = at(r.day, 10, r.number * 3);
  const push = (row: HistoryRow) => rows.push(row);
  const start: RemarkStatus = r.originNumber ? 'reopened' : 'imported';
  push({ action: r.originNumber ? 'reopen' : 'create', fromStatus: null, toStatus: start, who: 'business', createdAt: created, shot: r.frames ? 'original' : undefined, detail: r.originNumber ? `Повтор № ${r.originNumber} из раунда 1` : undefined });
  push({ action: 'triage', fromStatus: start, toStatus: 'triaging', who: 'business', createdAt: plusMin(created, 1) });
  const proposalDetail = r.proposedClass ? `${PROPOSED_LABEL_RU[r.proposedClass]}${r.rationale?.[1] ? `: ${r.rationale[1]}` : ''}`.slice(0, 300) : undefined;
  push({ action: 'proposal', fromStatus: 'triaging', toStatus: 'awaiting_pm', who: null, createdAt: plusMin(created, 2), detail: proposalDetail });
  if (!r.verdict) return { rows, closedAt: null, verdictAt: null, supersededAt: null };

  const verdictAt = at(r.day + 1, 11, r.number * 2);
  const afterVerdict: RemarkStatus = r.verdict === 'rejected_binding' ? 'triaging' : r.verdict;
  push({ action: 'verdict', fromStatus: 'awaiting_pm', toStatus: afterVerdict, who: 'pm', createdAt: verdictAt, comment: r.verdictComment });
  if (r.duplicateOfNumber) push({ action: 'link_duplicate', fromStatus: 'duplicate', toStatus: 'duplicate', who: 'pm', createdAt: plusMin(verdictAt, 1), detail: `Оригинал — № ${r.duplicateOfNumber}` });
  if (!r.fixed) return { rows, closedAt: null, verdictAt, supersededAt: null };

  let t = at(r.day + 2, 15, r.number * 2);
  push({ action: 'ready_for_retest', fromStatus: 'defect', toStatus: 'ready_for_retest', who: 'developer', createdAt: t });
  let supersededAt: Date | null = null;
  if (r.notFixedRetest) {
    t = plusMin(t, 120);
    push({ action: 'retest', fromStatus: 'ready_for_retest', toStatus: 'ready_for_retest', who: 'business', createdAt: t, shot: 'retest0' });
    push({ action: 'retest_result', fromStatus: 'ready_for_retest', toStatus: 'awaiting_business_close', who: null, createdAt: plusMin(t, 1), shot: 'diff0', detail: `${RETEST_OUTCOME_RU[r.notFixedRetest.outcome]} — ${r.notFixedRetest.explanation}`.slice(0, 300) });
    supersededAt = plusMin(t, 10);
    push({ action: 'not_fixed', fromStatus: 'awaiting_business_close', toStatus: 'defect', who: 'business', createdAt: supersededAt });
    t = at(r.day + 3, 12, r.number * 2);
    push({ action: 'ready_for_retest', fromStatus: 'defect', toStatus: 'ready_for_retest', who: 'developer', createdAt: t });
  }
  if (r.retest) {
    t = plusMin(t, 90);
    push({ action: 'retest', fromStatus: 'ready_for_retest', toStatus: 'ready_for_retest', who: 'business', createdAt: t, shot: 'retest' });
    push({ action: 'retest_result', fromStatus: 'ready_for_retest', toStatus: 'awaiting_business_close', who: null, createdAt: plusMin(t, 1), shot: 'diff', detail: `${RETEST_OUTCOME_RU[r.retest.outcome]} — ${r.retest.explanation}`.slice(0, 300) });
  }
  if (!r.closed) return { rows, closedAt: null, verdictAt, supersededAt };
  const closedAt = plusMin(t, 30);
  push({ action: 'close', fromStatus: r.retest ? 'awaiting_business_close' : 'ready_for_retest', toStatus: 'closed', who: 'business', createdAt: closedAt, comment: r.closed.comment });
  return { rows, closedAt, verdictAt, supersededAt };
}

interface Frame {
  png: Buffer;
  width: number;
  height: number;
}

interface LoadedFrames {
  before: Frame;
  after: Frame;
  diff: Frame | null;
  notFixedAfter: Frame | null;
  notFixedDiff: Frame | null;
}

/** Размер PNG из заголовка IHDR: ширина и высота — два uint32 сразу после сигнатуры и длины чанка. */
const pngFrame = (png: Buffer): Frame => ({ png, width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

async function loadFrames(set: FrameSet, diff: DiffService): Promise<LoadedFrames> {
  const files = FRAME_SETS[set];
  const load = async (name: string) => pngFrame(await readFile(resolve(ROOT, 'fixtures/screenshots', name)));
  const before = await load(files.before);
  // Дифф в демо настоящий: pixelmatch по тем же кадрам, а не нарисованная маска
  const diffOf = (after: Frame): Frame | null => {
    const d = diff.compare(before.png, after.png);
    return d.kind === 'ok' ? { png: d.png, width: d.width, height: d.height } : null;
  };
  const after = await load(files.after);
  const notFixedAfter = files.notFixedAfter ? await load(files.notFixedAfter) : null;
  return { before, after, diff: diffOf(after), notFixedAfter, notFixedDiff: notFixedAfter ? diffOf(notFixedAfter) : null };
}

export async function seedRemarks(
  prisma: PrismaClient,
  ids: { projectId: string; specDocumentId: string; protocolDocumentId: string; pmId: string; businessId: string; developerId: string },
): Promise<void> {
  // Ретест без кадров — выдумка: «не исправлено» и дифф бывают только с новым кадром (ADR 010)
  for (const r of SEED_REMARKS) {
    if ((r.retest || r.notFixedRetest) && !r.frames) throw new Error(`seed: у № ${r.number} раунда ${r.round} ретест без кадров`);
    if (r.notFixedRetest && r.frames && !FRAME_SETS[r.frames].notFixedAfter) throw new Error(`seed: у № ${r.number} раунда ${r.round} нет кадра круга «не исправлено»`);
  }
  const storage = new StorageService();
  const diff = new DiffService();
  const frameSets = new Map<FrameSet, LoadedFrames>();
  for (const set of new Set(SEED_REMARKS.flatMap((r) => (r.frames ? [r.frames] : [])))) frameSets.set(set, await loadFrames(set, diff));

  const users = await prisma.user.findMany({ where: { id: { in: [ids.pmId, ids.businessId, ids.developerId] } }, select: { id: true, name: true } });
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? '';
  const people: People = { pm: { id: ids.pmId, name: nameOf(ids.pmId) }, business: { id: ids.businessId, name: nameOf(ids.businessId) }, developer: { id: ids.developerId, name: nameOf(ids.developerId) } };

  // Чистим оба демо-раунда. Вердикты и прогоны не каскадятся; история и кадры уходят каскадом вместе с замечанием —
  // триггер «только дописывается» пропускает каскад (ADR 011).
  const wipe = async (roundId: string) => {
    const oldIds = (await prisma.remark.findMany({ where: { roundId }, select: { id: true } })).map((r) => r.id);
    await prisma.developerAdvice.deleteMany({ where: { remarkId: { in: oldIds } } });
    await prisma.humanVerdict.deleteMany({ where: { remarkId: { in: oldIds } } });
    await prisma.agentRun.deleteMany({ where: { remarkId: { in: oldIds } } });
    await prisma.remark.deleteMany({ where: { id: { in: oldIds } } });
  };
  await wipe(ROUND_ID);
  // Раунд 1 пересоздаётся целиком: его события (закрыт 5 сентября) уходят каскадом и пишутся заново
  const roundOne = await prisma.round.findUnique({ where: { projectId_number: { projectId: ids.projectId, number: 1 } }, select: { id: true } });
  if (roundOne) {
    await wipe(roundOne.id);
    await prisma.importJob.deleteMany({ where: { roundId: roundOne.id } });
    await prisma.round.delete({ where: { id: roundOne.id } });
  }
  await prisma.round.create({
    data: { id: ROUND_ONE_ID, projectId: ids.projectId, number: 1, status: 'closed', createdAt: at(1, 10), closedAt: at(5, 17, 30), closedByUserId: ids.pmId },
  });
  await prisma.round.upsert({
    where: { id: ROUND_ID },
    create: { id: ROUND_ID, projectId: ids.projectId, number: 2, createdAt: at(7, 10) },
    update: { status: 'open', closedAt: null, closedByUserId: null, createdAt: at(7, 10) },
  });
  // События раундов с фиксированными id: удалять их нельзя (триггер), повторный seed их не дублирует
  const event = (id: string, roundId: string, action: 'open' | 'close', createdAt: Date) => ({ id, roundId, projectId: ids.projectId, action, userId: ids.pmId, actorName: people.pm.name, role: 'pm' as Role, createdAt });
  await prisma.roundEvent.createMany({
    data: [
      event('e1111111-1111-4111-8111-111111111101', ROUND_ONE_ID, 'open', at(1, 10)),
      event('e1111111-1111-4111-8111-111111111102', ROUND_ONE_ID, 'close', at(5, 17, 30)),
      event('e1111111-1111-4111-8111-111111111201', ROUND_ID, 'open', at(7, 10)),
    ],
    skipDuplicates: true,
  });

  const chunks = await prisma.documentChunk.findMany({
    where: { documentId: { in: [ids.specDocumentId, ids.protocolDocumentId] } },
    select: { id: true, section: true, documentId: true, content: true, document: { select: { title: true, kind: true, effectiveAt: true } } },
  });
  type SeedChunk = (typeof chunks)[number];
  const chunkFor = (label: string): SeedChunk | undefined =>
    label === 'protocol'
      ? (chunks.find((c) => c.documentId === ids.protocolDocumentId && /Решения/.test(c.section ?? '')) ?? chunks.find((c) => c.documentId === ids.protocolDocumentId))
      : chunks.find((c) => c.documentId === ids.specDocumentId && c.section === label);
  // Цитата — снимок текста и подписи документа, как её пишет applyProposal (аудит: evidence-citation-dangling)
  const citationOf = (c: SeedChunk) => ({ chunkId: c.id, quoteText: c.content, section: c.section, documentTitle: c.document.title, documentKind: c.document.kind, effectiveAt: c.document.effectiveAt });

  const created = new Map<string, { id: string; closedAt: Date | null }>();
  const key = (round: number, number: number) => `${round}:${number}`;
  // Раунд 1 раньше раунда 2, оригиналы раньше повторов: duplicateOfId и originRemarkId есть куда направить
  const ordered = [...SEED_REMARKS].sort((a, b) => a.round - b.round || (a.duplicateOfNumber ? 1 : 0) - (b.duplicateOfNumber ? 1 : 0));
  for (const r of ordered) {
    const { rows, closedAt, verdictAt, supersededAt } = timeline(r);
    type Shot = { kind: ScreenshotKind; storageKey: string; width: number; height: number; supersededAt: Date | null; createdAt: Date };
    const shots: Partial<Record<NonNullable<HistoryRow['shot']>, Shot>> = {};
    const shotAt = (name: NonNullable<HistoryRow['shot']>) => rows.find((h) => h.shot === name)?.createdAt ?? at(r.day, 10);
    const put = async (name: NonNullable<HistoryRow['shot']>, kind: ScreenshotKind, file: string, frame: Frame | null, superseded: Date | null) => {
      if (!frame) return;
      shots[name] = { kind, storageKey: await storage.save(ids.projectId, file, frame.png), width: frame.width, height: frame.height, supersededAt: superseded, createdAt: shotAt(name) };
    };
    const frames = r.frames ? frameSets.get(r.frames)! : null;
    if (frames) {
      await put('original', 'original', 'before.png', frames.before, null);
      if (r.notFixedRetest) {
        await put('retest0', 'retest', 'after.png', frames.notFixedAfter, supersededAt);
        await put('diff0', 'diff', 'diff.png', frames.notFixedDiff, supersededAt);
      }
      if (r.retest) {
        await put('retest', 'retest', 'after.png', frames.after, null);
        await put('diff', 'diff', 'diff.png', frames.diff, null);
      }
    }
    const cited = (r.cite ?? []).map(chunkFor).filter((x): x is SeedChunk => Boolean(x));
    const roundId = r.round === 1 ? ROUND_ONE_ID : ROUND_ID;

    const remark = await prisma.remark.create({
      data: {
        projectId: ids.projectId,
        roundId,
        number: r.number,
        description: r.description,
        pageOrScreen: r.pageOrScreen,
        expected: r.expected ?? null,
        status: r.status,
        authorId: ids.businessId,
        proposedClass: r.proposedClass ?? null,
        rationale: r.rationale?.join('\n\n') ?? null,
        visionFacts: r.visionFacts ?? null,
        // Итог ретеста на карточке — только у текущего круга: «не исправлено» его снимает
        retestOutcome: r.retest?.outcome ?? null,
        retestExplanation: r.retest?.explanation ?? null,
        fixedByUserId: r.fixed ? ids.developerId : null,
        closedByUserId: closedAt ? ids.businessId : null,
        closedAt,
        duplicateOfId: r.duplicateOfNumber ? (created.get(key(r.round, r.duplicateOfNumber))?.id ?? null) : null,
        originRemarkId: r.originNumber ? (created.get(key(1, r.originNumber))?.id ?? null) : null,
        createdAt: rows[0]!.createdAt,
        citations: { create: cited.map(citationOf) },
      },
    });
    created.set(key(r.round, r.number), { id: remark.id, closedAt });

    const shotIds: Partial<Record<NonNullable<HistoryRow['shot']>, string>> = {};
    for (const [name, s] of Object.entries(shots) as Array<[NonNullable<HistoryRow['shot']>, Shot]>) {
      const row = await prisma.remarkScreenshot.create({ data: { remarkId: remark.id, kind: s.kind, storageKey: s.storageKey, width: s.width, height: s.height, createdAt: s.createdAt, supersededAt: s.supersededAt } });
      shotIds[name] = row.id;
    }
    if (r.advice) {
      await prisma.developerAdvice.create({ data: { remarkId: remark.id, userId: ids.developerId, code: r.advice.code, comment: r.advice.comment ?? null } });
    }

    // Прогон без модели и без графа: model 'seed', чекпоинта и трейса в Langfuse у него нет (docs/DEMO.md)
    const run = await prisma.agentRun.create({
      data: { remarkId: remark.id, projectId: ids.projectId, mode: 'triage', status: r.verdict ? 'persisted' : 'awaiting_human', model: 'seed', proposedClass: r.proposedClass ?? null, rationale: r.rationale?.join('\n\n') ?? null, createdAt: rows[1]!.createdAt },
    });
    if (r.verdict && verdictAt) {
      await prisma.humanVerdict.create({
        data: { remarkId: remark.id, runId: run.id, userId: ids.pmId, code: r.verdict, comment: r.verdictComment ?? null, idempotencyKey: `seed-${r.round}-${r.number}`, createdAt: verdictAt },
      });
    }

    const person = (who: Who) => (who ? { userId: people[who].id, actorName: people[who].name, role: who as Role } : { userId: null, actorName: null, role: null });
    await prisma.remarkStatusChange.createMany({
      data: rows.map((h) => ({
        remarkId: remark.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        action: h.action,
        ...person(h.who),
        runId: ['triage', 'proposal', 'verdict'].includes(h.action) ? run.id : null,
        detail: h.detail ?? null,
        comment: h.comment ?? null,
        screenshotId: h.shot ? (shotIds[h.shot] ?? null) : null,
        createdAt: h.createdAt,
      })),
    });

    // Оригинал повтора помнит, что претензию предъявили снова (ADR 011)
    if (r.originNumber) {
      const original = created.get(key(1, r.originNumber));
      if (original) {
        await prisma.remarkStatusChange.create({
          data: { remarkId: original.id, fromStatus: 'closed', toStatus: 'closed', action: 'reopened_as', ...person('business'), detail: `Повтор в раунде 2 — № ${r.number}`, createdAt: rows[0]!.createdAt },
        });
      }
    }
  }
  const inRound = (n: number) => SEED_REMARKS.filter((r) => r.round === n).length;
  console.log(`seed: round 1 (closed) — ${inRound(1)} remarks, round 2 — ${inRound(2)} remarks, with history`);
}
