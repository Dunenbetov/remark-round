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

  describe('автоматическое оглавление Word — не разделы и не текст ТЗ', () => {
    const PREAMBLE = ['Техническое задание на «Клиентский кабинет»', '', 'Версия 2 от 14 января 2026 года', ''];
    const BODY = [
      '1 ОБЩИЕ СВЕДЕНИЯ',
      '',
      'Веб-кабинет клиента: вход, профиль, оплата счетов.',
      '',
      '1.1 Основания для разработки',
      '',
      'Договор и протокол согласования.',
      '',
      '2 НАЗНАЧЕНИЕ И ЦЕЛИ СОЗДАНИЯ СИСТЕМЫ',
      '',
      '2.1 Назначение системы',
      '',
      'Клиент оплачивает счета без звонка менеджеру.',
      '',
      '2.2 Цели создания системы',
      '',
      'Сократить срок оплаты счёта до 3 рабочих дней.',
      '',
      '3 ТРЕБОВАНИЯ К СИСТЕМЕ',
      '',
      'Primary-кнопка — синяя #0B5FFF.',
    ];
    const ENTRIES: Array<[string, string, number]> = [
      ['1', 'ОБЩИЕ СВЕДЕНИЯ', 3],
      ['1.1', 'Основания для разработки', 3],
      ['2', 'НАЗНАЧЕНИЕ И ЦЕЛИ СОЗДАНИЯ СИСТЕМЫ', 6],
      ['2.1', 'Назначение системы', 6],
      ['2.2', 'Цели создания системы', 7],
      ['3', 'ТРЕБОВАНИЯ К СИСТЕМЕ', 8],
    ];
    const BODY_SECTIONS = ['§1 ОБЩИЕ СВЕДЕНИЯ', '§1.1 Основания для разработки', '§2.1 Назначение системы', '§2.2 Цели создания системы', '§3 ТРЕБОВАНИЯ К СИСТЕМЕ'];
    const plain = chunkByHeadings([...PREAMBLE, ...BODY].join('\n'));

    /** Документ с оглавлением между титулом и первым разделом; `gap` — пустая строка между записями (абзацы DOCX). */
    function withToc(entry: (n: string, title: string, page: number) => string[], opts: { title?: string | null; gap?: boolean } = {}): string {
      const rows = ENTRIES.flatMap(([n, title, page]) => [...entry(n, title, page), ...(opts.gap === false ? [] : [''])]);
      const title = opts.title === null ? [] : [opts.title ?? 'Оглавление', ''];
      return [...PREAMBLE, ...title, ...rows, '', ...BODY].join('\n');
    }

    it('без оглавления: пять разделов и титул', () => {
      expect(plain.map((c) => c.section)).toEqual([null, ...BODY_SECTIONS]);
    });

    it('табуляция, как отдаёт mammoth из DOCX: «2 ⇥ НАЗНАЧЕНИЕ… ⇥ 6» и «2 НАЗНАЧЕНИЕ… ⇥ 6»', () => {
      expect(chunkByHeadings(withToc((n, t, p) => [`${n}\t${t}\t${p}`]))).toEqual(plain);
      expect(chunkByHeadings(withToc((n, t, p) => [`${n} ${t}\t${p}`]))).toEqual(plain);
    });

    it('отточие, как в PDF из Word: вплотную, через пробелы, «. . . .», «…», строки подряд без пустых', () => {
      expect(chunkByHeadings(withToc((n, t, p) => [`${n} ${t}${'.'.repeat(60)}${p}`]))).toEqual(plain);
      expect(chunkByHeadings(withToc((n, t, p) => [`${n} ${t} ${'.'.repeat(40)} ${p}`], { gap: false, title: 'СОДЕРЖАНИЕ' }))).toEqual(plain);
      expect(chunkByHeadings(withToc((n, t, p) => [`${n} ${t} ${'. '.repeat(20)}${p}`], { gap: false }))).toEqual(plain);
      expect(chunkByHeadings(withToc((n, t, p) => [`${n} ${t} ………… ${p}`], { title: 'Table of Contents' }))).toEqual(plain);
    });

    it('два пробела и больше перед номером страницы (текстовый файл)', () => {
      expect(chunkByHeadings(withToc((n, t, p) => [`${n} ${t}    ${p}`], { gap: false }))).toEqual(plain);
    });

    it('номер страницы отдельной строкой', () => {
      expect(chunkByHeadings(withToc((n, t, p) => [`${n} ${t}`, String(p)]))).toEqual(plain);
      expect(chunkByHeadings(withToc((n, t, p) => [`${n} ${t}`, '', String(p)], { title: null }))).toEqual(plain);
    });

    it('длинный заголовок оглавления перенесён на вторую строку — уходит вместе с записью', () => {
      const wrap = (n: string, t: string, p: number): string[] => {
        const words = t.split(' ');
        return words.length > 3 ? [`${n} ${words.slice(0, 3).join(' ')}`, `${words.slice(3).join(' ')} ${'.'.repeat(30)} ${p}`] : [`${n} ${t} ${'.'.repeat(30)} ${p}`];
      };
      expect(chunkByHeadings(withToc(wrap))).toEqual(plain);
      expect(chunkByHeadings(withToc(wrap, { gap: false }))).toEqual(plain);
    });

    it('слова «Оглавление» нет — серия всё равно уходит; настоящий раздел берётся из тела', () => {
      const out = chunkByHeadings(withToc((n, t, p) => [`${n}\t${t}\t${p}`], { title: null }));
      expect(out).toEqual(plain);
      expect(out.filter((c) => c.section === '§2.1 Назначение системы')).toHaveLength(1);
      expect(out.some((c) => /Оглавление|\t\d+$/m.test(c.content) || /\t/.test(c.section ?? ''))).toBe(false);
    });

    it('« | » вместо табуляции (старый .doc): под словом «Оглавление» — оглавление, без него — строки таблицы', () => {
      expect(chunkByHeadings(withToc((n, t, p) => [`${n} ${t} | ${p}`]))).toEqual(plain);
      expect(chunkByHeadings(withToc((n, t, p) => [`${n} | ${t} | ${p}`]))).toEqual(plain);
      const table = ['3 ТРЕБОВАНИЯ К СИСТЕМЕ', '', 'Этап | Что сдаём | Экранов', '1 | Вход и профиль | 3', '2 | Оплата счетов | 4', '3 | Отчёты | 6'].join('\n');
      const out = chunkByHeadings(table);
      expect(out.map((c) => c.section)).toEqual(['§3 ТРЕБОВАНИЯ К СИСТЕМЕ']);
      expect(out[0]!.content).toContain('1 | Вход и профиль | 3');
      expect(out[0]!.content).toContain('3 | Отчёты | 6');
    });

    it('одиночный заголовок с числом в конце остаётся заголовком — и с пробелом, и с табуляцией; две строки — ещё не серия', () => {
      for (const heading of ['3 Требования к версии 2', '3 Требования к версии\t2', '3 Требования к версии  2']) {
        const text = ['1 Назначение', '', 'Веб-кабинет клиента.', '', heading, '', 'Версия 2 открывается в тех же браузерах.'].join('\n');
        const out = chunkByHeadings(text);
        expect(out.map((c) => c.section)).toEqual(['§1 Назначение', `§${heading}`]);
        expect(out[1]!.content).toBe('Версия 2 открывается в тех же браузерах.');
      }
      const sections = chunkByHeadings(['1 Назначение', '', 'Текст.', '', '3 Требования к версии\t2', '', 'Текст.', '', '5 Требования к версии\t3', '', 'Текст.'].join('\n')).map((c) => c.section);
      expect(sections).toEqual(['§1 Назначение', '§3 Требования к версии\t2', '§5 Требования к версии\t3']);
    });

    it('список «параметр ⇥ значение» с растущими числами — не оглавление: записи не начинаются как заголовки', () => {
      const text = ['3 ТРЕБОВАНИЯ К СИСТЕМЕ', '', 'Попыток входа\t3', 'Срок хранения, лет\t5', 'Время отклика, мс\t200', 'Число пользователей\t1000'].join('\n');
      const out = chunkByHeadings(text);
      expect(out).toHaveLength(1);
      expect(out[0]!.content).toContain('Попыток входа\t3');
      expect(out[0]!.content).toContain('Число пользователей\t1000');
    });

    it('строки с числом после табуляции, где числа убывают, — не оглавление, текст остаётся', () => {
      const text = ['3 ТРЕБОВАНИЯ К СИСТЕМЕ', '', 'Время отклика, мс\t200', 'Срок хранения, лет\t5', 'Число пользователей\t1000', 'Попыток входа\t3'].join('\n');
      const out = chunkByHeadings(text);
      expect(out).toHaveLength(1);
      expect(out[0]!.content).toContain('Срок хранения, лет\t5');
      expect(out[0]!.content).toContain('Попыток входа\t3');
    });
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
