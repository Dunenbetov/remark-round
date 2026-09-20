/**
 * diff.cannot-compare.spec — пиксели считает алгоритм (ADR 002).
 * Юнит: фикстуры before/after дают дифф вокруг кнопки, before vs zoom → cannot_compare («явный шум»),
 * разный размер и SVG → cannot_compare. E2E: ретест через API кладёт кадр диффа и не закрывает замечание.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { createHarness, Harness } from '../../test/harness';
import { DiffService, describeRegion } from './diff.service';

const SHOTS = resolve(__dirname, '../../../../fixtures/screenshots');
const GRAY = readFileSync(resolve(SHOTS, 'before-save-gray.png'));
const BLUE = readFileSync(resolve(SHOTS, 'after-save-blue.png'));
const ZOOM = readFileSync(resolve(SHOTS, 'unrelated-zoom.png'));
const GRAY_SVG = readFileSync(resolve(SHOTS, 'before-save-gray.svg'));

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe('DiffService', () => {
  const diff = new DiffService();

  it('before/after: картинка диффа 800×400, изменения — небольшая область, не весь кадр', () => {
    const result = diff.compare(GRAY, BLUE);
    if (result.kind !== 'ok') throw new Error(`ожидали ok, получили ${result.reason}`);
    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
    expect(result.changedPixels).toBeGreaterThan(0);
    expect(result.ratio).toBeLessThan(0.1);
    expect(result.region).not.toBeNull();
    expect(result.region!.width).toBeLessThan(800);
    const png = PNG.sync.read(result.png);
    expect(png.width).toBe(800);
    expect(png.height).toBe(400);
    // Красный пиксель есть там, где рамка изменений.
    const r = result.region!;
    let red = 0;
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        const i = (y * 800 + x) * 4;
        if (png.data[i] === 214 && png.data[i + 1] === 58) red++;
      }
    }
    expect(red).toBe(result.changedPixels);
    expect(describeRegion(r, result)).toMatch(/слева|по центру|справа|в центре кадра/);
  });

  it('тот же кадр дважды — ноль изменений и без рамки', () => {
    const result = diff.compare(GRAY, GRAY);
    if (result.kind !== 'ok') throw new Error('ожидали ok');
    expect(result.changedPixels).toBe(0);
    expect(result.region).toBeNull();
  });

  it('before vs zoom (тот же размер, другой экран) — cannot_compare, а не «исправлено»', () => {
    const result = diff.compare(GRAY, ZOOM);
    expect(result.kind).toBe('cannot_compare');
    if (result.kind === 'cannot_compare') expect(result.reason).toMatch(/слишком разные|разбросаны/);
  });

  it('разный размер кадра — cannot_compare с размерами, без масштабирования', () => {
    const result = diff.compare(GRAY, solidPng(400, 200, [244, 244, 244]));
    expect(result.kind).toBe('cannot_compare');
    if (result.kind === 'cannot_compare') {
      expect(result.reason).toMatch(/800×400/);
      expect(result.reason).toMatch(/400×200/);
    }
  });

  it('SVG и прочие форматы не сравниваем', () => {
    const result = diff.compare(GRAY_SVG, BLUE);
    expect(result.kind).toBe('cannot_compare');
    if (result.kind === 'cannot_compare') expect(result.reason).toMatch(/PNG или JPG/);
  });
});

describe('retest через API', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(() => h.cleanup());

  async function upload(file: Buffer, name: string): Promise<string> {
    const res = await h.http.post(`/api/v1/projects/${h.projectId}/media`).set(h.auth('business')).attach('file', file, name).expect(201);
    return res.body.storageKey as string;
  }

  /** Замечание со старым кадром доводится до ready_for_retest: PM → defect, developer → «Готово». */
  async function readyForRetest(description: string): Promise<string> {
    const created = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description, expected: 'Синяя primary', pageOrScreen: 'Профиль', screenshotKey: await upload(GRAY, 'before.png') })
      .expect(201);
    const id = created.body.id as string;
    await h.waitFor(id, ['awaiting_pm']);
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${id}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'defect', runId: created.body.runId, idempotencyKey: randomUUID() })
      .expect(200);
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${id}/ready-for-retest`).set(h.auth('developer')).expect(200);
    return id;
  }

  /** Ретест идёт графом в фоне (фаза diffing по WS): ждём awaiting_business_close. */
  async function retest(id: string, file: Buffer, name: string): Promise<Record<string, any>> {
    const started = await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${id}/retest`)
      .set(h.auth('business'))
      .send({ screenshotKey: await upload(file, name) })
      .expect(200);
    expect(started.body.runMode).toBe('retest');
    return h.waitFor(id, ['awaiting_business_close'], 'business');
  }

  it('новый кадр → дифф третьим кадром, статус ждёт закрытия бизнесом, модель не закрывает', async () => {
    const id = await readyForRetest('Кнопка «Сохранить» серая при заполненных полях');
    const res = { body: await retest(id, BLUE, 'after.png') };
    expect(res.body.status).toBe('awaiting_business_close');
    expect(res.body.retest.outcome).toBe('cannot_tell');
    expect(res.body.retest.explanation).toMatch(/Красное на диффе/);
    expect(res.body.retest.explanation).toMatch(/решите вы/);
    const kinds = res.body.screenshots.map((s: { kind: string }) => s.kind);
    expect(kinds).toEqual(['original', 'retest', 'diff']);

    const diffShot = res.body.screenshots.find((s: { kind: string }) => s.kind === 'diff');
    expect(diffShot.width).toBe(800);
    const media = await h.http.get(diffShot.url).set(h.auth('pm')).expect(200);
    expect(media.headers['content-type']).toMatch(/image\/png/);

    // «Не исправлено» снимает новый кадр и дифф с карточки, но не из базы: круг ретеста остаётся в истории (ADR 011).
    const back = await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${id}/not-fixed`).set(h.auth('business')).expect(200);
    expect(back.body.status).toBe('defect');
    expect(back.body.screenshots.map((s: { kind: string }) => s.kind)).toEqual(['original']);
    expect(await h.prisma.remarkScreenshot.count({ where: { remarkId: id, supersededAt: { not: null } } })).toBe(2);
    const history = await h.http.get(`/api/v1/projects/${h.projectId}/remarks/${id}/history`).set(h.auth('pm')).expect(200);
    const rows = history.body as Array<Record<string, any>>;
    expect(rows.find((r) => r.action === 'retest')!.shot).toMatchObject({ kind: 'retest', current: false });
    const result = rows.find((r) => r.action === 'retest_result')!;
    expect(result.shot).toMatchObject({ kind: 'diff', current: false });
    await h.http.get(result.shot.url).set(h.auth('pm')).expect(200);
  });

  it('кадр другого экрана (zoom) → cannot_tell с причиной, диффа нет, закрыть всё равно может только бизнес', async () => {
    const id = await readyForRetest('Кнопка «Сохранить» не того цвета опять');
    const res = { body: await retest(id, ZOOM, 'zoom.png') };
    expect(res.body.status).toBe('awaiting_business_close');
    expect(res.body.retest.outcome).toBe('cannot_tell');
    // Заголовок «Не могу сравнить кадры» ставит интерфейс; в тексте — причина и выход (закрыть без кадра, ADR 010)
    expect(res.body.retest.explanation).toMatch(/разбросаны|слишком разные/);
    expect(res.body.retest.explanation).toMatch(/закройте без кадра/);
    expect(res.body.screenshots.map((s: { kind: string }) => s.kind)).toEqual(['original', 'retest']);

    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${id}/close`).set(h.auth('developer')).expect(403);
    const closed = await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${id}/close`).set(h.auth('business')).expect(200);
    expect(closed.body.status).toBe('closed');
  });

  it('кадр другого размера → cannot_tell с размерами', async () => {
    const id = await readyForRetest('Шапка перекрывает форму на планшете');
    const res = { body: await retest(id, solidPng(1440, 900, [244, 244, 244]), 'tablet.png') };
    expect(res.body.retest.outcome).toBe('cannot_tell');
    expect(res.body.retest.explanation).toMatch(/1440×900/);
  });
});
