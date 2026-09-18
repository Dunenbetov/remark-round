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

  describe('строка с числом в начале — не заголовок, если это дата, сумма, срок, пункт списка или перенос (аудит 18.09)', () => {
    const text = [
      'Техническое задание',
      '',
      '14 января 2026 года',
      '',
      '1 Назначение',
      '',
      'Срок исправления замечаний —',
      '10 рабочих дней с даты подписания протокола.',
      '',
      '5000 рублей за этап',
      '',
      '2 кнопки на одной форме недопустимы',
      '',
      '2 Оплата',
      '',
      'Сценарий оплаты:',
      '',
      '1. Открыть форму оплаты',
      '',
      '2. Ввести сумму',
      '',
      '3. Нажать «Оплатить»',
      '',
      '40 % кадра) → cannot_compare',
      '',
      "4 tool'а поверх тех же REST-маршрутов",
      '',
      '5 МБ на один файл',
      '',
      '3 Вход выполняется через',
      'единый вход компании',
      '',
      '1 Общие сведения ........ 3',
      '',
      '1 | Вход и профиль | 5000 рублей за этап',
      '',
      '2.1 Ошибки оплаты',
      'Под полем, красным.',
    ].join('\n');
    const out = chunkByHeadings(text);

    it('разделы только настоящие: §1, §2 и §2.1', () => {
      expect(out.map((c) => c.section)).toEqual([null, '§1 Назначение', '§2 Оплата', '§2.1 Ошибки оплаты']);
    });

    it('ложные «заголовки» остались текстом своего раздела', () => {
      const byLabel = new Map(out.map((c) => [c.section, c.content]));
      expect(byLabel.get(null)).toContain('14 января 2026 года');
      expect(byLabel.get('§1 Назначение')).toContain('10 рабочих дней');
      expect(byLabel.get('§1 Назначение')).toContain('5000 рублей за этап');
      expect(byLabel.get('§1 Назначение')).toContain('2 кнопки на одной форме');
      expect(byLabel.get('§2 Оплата')).toContain('1. Открыть форму оплаты');
      expect(byLabel.get('§2 Оплата')).toContain('3. Нажать «Оплатить»');
      expect(byLabel.get('§2 Оплата')).toContain('5 МБ на один файл');
      expect(byLabel.get('§2 Оплата')).toContain('3 Вход выполняется через');
      expect(byLabel.get('§2 Оплата')).toContain('1 Общие сведения');
    });

    it('каждая ложная строка по отдельности, даже с пустой строкой перед ней, не делает раздела', () => {
      for (const line of ['14 января 2026 года', '10 рабочих дней', '5000 рублей за этап', '2 кнопки на одной форме недопустимы', '100 % покрытие', '5 МБ на файл', '14 Января 2026 года', '3 Рабочих дня на ретест', '120 Раздел']) {
        const sections = chunkByHeadings(`Вводный абзац.\n\n${line}\n\nТекст после строки.`).map((c) => c.section);
        expect(sections).toEqual([null]);
      }
    });

    it('перенос внутри абзаца: строка с числом после строки без точки — не заголовок', () => {
      const sections = chunkByHeadings('Срок исправления замечаний —\n3 Этапа по 5000 рублей\nи не больше.').map((c) => c.section);
      expect(sections).toEqual([null]);
    });
  });

  it('заголовок со скобками в конце и заголовок сразу после заголовка остаются заголовками', () => {
    const text = ['5 Устаревший фрагмент (конфликт)', '', 'Серой кнопкой можно.', '', '6 Требования', '6.1 Кнопки', 'Синие.'].join('\n');
    expect(chunkByHeadings(text).map((c) => c.section)).toEqual(['§5 Устаревший фрагмент (конфликт)', '§6.1 Кнопки']);
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
