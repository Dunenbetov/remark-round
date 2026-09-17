/**
 * slug.spec — человеческий адрес проекта: транслит названия, зарезервированные разделы SPA, пустое название,
 * занятый адрес и гонка одноимённых проектов (unique-индекс → следующий суффикс).
 */
import { Prisma } from '@remarkround/db';
import { slugify, withUniqueSlug } from './slug';

describe('project slug', () => {
  it('транслит: кириллица и казахские буквы → латиница через дефис', () => {
    expect(slugify('Клиентский кабинет')).toBe('klientskiy-kabinet');
    expect(slugify('Чужой проект')).toBe('chuzhoy-proekt');
    expect(slugify('E2E Кабинет клиента')).toBe('e2e-kabinet-klienta');
    expect(slugify('Щедрый ЖКХ: юг / 2026')).toBe('shchedryy-zhkkh-yug-2026');
    expect(slugify('Қазақстан өңірі')).toBe('kazakstan-oniri');
  });

  it('пусто после очистки — project; раздел SPA — с суффиксом; длина ≤ 48 без хвостового дефиса', () => {
    expect(slugify('!!!')).toBe('project');
    expect(slugify('Profile')).toBe('profile-project');
    const long = slugify('Очень длинное название проекта приёмки для большой компании с филиалами');
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith('-')).toBe(false);
  });

  it('занятый адрес → base-2; гонка на unique → следующий суффикс', async () => {
    const taken = new Set(['rod']);
    const clash = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: ['slug'] } });
    let attempts = 0;
    const slug = await withUniqueSlug(
      'РОД',
      async (s) => taken.has(s),
      async (s) => {
        attempts++;
        if (s === 'rod-2') throw clash; // кто-то успел создать rod-2 между проверкой и вставкой
        return s;
      },
    );
    expect(slug).toBe('rod-3');
    expect(attempts).toBe(2);
  });
});
