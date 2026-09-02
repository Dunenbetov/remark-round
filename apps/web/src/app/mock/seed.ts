/**
 * Мок-данные из дизайна (docs/ui/CLAUDE-DESIGN-PROMPT.md §3 и артборды RemarkRound.dc.html).
 * Проект «Клиентский кабинет», раунд 2, 12 замечаний, 4 ждут решения.
 */
import type { Citation, ImportRow, Project, ProjectDocument, Remark, Round, User } from '../core/models';

export const PROJECT_ID = 'client-cabinet';
export const ROUND_NUMBER = 2;

export const USERS: User[] = [
  {
    id: 'u-dana',
    email: 'dana@remarkround.dev',
    name: 'Дана',
    initial: 'Д',
    role: 'pm',
    tone: 'accent',
    roleGenitive: 'решает, работа ли это',
  },
  {
    id: 'u-aigerim',
    email: 'aigerim@remarkround.dev',
    name: 'Айгерим',
    initial: 'А',
    role: 'business',
    tone: 'wait',
    roleGenitive: 'принимает работу',
  },
  {
    id: 'u-timur',
    email: 'timur@remarkround.dev',
    name: 'Тимур',
    initial: 'Т',
    role: 'developer',
    tone: 'work',
    roleGenitive: 'разработчик',
  },
];

export const PROJECT: Project = {
  id: PROJECT_ID,
  name: 'Клиентский кабинет',
  memberIds: USERS.map((u) => u.id),
};

export const ROUND: Round = { projectId: PROJECT_ID, number: ROUND_NUMBER, status: 'open' };

export const CITE_SPEC_2_1: Citation = {
  id: 'c-spec-2-1',
  source: 'spec',
  heading: 'В ТЗ (§2.1):',
  section: '§2.1',
  text: '«Основная кнопка формы „Сохранить“ синяя (primary), активна при валидных полях»',
};

export const CITE_SPEC_4_3: Citation = {
  id: 'c-spec-4-3',
  source: 'spec',
  heading: 'В ТЗ (§4.3):',
  section: '§4.3',
  text: '«Недоступное состояние кнопки — серое, только пока обязательные поля не заполнены»',
};

export const CITE_PROTOCOL_12_03: Citation = {
  id: 'c-protocol-12-03',
  source: 'protocol',
  heading: 'Протокол от 12.03:',
  text: '«Цвета кнопок по макету, без изменений»',
  soft: true,
};

const CITE_SPEC_4_2: Citation = {
  id: 'c-spec-4-2',
  source: 'spec',
  heading: 'В ТЗ (§4.2):',
  section: '§4.2',
  text: '«Текст ошибки оплаты показывается под полем, красным. Не тостом и не модальным окном»',
};

const CITE_SPEC_3_2: Citation = {
  id: 'c-spec-3-2',
  source: 'spec',
  heading: 'В ТЗ (§3.2):',
  section: '§3.2',
  text: '«Список заказов: фильтры и сортировка сохраняются при обновлении страницы»',
};

const r = (
  number: number,
  fields: Omit<Remark, 'id' | 'projectId' | 'roundNumber' | 'number' | 'description'> & { description?: string },
): Remark => ({
  id: `rm-${number}`,
  projectId: PROJECT_ID,
  roundNumber: ROUND_NUMBER,
  number,
  description: fields.description ?? fields.title,
  ...fields,
});

/** Порядок — как в таблице артборда «Журнал раунда». */
export const REMARKS: Remark[] = [
  r(12, {
    title: 'Кнопка «Сохранить» серая',
    pageOrScreen: 'Профиль компании',
    expected: 'Синяя primary-кнопка при заполненных полях',
    status: 'awaiting_pm',
    authorId: 'u-aigerim',
    screenshots: [{ kind: 'original', variant: 'grey', fileName: 'profil-kompanii.png' }],
    citations: [CITE_SPEC_2_1, CITE_PROTOCOL_12_03],
    seen: 'кнопка «Сохранить» серая, поля заполнены.',
    draft: [
      'Похоже, это поломка относительно ТЗ.',
      'ТЗ требует синюю primary-кнопку; на кадре при заполненных полях она серая. Похожих замечаний в раунде нет.',
    ],
    draftShort: 'Похоже, это поломка относительно ТЗ',
    proposedClass: 'defect_candidate',
    devNote: 'Ждём синюю primary-кнопку при заполненных полях',
  }),
  r(13, {
    title: 'Хотим тёмную тему',
    pageOrScreen: 'Весь кабинет',
    expected: 'Чтобы ночью не слепило',
    status: 'awaiting_pm',
    authorId: 'u-aigerim',
    screenshots: [],
    citations: [
      {
        id: 'c-spec-6',
        source: 'spec',
        heading: 'В ТЗ (§6):',
        section: '§6',
        text: '«Тёмная тема, выгрузка в Excel, 2FA и переключение языка в объём не входят»',
      },
    ],
    draft: [
      'Похоже, это новое желание.',
      'В ТЗ (§6) тёмная тема прямо отнесена к тому, чего в проекте нет. Это не поломка, а новое желание — решите, брать ли его в работу отдельно.',
    ],
    draftShort: 'Похоже, это новое желание',
    proposedClass: 'change_request_candidate',
  }),
  r(14, {
    title: 'Выгрузка в Excel',
    pageOrScreen: 'Список заказов',
    expected: 'Как в старой 1С',
    status: 'awaiting_pm',
    authorId: 'u-aigerim',
    screenshots: [],
    citations: [
      {
        id: 'c-none-excel',
        source: 'spec',
        heading: 'В ТЗ:',
        text: 'Про выгрузку в Excel ни в ТЗ, ни в протоколе ничего нет.',
        soft: true,
      },
    ],
    draft: [
      'В бумагах нет опоры.',
      'Заказчик просит выгрузку списка заказов в Excel. В ТЗ раздел «Список заказов» (§3.2) описывает фильтры и сортировку, про выгрузку не сказано. Решите вы: работа это или новое желание.',
    ],
    draftShort: 'В бумагах нет опоры',
    proposedClass: 'unspecified',
  }),
  r(15, {
    title: 'Цвет ссылок в футере',
    pageOrScreen: 'Все страницы, футер',
    status: 'cannot_tell',
    authorId: 'u-aigerim',
    screenshots: [],
    citations: [],
    draft: [],
    draftShort: 'Недостаточно данных',
    proposedClass: 'cannot_tell',
  }),
  r(7, {
    title: 'Ошибка оплаты тостом',
    pageOrScreen: 'Оплата счёта',
    expected: 'Ошибка под полем красным',
    status: 'defect',
    authorId: 'u-aigerim',
    screenshots: [{ kind: 'original', variant: 'grey', fileName: 'oplata.png' }],
    citations: [CITE_SPEC_4_2],
    seen: 'ошибка 500 показана тостом сверху, под полем пусто.',
    draft: [
      'Похоже, это поломка относительно ТЗ.',
      'ТЗ (§4.2) требует текст ошибки под полем; на кадре ошибка показана тостом. Протокол от 12.03 подтверждает, что это поломка.',
    ],
    draftShort: 'Похоже, это поломка относительно ТЗ',
    proposedClass: 'defect_candidate',
    verdict: { code: 'defect', userId: 'u-dana', at: '11:40' },
    devNote: 'Ошибка показывается тостом на 3 секунды, а не текстом под формой',
  }),
  r(5, {
    title: 'Фильтр клиентов сбрасывается при обновлении',
    pageOrScreen: 'Список клиентов',
    status: 'defect',
    authorId: 'u-aigerim',
    screenshots: [{ kind: 'original', variant: 'grey', fileName: 'klienty.png' }],
    citations: [CITE_SPEC_3_2],
    seen: 'после обновления страницы фильтр «Активные» снят.',
    draft: [
      'Похоже, это поломка относительно ТЗ.',
      'ТЗ (§3.2) требует сохранять фильтры при обновлении; на кадре после обновления фильтр сброшен.',
    ],
    draftShort: 'Похоже, это поломка относительно ТЗ',
    proposedClass: 'defect_candidate',
    verdict: { code: 'defect', userId: 'u-dana', at: '11:52' },
    devNote: 'Фильтр должен переживать обновление страницы',
  }),
  r(9, {
    title: 'Повтор №4 про поиск',
    pageOrScreen: 'Поиск',
    status: 'duplicate',
    authorId: 'u-aigerim',
    screenshots: [],
    citations: [],
    draft: ['Похоже на повтор №4.', 'Та же претензия к поиску по клиентам, что и в №4. Отдельной работы не нужно.'],
    draftShort: 'Похоже на повтор №4',
    proposedClass: 'duplicate',
    duplicateOfNumber: 4,
    verdict: { code: 'duplicate', userId: 'u-dana', at: '12:05' },
  }),
  r(3, {
    title: 'Сортировка списка заказов',
    pageOrScreen: 'Список заказов',
    status: 'ready_for_retest',
    authorId: 'u-aigerim',
    screenshots: [{ kind: 'original', variant: 'blue', fileName: 'zakazy.png' }],
    citations: [CITE_SPEC_3_2],
    seen: 'сортировка по дате не применяется.',
    draft: ['Похоже, это поломка относительно ТЗ.', 'ТЗ (§3.2) требует сортировку по дате; на кадре список не отсортирован.'],
    draftShort: 'Похоже, это поломка относительно ТЗ',
    proposedClass: 'defect_candidate',
    verdict: { code: 'defect', userId: 'u-dana', at: '10:15' },
    fixedByUserId: 'u-timur',
    devNote: 'Сортировка по дате должна применяться',
  }),
  r(8, {
    title: 'Шапка перекрывает форму на планшете',
    pageOrScreen: 'Профиль компании, планшет',
    status: 'ready_for_retest',
    authorId: 'u-aigerim',
    screenshots: [{ kind: 'original', variant: 'blue', fileName: 'planshet.png' }],
    citations: [
      {
        id: 'c-spec-1-3',
        source: 'spec',
        heading: 'В ТЗ (§1.3):',
        section: '§1.3',
        text: '«Кабинет работает на планшете от 768px без перекрытия элементов»',
      },
    ],
    seen: 'шапка закрывает первое поле формы.',
    draft: ['Похоже, это поломка относительно ТЗ.', 'ТЗ (§1.3) требует работу на планшете без перекрытий; на кадре шапка закрывает форму.'],
    draftShort: 'Похоже, это поломка относительно ТЗ',
    proposedClass: 'defect_candidate',
    verdict: { code: 'defect', userId: 'u-dana', at: '10:20' },
    fixedByUserId: 'u-timur',
  }),
  r(2, {
    title: 'Логотип не по центру',
    pageOrScreen: 'Шапка',
    status: 'awaiting_business_close',
    authorId: 'u-aigerim',
    screenshots: [
      { kind: 'original', variant: 'grey', fileName: 'shapka.png' },
      { kind: 'retest', variant: 'blue', fileName: 'shapka-2.png' },
      { kind: 'diff', variant: 'diff' },
    ],
    citations: [
      {
        id: 'c-spec-1-2',
        source: 'spec',
        heading: 'В ТЗ (§1.2):',
        section: '§1.2',
        text: '«Логотип в шапке выровнен по центру на всех экранах»',
      },
    ],
    seen: 'логотип смещён влево.',
    draft: ['Похоже, это поломка относительно ТЗ.', 'ТЗ (§1.2) требует логотип по центру; на кадре он смещён влево.'],
    draftShort: 'Похоже, это поломка относительно ТЗ',
    proposedClass: 'defect_candidate',
    verdict: { code: 'defect', userId: 'u-dana', at: '09:50' },
    fixedByUserId: 'u-timur',
    retest: { outcome: 'likely_addressed', explanation: 'Красное на диффе: область логотипа, теперь по центру. Остальное без изменений.' },
  }),
  r(6, {
    title: 'Пагинация пропадает на второй странице',
    pageOrScreen: 'Список заказов',
    status: 'awaiting_business_close',
    authorId: 'u-aigerim',
    screenshots: [],
    citations: [CITE_SPEC_3_2],
    draft: ['Похоже, это поломка относительно ТЗ.', 'ТЗ (§3.2) описывает постраничный список; со второй страницы пагинация исчезает.'],
    draftShort: 'Похоже, это поломка относительно ТЗ',
    proposedClass: 'defect_candidate',
    verdict: { code: 'defect', userId: 'u-dana', at: '09:55' },
    fixedByUserId: 'u-timur',
    retest: { outcome: 'cannot_tell', explanation: 'Кадров нет — сравнить нечем. Проверьте вручную и закройте, если исправлено.' },
  }),
  r(1, {
    title: 'Не открывается профиль',
    pageOrScreen: 'Профиль компании',
    status: 'closed',
    authorId: 'u-aigerim',
    screenshots: [
      { kind: 'original', variant: 'grey', fileName: 'profil.png' },
      { kind: 'retest', variant: 'blue', fileName: 'profil-2.png' },
      { kind: 'diff', variant: 'diff' },
    ],
    citations: [
      {
        id: 'c-spec-2-0',
        source: 'spec',
        heading: 'В ТЗ (§2):',
        section: '§2',
        text: '«Профиль компании открывается из меню и по прямой ссылке»',
      },
    ],
    seen: 'по ссылке «Профиль» открывается пустая страница.',
    draft: ['Похоже, это поломка относительно ТЗ.', 'ТЗ (§2) требует открытие профиля по ссылке; на кадре пустая страница.'],
    draftShort: 'Похоже, это поломка относительно ТЗ',
    proposedClass: 'defect_candidate',
    verdict: { code: 'defect', userId: 'u-dana', at: '09:30' },
    fixedByUserId: 'u-timur',
    retest: { outcome: 'likely_addressed', explanation: 'Красное на диффе: область формы, теперь профиль открывается. Остальное без изменений.' },
    closedByUserId: 'u-aigerim',
    closedAt: '16:40',
  }),
];

export const DOCUMENTS: ProjectDocument[] = [
  { id: 'd-spec', kind: 'spec', label: 'ТЗ', fileName: 'ТЗ_Клиентский_кабинет.pdf', date: '14.01', pages: 48, status: 'indexed' },
  { id: 'd-protocol', kind: 'protocol', label: 'Протокол', fileName: 'Протокол_12.03.docx', date: '12.03', pages: 3, status: 'indexed' },
  { id: 'd-addendum', kind: 'addendum', label: 'Доп. соглашение', fileName: 'Доп_соглашение_2.pdf', date: '02.04', pages: 6, status: 'parsed' },
];

export const IMPORT_FILE_NAME = 'Журнал_раунд2.xlsx';

export const IMPORT_ROWS: ImportRow[] = [
  { rowNumber: 1, text: 'Не открывается профиль', status: 'parsed' },
  { rowNumber: 2, text: 'Логотип не по центру', status: 'parsed' },
  { rowNumber: 3, text: 'Сортировка списка заказов', status: 'parsed' },
  { rowNumber: 4, text: '', status: 'needs_human_parse' },
  { rowNumber: 5, text: 'Фильтр клиентов сбрасывается при обновлении', status: 'parsed' },
  { rowNumber: 6, text: 'Пагинация пропадает на второй странице', status: 'parsed' },
  { rowNumber: 7, text: 'Ошибка оплаты тостом', status: 'parsed' },
  { rowNumber: 8, text: '', status: 'needs_human_parse' },
  { rowNumber: 9, text: 'Повтор №4 про поиск', status: 'parsed' },
  { rowNumber: 10, text: 'Хотим тёмную тему', status: 'parsed', remarkNumber: 13 },
  { rowNumber: 11, text: 'Выгрузка в Excel', status: 'parsed', remarkNumber: 14 },
];
