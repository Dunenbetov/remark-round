/** faithfulness — черновик не ссылается на то, чего не было в retrieve (REMARKROUND.md §11, §12). Чистая функция, без БД. */
import { checkFaithfulness } from './faithfulness';

const SECTIONS = ['§2.1 Primary', '§4.2 Ошибки', 'Решения'];

describe('faithfulness gate', () => {
  it('ссылки только на найденные разделы — ok', () => {
    const r = checkFaithfulness({ rationale: 'ТЗ (§2.1) требует синюю кнопку. Протокол подтверждает.', retrievedSections: SECTIONS, proposedClass: 'defect_candidate', chunkIds: ['c1'], hasScreenshot: true });
    expect(r).toEqual({ ok: true, issues: [] });
  });

  it('выдуманный §3.2 — не пропускаем', () => {
    const r = checkFaithfulness({ rationale: 'ТЗ (§3.2) требует иначе.', retrievedSections: SECTIONS, proposedClass: 'defect_candidate', chunkIds: ['c1'], hasScreenshot: false });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/§3\.2/);
  });

  it('дефект без цитаты и «на кадре» без кадра — две причины', () => {
    const r = checkFaithfulness({ rationale: 'На кадре кнопка серая.', retrievedSections: SECTIONS, proposedClass: 'defect_candidate', chunkIds: [], hasScreenshot: false });
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(2);
  });

  it('unspecified без ссылок — ok', () => {
    const r = checkFaithfulness({ rationale: 'В бумагах нет опоры.', retrievedSections: [], proposedClass: 'unspecified', chunkIds: [], hasScreenshot: false });
    expect(r.ok).toBe(true);
  });
});
