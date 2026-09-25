/**
 * seed-remarks.spec — демо-карточки честные (проверка 24.09): кадр показывает предмет замечания или кадра нет,
 * черновик ссылается только на процитированные разделы и описывает кадр только при кадре, протокол цитируется
 * только там, где он говорит о предмете, пояснение ретеста совпадает с настоящим диффом. Без БД: данные сида и фикстуры.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkFaithfulness } from './agent/faithfulness';
import { DiffService, type DiffOutcome } from './diff/diff.service';
import { chunkByHeadings } from './rag/chunker';
import { FRAME_SETS, SEED_REMARKS, timeline, type FrameSet } from './seed-remarks';

const FIXTURES = resolve(__dirname, '../../../fixtures');
const shot = (name: string) => readFileSync(resolve(FIXTURES, 'screenshots', name));
const specChunks = chunkByHeadings(readFileSync(resolve(FIXTURES, 'spec/TZ.md'), 'utf8'));
// Сид цитирует 'protocol' как чанк «Решения…» протокола (seed-remarks.ts, chunkFor)
const protocolChunk = chunkByHeadings(readFileSync(resolve(FIXTURES, 'protocol/PROTOCOL.md'), 'utf8')).find((c) => /Решения/.test(c.section ?? ''))!;
const sectionOf = (label: string) => (label === 'protocol' ? protocolChunk.section : label);
const stems = (s: string) => new Set(s.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter((t) => t.length > 4).map((t) => t.slice(0, 5)));
const roundTwo = SEED_REMARKS.filter((r) => r.round === 2);
const diff = new DiffService();
/** Все пары кадров сида: «было» против «стало» и против «не исправлено». */
const framePairs = (Object.keys(FRAME_SETS) as FrameSet[]).flatMap((set) => {
  const { before, after, notFixedAfter } = FRAME_SETS[set];
  return [after, notFixedAfter].filter((x): x is string => Boolean(x)).map((next) => ({ set, before, next }));
});

describe('демо-сид', () => {
  // Под jest одно сравнение 800×400 идёт около 2 с: каждую пару считаем один раз и берём результат в тестах
  const compared = new Map<string, DiffOutcome>();
  const diffOf = (before: string, next: string): DiffOutcome => compared.get(`${before}|${next}`)!;
  beforeAll(() => {
    for (const { before, next } of framePairs) compared.set(`${before}|${next}`, diff.compare(shot(before), shot(next)));
  }, 120_000);

  it('раунд 2: 14 замечаний — 5 ждут PM, 2 в работе, 4 на ретесте, 2 закрыты', () => {
    const count = (...statuses: string[]) => roundTwo.filter((r) => statuses.includes(r.status)).length;
    expect(roundTwo).toHaveLength(14);
    expect(count('awaiting_pm', 'cannot_tell')).toBe(5);
    expect(count('defect')).toBe(2);
    expect(count('ready_for_retest', 'awaiting_business_close')).toBe(4);
    expect(count('closed')).toBe(2);
  });

  it('кадр только там, где он показывает предмет: №12 — форма профиля с «Сохранить», №7 — ошибка оплаты', () => {
    const withFrames = SEED_REMARKS.filter((r) => r.frames).map((r) => [r.round, r.number, r.frames]);
    expect(withFrames).toEqual(expect.arrayContaining([[2, 12, 'save'], [2, 7, 'payment']]));
    expect(withFrames).toHaveLength(2);
    // Без кадра нет ни ретеста, ни «не исправлено» (ADR 010): закрытие только «проверил сам»
    for (const r of SEED_REMARKS.filter((x) => !x.frames)) {
      expect([r.number, r.retest, r.notFixedRetest, r.visionFacts]).toEqual([r.number, undefined, undefined, undefined]);
    }
  });

  it('кадры набора одного размера и дают настоящий дифф', () => {
    expect(framePairs).toHaveLength(3);
    for (const { set, before, next } of framePairs) expect([set, next, diffOf(before, next).kind]).toEqual([set, next, 'ok']);
  });

  it('черновики проходят ворота faithfulness: разделы только из цитат, дефект с цитатой, «на кадре» только при кадре', () => {
    for (const r of SEED_REMARKS.filter((x) => x.rationale && x.proposedClass)) {
      const cite = r.cite ?? [];
      const result = checkFaithfulness({
        rationale: r.rationale!.join('\n\n'),
        allowedSections: cite.map(sectionOf),
        remarkText: [r.description, r.expected].filter(Boolean).join('\n'),
        proposedClass: r.proposedClass!,
        chunkIds: cite,
        hasScreenshot: Boolean(r.frames),
      });
      expect([r.round, r.number, result.issues]).toEqual([r.round, r.number, []]);
    }
  });

  it('цитаты есть в фикстурах; протокол цитируется и упоминается только там, где он говорит о предмете замечания', () => {
    const sections = new Set(specChunks.map((c) => c.section));
    for (const r of SEED_REMARKS) {
      for (const label of (r.cite ?? []).filter((l) => l !== 'protocol')) expect([r.number, label, sections.has(label)]).toEqual([r.number, label, true]);
      const citesProtocol = (r.cite ?? []).includes('protocol');
      const mentionsProtocol = /Протокол от/.test(r.rationale?.join(' ') ?? '');
      expect([r.round, r.number, mentionsProtocol]).toEqual([r.round, r.number, citesProtocol]);
      if (citesProtocol) {
        const common = [...stems(r.description)].filter((t) => stems(protocolChunk.content).has(t));
        expect([r.number, common.length > 0]).toEqual([r.number, true]);
      }
    }
  });

  it('№7: пояснения ретеста описывают настоящий дифф кадров оплаты', () => {
    const payment = roundTwo.find((r) => r.number === 7)!;
    const { before, after, notFixedAfter } = FRAME_SETS.payment;
    const fixed = diffOf(before, after);
    const other = diffOf(before, notFixedAfter!);
    if (fixed.kind !== 'ok' || other.kind !== 'ok') throw new Error('кадры оплаты не сравниваются');
    // Геометрия из before-payment-toast.svg: тост y 8–44, поле «Карта» y 160–200, текст ошибки под ним на y 218
    expect(fixed.region!.y).toBeLessThanOrEqual(8);
    expect(fixed.region!.y + fixed.region!.height).toBeGreaterThanOrEqual(210);
    expect(payment.retest!.explanation).toMatch(/тост сверху исчез.*под полем/);
    // Круг «не исправлено»: поменялся только текст внутри тоста
    expect(other.region!.y).toBeGreaterThanOrEqual(8);
    expect(other.region!.y + other.region!.height).toBeLessThanOrEqual(44);
    expect(payment.notFixedRetest!.explanation).toMatch(/только текст внутри тоста/);
  });

  it('№10: дата закрытия оригинала в черновике совпадает с историей раунда 1', () => {
    const repeat = roundTwo.find((r) => r.number === 10)!;
    const original = SEED_REMARKS.find((r) => r.round === 1 && r.number === repeat.originNumber)!;
    const { closedAt, rows } = timeline(original);
    const almatyDay = new Date(closedAt!.getTime() + 5 * 3600_000).getUTCDate();
    expect(repeat.rationale!.join(' ')).toContain(`${almatyDay} сентября`);
    // Закрыли без нового кадра: строка close идёт из ready_for_retest (ADR 010)
    expect(rows.at(-1)).toMatchObject({ action: 'close', fromStatus: 'ready_for_retest' });
  });
});
