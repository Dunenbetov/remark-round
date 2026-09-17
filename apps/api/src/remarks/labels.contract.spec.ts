/**
 * labels.contract.spec — контракт API ↔ web без общего пакета (фронт не тянет @remarkround/db, 3.2 ревью беты):
 * ключи подписей статусов совпадают, литеральные union'ы web повторяют enum'ы из schema.prisma. Исходники читаются
 * как текст — спека не зависит от Angular, rootDir jest и от того, экспортирует ли пакет db значения enum'ов.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATUS_LABEL_RU } from './labels';

const ROOT = resolve(__dirname, '../../../..');
const copySource = readFileSync(resolve(ROOT, 'apps/web/src/app/core/copy.ts'), 'utf8');
const modelsSource = readFileSync(resolve(ROOT, 'apps/web/src/app/core/models.ts'), 'utf8');
const schemaSource = readFileSync(resolve(ROOT, 'packages/db/prisma/schema.prisma'), 'utf8');

/** Ключи объектного литерала `export const NAME: … = { key: …, };` из исходника. */
function objectKeys(source: string, name: string): string[] {
  const m = new RegExp('export const ' + name + '[^=]*= \\{([\\s\\S]*?)\\n\\};').exec(source);
  if (!m) throw new Error(name + ' не найден');
  return [...m[1]!.matchAll(/^\s+([a-z_]+):/gm)].map((x) => x[1]!);
}

/** Члены union'а `export type NAME = 'a' | 'b';` из исходника web. */
function unionMembers(source: string, name: string): string[] {
  const m = new RegExp('export type ' + name + ' =([^;]*);').exec(source);
  if (!m) throw new Error(name + ' не найден в models.ts');
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

/** Все `enum Name { a b }` схемы Prisma: комментарии и @@map не считаются. */
function schemaEnums(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of source.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
    const members = m[2]!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
      .map((l) => l.split(/\s+/)[0]!);
    out.set(m[1]!, members);
  }
  return out;
}

describe('labels and enums contract (api ↔ web)', () => {
  it('ключи STATUS_LABEL_RU (xlsx) и STATUS_LABEL (экран) совпадают', () => {
    expect(objectKeys(copySource, 'STATUS_LABEL').sort()).toEqual(Object.keys(STATUS_LABEL_RU).sort());
  });

  it('каждый enum схемы, который web повторяет литералами, совпадает с ним по составу', () => {
    const enums = schemaEnums(schemaSource);
    expect(enums.size).toBeGreaterThan(5);
    const mirrored = [...enums.keys()].filter((name) => new RegExp('^export type ' + name + ' =', 'm').test(modelsSource));
    // Хотя бы статусы, роли и решения — иначе спека проверяет пустоту
    expect(mirrored).toEqual(expect.arrayContaining(['RemarkStatus', 'Role', 'VerdictCode']));
    for (const name of mirrored) {
      expect({ [name]: new Set(unionMembers(modelsSource, name)) }).toEqual({ [name]: new Set(enums.get(name)) });
    }
  });
});
