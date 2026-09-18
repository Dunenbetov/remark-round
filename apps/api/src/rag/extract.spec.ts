/**
 * extract.spec — P6/P7 плана защиты: документы, какие присылает заказчик, а не Markdown.
 * TZ.pdf — экспорт из Word/Google Docs (номер заголовка отдельным фрагментом через табуляцию, колонтитулы
 * на каждой странице, таблицы), PROTOCOL.docx — автонумерация Word в стилях заголовков, PROTOCOL.doc — Word 97-2003.
 * Файлы собирает `pnpm --filter @remarkround/api make:docs` (src/rag/make-doc-fixtures.ts).
 * Негатив «текст под именем .pdf → 422» — в uploads.hygiene.spec, здесь не дублируем.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@remarkround/db';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { FakeEmbeddingsService } from '../../test/fake-embeddings';
import { AppModule } from '../app.module';
import { hashPassword } from '../auth/password';
import { EmbeddingsService } from '../llm/embeddings.service';
import { validationPipe } from '../main';
import { chunkByHeadings } from './chunker';
import { assertContent, detectMime, extractText, normalizeText, SUPPORTED_FORMATS } from './extract';

const FIXTURES = resolve(__dirname, '../../../../fixtures');
const read = (path: string): Buffer => readFileSync(resolve(FIXTURES, path));
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Подписи «§N …» — то, что PM видит в цитате на карточке. */
function labels(text: string): string[] {
  return chunkByHeadings(text)
    .map((c) => c.section)
    .filter((s): s is string => !!s?.startsWith('§'));
}

const TZ_LABELS = ['§1 Назначение', '§2.1 Primary', '§2.2 Secondary', '§3 Вход', '§4.1 Успех', '§4.2 Ошибки', '§5 Устаревший фрагмент (конфликт)', '§6 Чего в ТЗ нет (дыры)'];
const PROTOCOL_LABELS = ['§1 Решения, которых нет в ТЗ v1.4', '§2 Сроки и оплата', '§2.1 Порядок приёмки', '§3 Итог'];

describe('extractText на настоящих файлах', () => {
  it('TZ.md (эталон evals) даёт те же разделы, что и раньше', async () => {
    expect(labels(await extractText(read('spec/TZ.md'), 'text/markdown'))).toEqual(TZ_LABELS);
  });

  describe('TZ.pdf — экспорт из Word', () => {
    let text: string;
    beforeAll(async () => {
      text = await extractText(read('spec/TZ.pdf'), 'application/pdf');
    });

    it('разделы после чанкинга совпадают с разделами TZ.md', () => {
      expect(labels(text)).toEqual(TZ_LABELS);
    });

    it('номер заголовка и его текст — через пробел («2.1Primary» раньше склеивался и терял раздел)', () => {
      expect(text).toMatch(/^2\.1 Primary$/m);
      expect(text).toMatch(/^6 Чего в ТЗ нет \(дыры\)$/m);
    });

    it('колонтитулы, повторённые на каждой странице, сняты; таблица — строками «ячейка | ячейка»', () => {
      expect(text).not.toContain('Стр. 1 из 3');
      expect(text).not.toContain('версия 1.4 · синтетика');
      expect(text).toContain('Primary | синяя #0B5FFF');
      expect(text).toMatch(/Вход и профиль \| 5000 рублей за этап \| 10 рабочих дней/);
    });

    it('даты, суммы, сроки и пункты списка остались текстом своих разделов', () => {
      const chunks = chunkByHeadings(text);
      const content = (label: string | null): string => chunks.filter((c) => c.section === label).map((c) => c.content).join('\n');
      expect(content(null)).toContain('14 января 2026 года');
      expect(content('§1 Назначение')).toContain('10 рабочих дней с даты подписания протокола');
      expect(content('§2.1 Primary')).toContain('#0B5FFF');
      expect(content('§2.1 Primary')).toContain('2 кнопки primary на одной форме недопустимы');
      expect(content('§4.1 Успех')).toContain('1. Открыть форму оплаты');
      expect(content('§4.1 Успех')).toContain('5000 рублей за этап');
    });
  });

  it('TZ.docx — автонумерация Google Docs (numPr у абзаца) восстановлена, разделы как в TZ.md', async () => {
    const text = await extractText(read('spec/TZ.docx'), DOCX);
    expect(labels(text)).toEqual(TZ_LABELS);
    expect(text).toContain('## 2.1 Primary');
    expect(text).toContain('1 | Вход и профиль | 5000 рублей за этап | 10 рабочих дней');
  });

  it('PROTOCOL.docx — автонумерация Word в стилях заголовков, таблица и списки', async () => {
    const text = await extractText(read('protocol/PROTOCOL.docx'), detectMime('PROTOCOL.docx'));
    expect(labels(text)).toEqual(PROTOCOL_LABELS);
    expect(text).toContain('# 1 Решения, которых нет в ТЗ v1.4');
    expect(text).toContain('## 2.1 Порядок приёмки');
    expect(text).toContain('Этап | Что сдаём | Сумма | Срок');
    expect(text).toContain('2 | Оплата счетов | 5000 рублей за этап | 10 рабочих дней');
    expect(text).toContain('- PM разбирает замечания в RemarkRound.');
    expect(text).toContain('- Пустая иллюстрация на экране «нет счетов» вне скоупа этой поставки.');
  });

  it('PROTOCOL.doc (Word 97-2003) — текст абзацев, таблица и те же разделы', async () => {
    const data = read('protocol/PROTOCOL.doc');
    const mime = detectMime('PROTOCOL.doc');
    expect(mime).toBe('application/msword');
    expect(() => assertContent(data, mime)).not.toThrow();
    const text = await extractText(data, mime);
    expect(labels(text)).toEqual(PROTOCOL_LABELS);
    expect(text).toContain('1 | Вход и профиль | 5000 рублей за этап | 10 рабочих дней');
    expect(text).toContain('Пакет документов = ТЗ + этот протокол. Созвон без записи система не знает.');
    const itog = chunkByHeadings(text).find((c) => c.section === '§3 Итог')!;
    expect(itog.content).toBe('Пакет документов = ТЗ + этот протокол. Созвон без записи система не знает.');
  });

  it('Word-файл с чужим расширением читается по содержимому: DOCX под .doc и DOC под .docx', async () => {
    expect(labels(await extractText(read('spec/TZ.docx'), 'application/msword'))).toEqual(TZ_LABELS);
    expect(labels(await extractText(read('protocol/PROTOCOL.doc'), DOCX))).toEqual(PROTOCOL_LABELS);
  });
});

describe('normalizeText', () => {
  it('«\u0138» из PDF Chrome → «к», лигатуры и неразрывные пробелы — по NFKC, «№» и «м²» не трогает', () => {
    expect(normalizeText('\u0138ноп\u0138а «Сохранить»')).toBe('кнопка «Сохранить»');
    expect(normalizeText('\uFB01le\u00A0name')).toBe('file name');
    expect(normalizeText('Договор № 5, площадь 10 м²')).toBe('Договор № 5, площадь 10 м²');
    expect(normalizeText('и\u0306')).toBe('й');
  });

  it('мягкий перенос склеивает слово, в том числе через конец строки', () => {
    expect(normalizeText('пере\u00AD\nносится и\u00ADзредка')).toBe('переносится изредка');
  });
});

describe('detectMime и assertContent: .doc', () => {
  it('.doc — application/msword; неизвестное расширение — 422 со списком форматов', () => {
    expect(detectMime('ТЗ_v2.DOC')).toBe('application/msword');
    expect(() => detectMime('tz.rtf')).toThrow(`Поддерживаются ${SUPPORTED_FORMATS}`);
    expect(SUPPORTED_FORMATS).toBe('PDF, DOCX, DOC, Markdown и текст');
  });

  it('OLE2 без потока WordDocument (xls, msg под .doc), текст и RTF под .doc — 422', () => {
    const xls = Buffer.concat([OLE2, Buffer.alloc(1024), Buffer.from('Workbook', 'utf16le')]);
    expect(() => assertContent(xls, 'application/msword')).toThrow(/не совпадает с его типом/);
    expect(() => assertContent(Buffer.from('просто текст'), 'application/msword')).toThrow(/не совпадает с его типом/);
    expect(() => assertContent(Buffer.from('{\\rtf1\\ansi текст}'), 'application/msword')).toThrow(/RTF/);
  });

  it('DOCX под паролем (OLE2 с EncryptedPackage) — 422 с понятной причиной', () => {
    const encrypted = Buffer.concat([OLE2, Buffer.alloc(1024), Buffer.from('EncryptedPackage', 'utf16le')]);
    expect(() => assertContent(encrypted, DOCX)).toThrow(/паролем/);
  });
});

/**
 * Сквозной путь как у PM: multipart-загрузка → очередь индексации → поиск. Эмбеддинги — детерминированный
 * мешок слов (test/fake-embeddings.ts): проверяется обвязка и подписи разделов, не смысловой поиск.
 */
describe('загрузка PDF и DOC в пакет документов → поиск находит раздел', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const prisma = new PrismaClient();
  const tag = randomUUID().slice(0, 8);
  const ids = { user: '', project: '' };
  let auth: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EmbeddingsService).useValue(new FakeEmbeddingsService()).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(validationPipe());
    await app.init();
    http = request(app.getHttpServer());
    const password = 'secret-extract';
    const user = await prisma.user.create({ data: { email: `extract-${tag}@test.dev`, name: 'PM', passwordHash: await hashPassword(password) } });
    const project = await prisma.project.create({ data: { name: `EXTRACT-${tag}`, memberships: { create: { userId: user.id, role: 'pm' } } } });
    Object.assign(ids, { user: user.id, project: project.id });
    const login = await http.post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    auth = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { projectId: ids.project } });
    await prisma.documentChunk.deleteMany({ where: { projectId: ids.project } });
    await prisma.document.deleteMany({ where: { projectId: ids.project } });
    await prisma.membership.deleteMany({ where: { projectId: ids.project } });
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
    await app.close();
  });

  async function uploadAndIndex(path: string, fileName: string, kind: string): Promise<{ id: string; mime: string; chunks: number }> {
    const res = await http.post(`/api/v1/projects/${ids.project}/documents`).set(auth).field('kind', kind).attach('file', read(path), fileName).expect(201);
    let doc = res.body as { id: string; mime: string; status: string; chunks: number };
    // До 30 с: в полном прогоне очередь делят десятки спек, 10 с не хватало (падало раз в несколько прогонов)
    for (let i = 0; i < 300 && doc.status !== 'indexed' && doc.status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      doc = (await http.get(`/api/v1/projects/${ids.project}/documents/${res.body.id}`).set(auth).expect(200)).body;
    }
    expect(doc.status).toBe('indexed');
    return doc;
  }

  it('TZ.pdf: «какого цвета primary-кнопка?» → §2.1 Primary из PDF', async () => {
    const doc = await uploadAndIndex('spec/TZ.pdf', 'ТЗ_Клиентский_кабинет_v1.4.pdf', 'spec');
    expect(doc.mime).toBe('application/pdf');
    const sections = (await prisma.documentChunk.findMany({ where: { documentId: doc.id } })).map((c) => c.section).filter((s) => s?.startsWith('§'));
    expect(sections).toEqual(TZ_LABELS);
    const res = await http.get(`/api/v1/projects/${ids.project}/search`).query({ q: 'какого цвета primary-кнопка?', k: 3 }).set(auth).expect(200);
    expect(res.body.hits[0].section).toBe('§2.1 Primary');
    expect(res.body.hits[0].content).toContain('#0B5FFF');
    expect(res.body.hits[0].documentTitle).toBe('ТЗ_Клиентский_кабинет_v1.4.pdf');
  });

  it('PROTOCOL.doc: индексируется, поиск находит раздел протокола', async () => {
    const doc = await uploadAndIndex('protocol/PROTOCOL.doc', 'Протокол_12.03.doc', 'protocol');
    expect(doc.mime).toBe('application/msword');
    expect(doc.chunks).toBeGreaterThan(0);
    const res = await http.get(`/api/v1/projects/${ids.project}/search`).query({ q: 'порядок приёмки: ретест исправленного', k: 3 }).set(auth).expect(200);
    const top = res.body.hits[0];
    expect(top.documentTitle).toBe('Протокол_12.03.doc');
    expect(top.section).toBe('§2.1 Порядок приёмки');
  });

  it('старый Word, который на деле не Word (xls под .doc) — 422 со списком форматов в тексте', async () => {
    const xls = Buffer.concat([OLE2, Buffer.alloc(1024), Buffer.from('Workbook', 'utf16le')]);
    const res = await http.post(`/api/v1/projects/${ids.project}/documents`).set(auth).field('kind', 'spec').attach('file', xls, 'tz.doc').expect(422);
    expect(res.body.message).toContain('DOC');
  });
});
