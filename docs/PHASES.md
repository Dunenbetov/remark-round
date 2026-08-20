# Фазы реализации

Не начинать с графа. Одна фаза = один фокус агента. Следующая — только если DoD предыдущей зелёный.

## Фаза 0 — каркас репо

- [ ] `apps/web` Angular, `apps/api` Nest, `packages/db` Prisma, compose: api+web+postgres+langfuse
- [ ] `.env.example` без секретов
- [ ] Этот набор docs не удалять

**DoD:** `docker compose up` поднимает пустые сервисы.

## Фаза 1 — тенанси

- [ ] Prisma как в `packages/db/prisma/schema.prisma`
- [ ] Auth JWT, Project, Membership
- [ ] Тест leakage

**DoD:** два проекта, пользователь A не читает документы B.

## Фаза 2 — RAG без агента

- [ ] Upload PDF/DOCX в пакет
- [ ] Chunk по заголовкам, embed, pgvector
- [ ] Search с цитатой, SQL-фильтр
- [ ] Кусок обоснования чанкинга в ARCHITECTURE (что пробовали)

**DoD:** вопрос «какого цвета primary-кнопка?» возвращает § из `fixtures/spec`.

## Фаза 3 — замечание и карточка

Канон UI: `docs/ui/COPY.md`, `VISUAL.md`, `ANTI.md`, `reference.html`. Промпт: `docs/ui/AGENT-PROMPT.md`.

- [ ] Round, Remark, screenshot upload
- [ ] Карточка: три колонки улики | черновик разбора | решение
- [ ] Подписи кнопок **дословно** из COPY.md (не Approve)
- [ ] Шапка с ролью («Вы решаете, работа ли это»)
- [ ] Скрин крупнее текста модели; клик — на весь экран
- [ ] Нет канбана, чата, Material indigo, % уверенности (ANTI.md чист)
- [ ] Пустые состояния из COPY.md
- [ ] Ещё без LLM, можно заглушка черновика

**DoD:** бизнес создаёт замечание со скрином; PM на карточке за 30 секунд понимает, что жать. Сверка с `reference.html`.

## Фаза 4 — импорт шаблона

- [ ] Скачать `fixtures/journal/template.csv` / xlsx
- [ ] Парсер только этих колонок
- [ ] Пустой description → `needs_human_parse`
- [ ] Картинки из xlsx, если есть

**DoD:** `sample-round.csv` даёт смесь parsed + needs_human_parse. Чужой Excel с другой шапкой не «магически» маппится.

## Фаза 5 — pixel-diff

- [ ] `DiffModule` на `fixtures/screenshots`
- [ ] Несопоставимые кадры → `cannot_compare`

**DoD:** before/after даёт картинку диффа; before vs zoom → cannot_compare или явный шум.

## Фаза 6 — граф + WS

- [ ] Ноды `docs/GRAPH.md`, циклы max 2, interrupt
- [ ] WS `docs/WS.md`
- [ ] Persist только через RemarksService
- [ ] Два окна: reject_binding продолжает тот же run

**DoD:** сюжет DEMO шаги 4–5 без фанеры «setTimeout имитация».

## Фаза 7 — MCP + Skill

- [ ] `apps/mcp` фасад
- [ ] 3 tool’а, auth, project из токена
- [ ] `skills/uat-triage/SKILL.md` в нодах
- [ ] Cursor находит спеку своего проекта

**DoD:** ментор может дернуть MCP не из Angular.

## Фаза 8 — Langfuse на каждый LLM-вызов

**DoD:** открыл UI Langfuse, виден сценарий DEMO.

## Фаза 9 — evals ≥30 + A/B

- [ ] Добить golden от seed
- [ ] Две метрики
- [ ] A/B цифры в EVALS.md и дефолт в коде

**DoD:** `pnpm evals` в CI или одной командой.

## Фаза 10 — guardrails и артефакты сдачи

- [ ] Injection in, no fake cites out
- [ ] README портфолио (не «LLM Engineer»)
- [ ] ARCHITECTURE.md, EVALS.md, презентация, compose polish

**DoD:** чеклист nFactorial из `REMARKROUND.md` §6.1 зелёный.
