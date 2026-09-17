-- Человеческий адрес проекта: /klientskiy-kabinet/round-2/12 вместо /p/<uuid>/r/2/remarks/<uuid>.
-- slug — транслит названия (те же правила, что apps/api/src/projects/slug.ts); при переименовании не меняется.
-- Существующим проектам slug считается здесь же; совпадения — суффикс -2, -3… по дате создания;
-- зарезервированные разделы SPA (login, profile, …) получают суффикс -project.
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации не нужен.

ALTER TABLE "Project" ADD COLUMN "slug" TEXT;

WITH translit AS (
  SELECT "id", "createdAt",
    translate(
      replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        lower("name"),
        'щ', 'shch'), 'ж', 'zh'), 'х', 'kh'), 'ц', 'ts'), 'ч', 'ch'), 'ш', 'sh'),
        'ю', 'yu'), 'я', 'ya'), 'ё', 'e'), 'й', 'y'), 'ъ', ''), 'ь', ''),
      'абвгдезиклмнопрстуфыэәғқңөұүһі',
      'abvgdeziklmnoprstufyeagknouuhi'
    ) AS t
  FROM "Project"
), cleaned AS (
  SELECT "id", "createdAt",
    COALESCE(NULLIF(trim(BOTH '-' FROM left(trim(BOTH '-' FROM regexp_replace(t, '[^a-z0-9]+', '-', 'g')), 48)), ''), 'project') AS base
  FROM translit
), safe AS (
  SELECT "id", "createdAt",
    CASE WHEN base IN ('login', 'register', 'join', 'no-access', 'projects', 'profile', 'admin', 'api', 'p', 'assets') THEN base || '-project' ELSE base END AS base
  FROM cleaned
), ranked AS (
  SELECT "id", base, row_number() OVER (PARTITION BY base ORDER BY "createdAt", "id") AS n
  FROM safe
)
UPDATE "Project" p
SET "slug" = CASE WHEN r.n = 1 THEN r.base ELSE r.base || '-' || r.n END
FROM ranked r
WHERE r."id" = p."id";

ALTER TABLE "Project" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
