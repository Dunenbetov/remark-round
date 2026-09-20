/**
 * documents.access.spec — пакет документов (замечания владельца 20.09): загружает только руководитель приёмки
 * (заказчику 403), читают и скачивают все участники, включая разработчика; чужой документ — 404.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, TZ, type Harness } from '../../test/harness';
import { DocumentsService } from './documents.service';

describe('documents: кто загружает, кто скачивает', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  const base = () => `/api/v1/projects/${h.projectId}/documents`;

  it('заказчик загрузить документ не может — 403, разработчик тоже', async () => {
    for (const role of ['business', 'developer'] as const) {
      await h.http.post(base()).set(h.auth(role)).field('kind', 'spec').attach('file', TZ, 'TZ.md').expect(403);
    }
  });

  it('разработчик и заказчик видят пакет и скачивают файл как загрузили', async () => {
    for (const role of ['developer', 'business'] as const) {
      const list = await h.http.get(base()).set(h.auth(role)).expect(200);
      const spec = list.body.find((d: { kind: string }) => d.kind === 'spec');
      expect(spec).toBeDefined();
      const res = await h.http.get(`${base()}/${spec.id}/file`).set(h.auth(role)).buffer(true).parse(binaryParser).expect(200);
      expect(res.headers['content-disposition']).toBe(`attachment; filename="TZ.md"; filename*=UTF-8''TZ.md`);
      expect(res.headers['content-type']).toMatch(/text\/markdown/);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.compare(res.body as Buffer, TZ)).toBe(0);
    }
  });

  it('кириллическое имя файла уходит в Content-Disposition по RFC 5987', async () => {
    const documents = h.app.get(DocumentsService);
    const doc = await documents.upload({ userId: h.users.pm.id, projectId: h.projectId, role: 'pm' }, { kind: 'addendum', fileName: 'План-график.md', data: TZ }, { indexInBackground: false });
    const res = await h.http.get(`${base()}/${doc.id}/file`).set(h.auth('business')).buffer(true).parse(binaryParser).expect(200);
    const name = encodeURIComponent('План-график.md');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${name}"; filename*=UTF-8''${name}`);
  });

  it('неизвестный документ — 404', async () => {
    await h.http.get(`${base()}/${randomUUID()}/file`).set(h.auth('pm')).expect(404);
  });
});

/** supertest по умолчанию читает text/* как строку; файл сравниваем байтами. */
function binaryParser(res: NodeJS.EventEmitter, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
