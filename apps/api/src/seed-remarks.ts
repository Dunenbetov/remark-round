/**
 * Раунд 2 проекта «Клиентский кабинет» — 13 замечаний как в дизайне (журнал, артборд 2).
 * Скрины — из fixtures/screenshots, цитаты — реальные чанки проиндексированного ТЗ и протокола.
 * Пересоздаётся при каждом seed: это демо, а не данные заказчика.
 */
import type { PrismaClient, ProposedClass, RemarkStatus, RetestOutcome, VerdictCode } from '@remarkround/db';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DiffService } from './diff/diff.service';
import { StorageService } from './storage/storage.service';

const ROOT = resolve(__dirname, '../../..');
export const ROUND_ID = 'c1111111-1111-4111-8111-111111111111';

interface SeedRemark {
  number: number;
  description: string;
  pageOrScreen: string;
  expected?: string;
  status: RemarkStatus;
  proposedClass?: ProposedClass;
  rationale?: string[];
  visionFacts?: string;
  /** Подписи разделов чанков: «§2.1 Primary», 'protocol' — первый чанк протокола. */
  cite?: string[];
  shot?: 'gray' | 'blue';
  retestShot?: 'blue';
  verdict?: VerdictCode;
  verdictAt?: string;
  fixed?: boolean;
  retest?: { outcome: RetestOutcome; explanation: string };
  closedAt?: string;
  duplicateOfNumber?: number;
  /** Совет разработчика (Developer) по замечанию, которое ждёт PM. */
  advice?: { code: VerdictCode; comment?: string };
}

const DEFECT_RATIONALE = (section: string, requirement: string, seen: string): string[] => [
  'Похоже, это поломка относительно ТЗ.',
  `ТЗ (${section}) требует: ${requirement}. На кадре — ${seen}. Похожих замечаний в раунде нет.`,
];

export const SEED_REMARKS: SeedRemark[] = [
  {
    number: 12,
    description: 'Кнопка «Сохранить» серая',
    pageOrScreen: 'Профиль компании',
    expected: 'Синяя primary-кнопка при заполненных полях',
    status: 'awaiting_pm',
    proposedClass: 'defect_candidate',
    rationale: ['Похоже, это поломка относительно ТЗ.', 'ТЗ (§2.1) требует синюю primary-кнопку «Сохранить»; на кадре при заполненных полях она серая. Протокол от 12.03 подтверждает: цвета кнопок по макету, без изменений. Похожих замечаний в раунде нет.'],
    visionFacts: 'кнопка «Сохранить» серая, поля заполнены.',
    cite: ['§2.1 Primary', 'protocol'],
    shot: 'gray',
    advice: { code: 'defect', comment: 'В ТЗ §2.1 однозначно, чиню за час' },
  },
  {
    number: 13,
    description: 'Хотим тёмную тему',
    pageOrScreen: 'Весь кабинет',
    expected: 'Чтобы ночью не слепило',
    status: 'awaiting_pm',
    proposedClass: 'change_request_candidate',
    rationale: ['Похоже, это новое желание.', 'ТЗ (§6) прямо относит тёмную тему к тому, чего в проекте нет. Это не поломка, а новое желание — решите, брать ли его в работу отдельно.'],
    cite: ['§6 Чего в ТЗ нет (дыры)'],
    advice: { code: 'change_request', comment: 'Тёмной темы в ТЗ нет — это отдельная задача на пару дней' },
  },
  {
    number: 14,
    description: 'Выгрузка в Excel',
    pageOrScreen: 'Список заказов',
    expected: 'Как в старой 1С',
    status: 'awaiting_pm',
    proposedClass: 'unspecified',
    rationale: ['В бумагах нет опоры.', 'Заказчик просит выгрузку реестра в Excel. ТЗ (§6) перечисляет выгрузку среди того, чего в документе нет, а протокол о ней молчит. Решите вы: работа это или новое желание.'],
    cite: ['§6 Чего в ТЗ нет (дыры)'],
  },
  {
    number: 15,
    description: 'Цвет ссылок в футере',
    pageOrScreen: 'Все страницы, футер',
    status: 'cannot_tell',
    proposedClass: 'cannot_tell',
    rationale: ['Недостаточно данных.', 'Для претензии про цвет или вёрстку нужен скрин: без него не сравнить с ТЗ.'],
    verdict: 'cannot_tell',
    verdictAt: '12:20',
  },
  {
    number: 7,
    description: 'Ошибка оплаты тостом',
    pageOrScreen: 'Оплата счёта',
    expected: 'Ошибка показывается тостом на 3 секунды, а не текстом под формой',
    status: 'defect',
    proposedClass: 'defect_candidate',
    rationale: DEFECT_RATIONALE('§4.2', '«текст ошибки платежа показывается под полем, красным»', 'ошибка 500 показана тостом сверху, под полем пусто'),
    visionFacts: 'ошибка 500 показана тостом сверху, под полем пусто.',
    cite: ['§4.2 Ошибки', 'protocol'],
    shot: 'gray',
    verdict: 'defect',
    verdictAt: '11:40',
  },
  {
    number: 5,
    description: 'Фильтр клиентов сбрасывается при обновлении',
    pageOrScreen: 'Список клиентов',
    expected: 'Фильтр должен переживать обновление страницы',
    status: 'defect',
    proposedClass: 'defect_candidate',
    rationale: ['Похоже, это поломка относительно ТЗ.', 'ТЗ (§1) описывает кабинет как рабочий инструмент с фильтрами; на кадре после обновления фильтр «Активные» снят. Прямой нормы про сохранение фильтра нет — PM подтвердил как поломку.'],
    visionFacts: 'после обновления страницы фильтр «Активные» снят.',
    cite: ['§1 Назначение'],
    shot: 'gray',
    verdict: 'defect',
    verdictAt: '11:52',
  },
  {
    number: 9,
    description: 'Повтор №4 про поиск',
    pageOrScreen: 'Поиск',
    status: 'duplicate',
    proposedClass: 'duplicate',
    rationale: ['Похоже на повтор №4.', 'Та же претензия к поиску по клиентам, что и в №4. Отдельной работы не нужно.'],
    verdict: 'duplicate',
    verdictAt: '12:05',
    duplicateOfNumber: 4,
  },
  {
    number: 4,
    description: 'Поиск по клиентам не находит по БИН',
    pageOrScreen: 'Поиск',
    expected: 'Поиск по БИН находит клиента',
    status: 'closed',
    proposedClass: 'defect_candidate',
    rationale: DEFECT_RATIONALE('§1', '«вход, профиль, оплата счетов» как рабочий кабинет клиента', 'поиск по БИН пустой'),
    cite: ['§1 Назначение'],
    shot: 'gray',
    retestShot: 'blue',
    verdict: 'defect',
    verdictAt: '09:20',
    fixed: true,
    retest: { outcome: 'likely_addressed', explanation: 'Красное на диффе: область результатов поиска, теперь клиент найден. Остальное без изменений.' },
    closedAt: '15:10',
  },
  {
    number: 3,
    description: 'Сортировка списка заказов',
    pageOrScreen: 'Список заказов',
    expected: 'Сортировка по дате должна применяться',
    status: 'ready_for_retest',
    proposedClass: 'defect_candidate',
    rationale: DEFECT_RATIONALE('§1', '«оплата счетов» в рабочем кабинете', 'список не отсортирован по дате'),
    cite: ['§1 Назначение'],
    shot: 'gray',
    verdict: 'defect',
    verdictAt: '10:15',
    fixed: true,
  },
  {
    number: 8,
    description: 'Шапка перекрывает форму на планшете',
    pageOrScreen: 'Профиль компании, планшет',
    expected: 'Форма видна целиком',
    status: 'ready_for_retest',
    proposedClass: 'defect_candidate',
    rationale: DEFECT_RATIONALE('§1', '«веб-кабинет клиента», а не мобильное приложение', 'шапка закрывает первое поле формы'),
    cite: ['§1 Назначение'],
    shot: 'gray',
    verdict: 'defect',
    verdictAt: '10:20',
    fixed: true,
  },
  {
    number: 2,
    description: 'Логотип не по центру',
    pageOrScreen: 'Шапка',
    expected: 'Логотип по центру',
    status: 'awaiting_business_close',
    proposedClass: 'defect_candidate',
    rationale: DEFECT_RATIONALE('§1', 'единый кабинет с шапкой', 'логотип смещён влево'),
    cite: ['§1 Назначение'],
    shot: 'gray',
    retestShot: 'blue',
    verdict: 'defect',
    verdictAt: '09:50',
    fixed: true,
    retest: { outcome: 'likely_addressed', explanation: 'Красное на диффе: область логотипа, теперь по центру. Остальное без изменений.' },
  },
  {
    number: 6,
    description: 'Пагинация пропадает на второй странице',
    pageOrScreen: 'Список заказов',
    status: 'awaiting_business_close',
    proposedClass: 'defect_candidate',
    rationale: DEFECT_RATIONALE('§1', 'постраничный список счетов', 'со второй страницы пагинация исчезает'),
    cite: ['§1 Назначение'],
    verdict: 'defect',
    verdictAt: '09:55',
    fixed: true,
    retest: { outcome: 'cannot_tell', explanation: 'Кадров нет — сравнить нечем. Проверьте вручную и закройте, если исправлено.' },
  },
  {
    number: 1,
    description: 'Не открывается профиль',
    pageOrScreen: 'Профиль компании',
    expected: 'Профиль открывается по ссылке',
    status: 'closed',
    proposedClass: 'defect_candidate',
    rationale: DEFECT_RATIONALE('§1', '«вход, профиль, оплата счетов»', 'по ссылке «Профиль» пустая страница'),
    cite: ['§1 Назначение'],
    shot: 'gray',
    retestShot: 'blue',
    verdict: 'defect',
    verdictAt: '09:30',
    fixed: true,
    retest: { outcome: 'likely_addressed', explanation: 'Красное на диффе: область формы, теперь профиль открывается. Остальное без изменений.' },
    closedAt: '16:40',
  },
];

export async function seedRemarks(
  prisma: PrismaClient,
  ids: { projectId: string; specDocumentId: string; protocolDocumentId: string; pmId: string; businessId: string; developerId: string },
): Promise<void> {
  const storage = new StorageService();
  const diff = new DiffService();
  const gray = await readFile(resolve(ROOT, 'fixtures/screenshots/before-save-gray.png'));
  const blue = await readFile(resolve(ROOT, 'fixtures/screenshots/after-save-blue.png'));
  const grayVsBlue = diff.compare(gray, blue);
  const diffPng = grayVsBlue.kind === 'ok' ? grayVsBlue.png : null;

  await prisma.round.upsert({
    where: { id: ROUND_ID },
    create: { id: ROUND_ID, projectId: ids.projectId, number: 2 },
    update: {},
  });
  await prisma.round.upsert({
    where: { projectId_number: { projectId: ids.projectId, number: 1 } },
    create: { projectId: ids.projectId, number: 1, status: 'closed' },
    update: {},
  });

  // Чистим раунд: вердикты и прогоны не каскадятся (советы каскадятся, но снимаем явно).
  const old = await prisma.remark.findMany({ where: { roundId: ROUND_ID }, select: { id: true } });
  const oldIds = old.map((r) => r.id);
  await prisma.developerAdvice.deleteMany({ where: { remarkId: { in: oldIds } } });
  await prisma.humanVerdict.deleteMany({ where: { remarkId: { in: oldIds } } });
  await prisma.agentRun.deleteMany({ where: { remarkId: { in: oldIds } } });
  await prisma.remark.deleteMany({ where: { id: { in: oldIds } } });

  const chunks = await prisma.documentChunk.findMany({
    where: { documentId: { in: [ids.specDocumentId, ids.protocolDocumentId] } },
    select: { id: true, section: true, documentId: true },
  });
  const chunkFor = (label: string): string | undefined =>
    label === 'protocol'
      ? (chunks.find((c) => c.documentId === ids.protocolDocumentId && /Решения/.test(c.section ?? '')) ?? chunks.find((c) => c.documentId === ids.protocolDocumentId))?.id
      : chunks.find((c) => c.documentId === ids.specDocumentId && c.section === label)?.id;

  const today = new Date();
  const at = (hhmm: string): Date => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m);
  };

  const created = new Map<number, string>();
  // Сначала оригиналы, потом повторы — чтобы duplicateOfId было куда ссылаться.
  const ordered = [...SEED_REMARKS].sort((a, b) => (a.duplicateOfNumber ? 1 : 0) - (b.duplicateOfNumber ? 1 : 0));
  for (const r of ordered) {
    const screenshots: Array<{ kind: 'original' | 'retest' | 'diff'; storageKey: string; width: number; height: number }> = [];
    if (r.shot) screenshots.push({ kind: 'original', storageKey: await storage.save(ids.projectId, 'before.png', gray), width: 800, height: 400 });
    if (r.retestShot) {
      screenshots.push({ kind: 'retest', storageKey: await storage.save(ids.projectId, 'after.png', blue), width: 800, height: 400 });
      // Дифф в демо настоящий: pixelmatch по тем же кадрам, а не нарисованная маска.
      if (r.shot && diffPng) screenshots.push({ kind: 'diff', storageKey: await storage.save(ids.projectId, 'diff.png', diffPng), width: 800, height: 400 });
    }
    const chunkIds = (r.cite ?? []).map(chunkFor).filter((x): x is string => Boolean(x));

    const remark = await prisma.remark.create({
      data: {
        projectId: ids.projectId,
        roundId: ROUND_ID,
        number: r.number,
        description: r.description,
        pageOrScreen: r.pageOrScreen,
        expected: r.expected ?? null,
        status: r.status,
        authorId: ids.businessId,
        proposedClass: r.proposedClass ?? null,
        rationale: r.rationale?.join('\n\n') ?? null,
        visionFacts: r.visionFacts ?? null,
        retestOutcome: r.retest?.outcome ?? null,
        retestExplanation: r.retest?.explanation ?? null,
        fixedByUserId: r.fixed ? ids.developerId : null,
        closedByUserId: r.closedAt ? ids.businessId : null,
        closedAt: r.closedAt ? at(r.closedAt) : null,
        duplicateOfId: r.duplicateOfNumber ? (created.get(r.duplicateOfNumber) ?? null) : null,
        screenshots: { create: screenshots },
        citations: { create: chunkIds.map((chunkId) => ({ chunkId })) },
      },
    });
    created.set(r.number, remark.id);
    if (r.advice) {
      await prisma.developerAdvice.create({ data: { remarkId: remark.id, userId: ids.developerId, code: r.advice.code, comment: r.advice.comment ?? null } });
    }

    const run = await prisma.agentRun.create({
      data: { remarkId: remark.id, projectId: ids.projectId, mode: 'triage', status: r.verdict ? 'persisted' : 'awaiting_human', model: 'seed' },
    });
    if (r.verdict) {
      await prisma.humanVerdict.create({
        data: { remarkId: remark.id, runId: run.id, userId: ids.pmId, code: r.verdict, idempotencyKey: `seed-${r.number}`, createdAt: at(r.verdictAt ?? '10:00') },
      });
    }
  }
  console.log(`seed: round 2 — ${SEED_REMARKS.length} remarks`);
}
