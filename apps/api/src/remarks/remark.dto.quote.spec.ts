/**
 * remark.dto.quote.spec — цитата на карточке дописывается до конца предложения (замечание владельца 20.09),
 * а quote() для промпта ретеста остаётся прежней: её текст — вход модели, менять его до замеров M1 нельзя.
 */
import { quote, quoteForView } from './remark.dto';

const SENTENCE = 'Модуль предназначен для предоставления доступа к статистическим данным и связанным метаданным.'; // 93 знака

describe('quoteForView: обрыв по предложению, не по знаку', () => {
  it('короткий текст — целиком, в кавычках, без markdown', () => {
    expect(quoteForView('**Кнопка** `Сохранить`  синяя.')).toBe('«Кнопка Сохранить синяя.»');
  });

  it('длиннее 240 — дописывает предложение, на котором пришёлся предел', () => {
    const text = [SENTENCE, SENTENCE, SENTENCE, 'Хвост, который уже не нужен.'].join(' ');
    const out = quoteForView(text);
    expect(out).toBe(`«${[SENTENCE, SENTENCE, SENTENCE].join(' ')}»`);
    expect(out.length).toBeGreaterThan(240);
    expect(out).not.toContain('…');
  });

  it('точка внутри «п. 4.3» концом предложения не считается', () => {
    const body = 'Требования к модулю по п. 4.3 и п. 5.1 перечислены ниже, и это одно длинное предложение ';
    const text = `${body.repeat(3)}до самого конца.`;
    expect(quoteForView(text)).toBe(`«${text}»`);
  });

  it('предложение длиннее 480 — режем по последнему концу предложения перед пределом', () => {
    const long = `Очень ${'длинное '.repeat(80)}предложение.`;
    const out = quoteForView(`${SENTENCE} ${SENTENCE} ${long}`);
    expect(out).toBe(`«${SENTENCE} ${SENTENCE}»`);
  });

  it('без концов предложений вовсе — по слову и с многоточием', () => {
    const out = quoteForView('слово '.repeat(120));
    expect(out).toMatch(/^«(слово )+слово…»$/);
    expect(out.length).toBeLessThanOrEqual(243);
  });
});

describe('quote (промпт ретеста) не изменилась', () => {
  it('240 знаков и многоточие', () => {
    const out = quote('слово '.repeat(100));
    expect(out.length).toBe(240);
    expect(out.endsWith('…»')).toBe(true);
  });
});
