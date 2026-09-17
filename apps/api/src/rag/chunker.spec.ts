import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chunkByHeadings, chunkFixed } from './chunker';

const TZ = readFileSync(resolve(__dirname, '../../../../fixtures/spec/TZ.md'), 'utf8');

describe('chunkByHeadings', () => {
  const chunks = chunkByHeadings(TZ);

  it('делит ТЗ по разделам и подписывает их номером', () => {
    const sections = chunks.map((c) => c.section);
    expect(sections).toEqual(expect.arrayContaining(['§2.1 Primary', '§2.2 Secondary', '§4.2 Ошибки', '§3 Вход']));
  });

  it('раздел 2.1 целиком в одном чанке и знает свой путь', () => {
    const primary = chunks.find((c) => c.section === '§2.1 Primary')!;
    expect(primary.content).toContain('#0B5FFF');
    expect(primary.content).toContain('одна primary');
    expect(primary.path).toEqual(['Техническое задание — «Клиентский кабинет» (синтетика)', '2. Кнопки и цвет', '2.1 Primary']);
    expect(primary.embedText.startsWith('Техническое задание')).toBe(true);
  });

  it('не создаёт пустых чанков для заголовков без текста', () => {
    expect(chunks.every((c) => c.content.trim().length > 0)).toBe(true);
    expect(chunks.some((c) => c.section === '2. Кнопки и цвет')).toBe(false);
  });

  it('ловит нумерованные заголовки без markdown (как в тексте из PDF)', () => {
    const pdfLike = ['1 Назначение', 'Веб-кабинет клиента.', '', '2.1 Primary', 'Кнопка синяя.', '4.2. Ошибки', 'Под полем.'].join('\n');
    const out = chunkByHeadings(pdfLike);
    expect(out.map((c) => c.section)).toEqual(['§1 Назначение', '§2.1 Primary', '§4.2 Ошибки']);
  });

  it('режет длинный раздел на окна с перекрытием, сохраняя подпись раздела', () => {
    const long = `## 7. Длинный\n\n${Array.from({ length: 500 }, (_, i) => `слово${i}`).join(' ')}`;
    const out = chunkByHeadings(long, { maxWords: 200, overlapWords: 50 });
    expect(out.length).toBe(3);
    expect(out.every((c) => c.section === '§7 Длинный')).toBe(true);
    expect(out[1]!.content.startsWith('слово150 ')).toBe(true);
  });

  it('фиксированные окна не знают разделов (контроль для ARCHITECTURE.md)', () => {
    const fixed = chunkFixed(TZ, 60, 10);
    expect(fixed.length).toBeGreaterThan(3);
    expect(fixed.every((c) => c.section === null)).toBe(true);
  });
});
