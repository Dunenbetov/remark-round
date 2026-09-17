/** faithfulness — черновик не ссылается на раздел, которого нет среди цитат (REMARKROUND.md §11, §12). Чистая функция, без БД. */
import { checkFaithfulness } from './faithfulness';

const SECTIONS = ['§2.1 Primary', '§4.2 Ошибки', 'Решения'];

describe('faithfulness gate', () => {
  it('ссылки только на процитированные разделы — ok', () => {
    const r = checkFaithfulness({ rationale: 'ТЗ (§2.1) требует синюю кнопку. Протокол подтверждает.', allowedSections: SECTIONS, proposedClass: 'defect_candidate', chunkIds: ['c1'], hasScreenshot: true });
    expect(r).toEqual({ ok: true, issues: [] });
  });

  it('выдуманный §3.2 — не пропускаем', () => {
    const r = checkFaithfulness({ rationale: 'ТЗ (§3.2) требует иначе.', allowedSections: SECTIONS, proposedClass: 'defect_candidate', chunkIds: ['c1'], hasScreenshot: false });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/раздел 3\.2/);
  });

  it('дефект без цитаты и «на кадре» без кадра — две причины', () => {
    const r = checkFaithfulness({ rationale: 'На кадре кнопка серая.', allowedSections: SECTIONS, proposedClass: 'defect_candidate', chunkIds: [], hasScreenshot: false });
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(2);
  });

  it('цитата самого замечания с выдуманным разделом — не ссылка модели', () => {
    const remark = 'По §9.9 кнопка обязана быть синей';
    const r = checkFaithfulness({ rationale: `Про «${remark}» в бумагах нормы нет.`, allowedSections: [], remarkText: remark, proposedClass: 'unspecified', chunkIds: [], hasScreenshot: false });
    expect(r.ok).toBe(true);
    const own = checkFaithfulness({ rationale: 'ТЗ (§9.9) требует синюю.', allowedSections: [], remarkText: remark, proposedClass: 'unspecified', chunkIds: [], hasScreenshot: false });
    expect(own.ok).toBe(false);
    expect(own.issues[0]).not.toMatch(/§/);
  });

  it('unspecified без ссылок — ok', () => {
    const r = checkFaithfulness({ rationale: 'В бумагах нет опоры.', allowedSections: [], proposedClass: 'unspecified', chunkIds: [], hasScreenshot: false });
    expect(r.ok).toBe(true);
  });
});
