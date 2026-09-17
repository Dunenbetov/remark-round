import { Prisma } from '@remarkround/db';

/** Транслит для адреса; те же правила, что в миграции 20260913120000_project_slug. Казахские буквы — к ближайшей латинской. */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

/** Первые сегменты адресов SPA: проект с таким slug перекрыл бы страницу. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(['login', 'register', 'join', 'reset', 'no-access', 'projects', 'profile', 'admin', 'api', 'p', 'assets']);

const MAX_LEN = 48;

/** «Клиентский кабинет» → «klientskiy-kabinet»; пусто после очистки — «project». */
export function slugify(name: string): string {
  const latin = [...name.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  const base = latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LEN)
    .replace(/-+$/g, '');
  const safe = base || 'project';
  return RESERVED_SLUGS.has(safe) ? `${safe}-project` : safe;
}

/**
 * Создать запись со свободным slug: base, base-2, base-3… Проверка «занято ли» и вставка не атомарны,
 * поэтому гонку двух одноимённых проектов ловит unique-индекс — пробуем следующий суффикс.
 */
export async function withUniqueSlug<T>(
  name: string,
  taken: (slug: string) => Promise<boolean>,
  create: (slug: string) => Promise<T>,
): Promise<T> {
  const base = slugify(name);
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (await taken(slug)) continue;
    try {
      return await create(slug);
    } catch (e) {
      const slugClash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && JSON.stringify(e.meta?.['target'] ?? '').includes('slug');
      if (!slugClash) throw e;
    }
  }
  throw new Error(`slug: нет свободного адреса для «${name}»`);
}
