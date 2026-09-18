/**
 * pricing.spec — P3 (аудит 18.09, раздел 3.4): `gpt-4.1-mini` раньше совпадал с ключом `gpt-4.1` через startsWith
 * и считался в 5 раз дороже. Теперь — точное совпадение, потом самый длинный префикс; неизвестная модель — 0.
 */
import { costUsd, priceKey } from './pricing';

const M = 1_000_000;

describe('pricing', () => {
  it('mini и полная модель — разные цены: 1M входных + 1M выходных у gpt-4.1-mini $2.00, у gpt-4.1 $10.00', () => {
    expect(priceKey('gpt-4.1-mini')).toBe('gpt-4.1-mini');
    expect(priceKey('gpt-4.1')).toBe('gpt-4.1');
    expect(costUsd('gpt-4.1-mini', M, M)).toBeCloseTo(0.4 + 1.6, 10);
    expect(costUsd('gpt-4.1', M, M)).toBeCloseTo(2 + 8, 10);
  });

  it('nano и соседние семейства не съезжают на короткий ключ', () => {
    expect(costUsd('gpt-4.1-nano', M, M)).toBeCloseTo(0.1 + 0.4, 10);
    expect(priceKey('gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(priceKey('gpt-5-mini')).toBe('gpt-5-mini');
    expect(priceKey('gpt-5.4-mini')).toBe('gpt-5.4-mini');
    // `gpt-5.4` — не снимок `gpt-5`: без дефиса после ключа префиксом не считается
    expect(priceKey('gpt-5.4')).toBe('gpt-5.4');
  });

  it('снимок с датой берёт цену своей модели по самому длинному префиксу', () => {
    expect(priceKey('gpt-4.1-mini-2025-04-14')).toBe('gpt-4.1-mini');
    expect(priceKey('gpt-4.1-2025-04-14')).toBe('gpt-4.1');
    expect(costUsd('gpt-4.1-nano-2025-04-14', 2000, 100)).toBeCloseTo((2000 * 0.1 + 100 * 0.4) / M, 12);
  });

  it('эмбеддинги: только входные токены', () => {
    expect(costUsd('text-embedding-3-small', M, 0)).toBeCloseTo(0.02, 10);
  });

  it('неизвестная модель — 0, а не цена похожей', () => {
    expect(priceKey('claude-sonnet-4')).toBeNull();
    expect(priceKey('gpt-4')).toBeNull();
    expect(priceKey('gpt-4.1x')).toBeNull();
    expect(costUsd('fake/rules', 1000, 1000)).toBe(0);
  });

  it('типичный триаж (live-3, 04.09): те же токены по старому прайсу стоили в 5 раз больше', () => {
    // 3133 входных и 200 выходных — средние по golden; всё на быстрой модели (как у ретеста)
    const fast = costUsd('gpt-4.1-mini', 3133, 200);
    const asFull = costUsd('gpt-4.1', 3133, 200);
    expect(asFull / fast).toBeCloseTo(5, 5);
  });
});
