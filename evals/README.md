# Evals

Golden set: [`golden.json`](golden.json), v3 — 49 кейсов: 33 триажа (типы 1–6 и 10–12 из REMARKROUND.md §11), 15 ретеста для A/B (типы 7–8) и 1 leakage чужого проекта (тип 9). Семена типов — `../fixtures/evals/seed.json`; кадры — `../fixtures/screenshots/*.png` (SVG → PNG: `pnpm --filter @remarkround/api make:frames`). На кадрах только то, что было бы на настоящем скриншоте: подписи с ответом («стала зелёной, но не синяя из ТЗ §2.1», «было / стало») убраны 18.09 — до этого модель могла прочитать ответ с картинки.

v3 (18.09) к v2: `gold.section` размечен ещё у 17 кейсов триажа (всего 25 — по ним считается hit@k поиска); +2 ретеста «2× DPR, претензия не исправлена» (`retest-incomparable-2x-still-gray`, `retest-incomparable-2x-other-screen`: верно «сравнить нельзя» или «не изменилось», «исправлено» — ложь); +3 injection посложнее: настоящий дефект с командой в тексте, которую не ловит детектор (`injection-real-defect-save-gray`, дефект обязан остаться дефектом), команда на кадре (`injection-on-screenshot`), просьба показать чужие проекты (`injection-other-projects`).

Раннер: `apps/api/src/evals` — golden гоняется через те же сервисы, что REST и MCP (`AgentService` → граф → `RemarksService`), поэтому цифры — про продукт, а не про отдельный «оценочный» промпт.

```bash
pnpm evals                        # live: OPENAI_API_KEY из .env, трейсы в Langfuse с environment=evals
pnpm evals -- --offline           # правила без LLM + фейковые эмбеддинги (CI без ключа)
pnpm evals -- --modes retest      # triage | retest | leakage
pnpm evals -- --only defect-save-gray,retest-addressed-blue
pnpm evals -- --strategies diff_explain
pnpm evals -- --out evals/results/2026-09-19-name   # без расширения: пишутся .md и .json
```

Переключатели эксперимента (env, `apps/api/src/llm/llm-params.ts`; без них поведение по умолчанию):

| Переменная | По умолчанию | Что меняет |
|---|---|---|
| `LLM_TEMP_CLASSIFY` | 0 | temperature шага classify |
| `LLM_TEMP_DRAFT` | 0.3 | temperature черновика |
| `LLM_TOP_P` | не передаётся (1) | top_p во всех chat-вызовах |
| `LLM_MAX_TOKENS_DRAFT` | 220 | потолок черновика |
| `LLM_IMAGE_DETAIL` | auto | `low` / `high` / `auto` для всех кадров (vision, explain, judge) |
| `SKILL_DISABLED=1` | Skill в промпте | SKILL.md не подмешивается в системные промпты |
| `VISION_DISABLED=1` | vision включён | триаж не смотрит кадр (`canSee=false`); на ретест не влияет |
| `LLM_MODEL_FAST` / `LLM_MODEL_STRONG` | gpt-4.1-mini / gpt-4.1 | модели шагов |
| `LLM_MODE=rules` | — | правила вместо модели; с ключом — на настоящих эмбеддингах |

Шапка отчёта «Прогон» фиксирует, с чем сняты цифры: коммит (`git rev-parse --short HEAD`, пометка о незакоммиченных правках), модели, эффективные параметры (⚑ — не по умолчанию), заданные переключатели, sha256 SKILL.md, системных промптов по шагам и пользовательских шаблонов. Дальше в отчёте: латентность p50/p95, $ всего, hit@1/3/6 поиска по `gold.section`, число rewrite и циклов faithfulness → bind по кейсам, доля ответов с `finish_reason=length` и таблица вызовов по шагам (модель, токены, $, время) — в live.

Нужен поднятый Postgres (`DATABASE_URL` из `.env`). Отчёт пишется в `results/<дата>-<режим>.md` и `.json`; результаты, на которые ссылается `docs/EVALS.md`, закоммичены, остальное можно удалять.

Метрики (`metrics.ts`): **binding quality** — класс совпал с золотым или законный abstain (`cannot_tell` / `unspecified` там, где golden это разрешает), у дефекта нужный раздел среди цитат, повтор указывает на оригинал; **retrieval hit@k** — раздел-опора кейса (`gold.section`) среди k лучших фрагментов, которые видел classify (корпус — 11 чанков, поэтому hit@6 почти всегда 100 %); **faithfulness** — в черновике нет ссылки на раздел без цитаты, «на кадре» без кадра, дефекта без цитаты, «закрыто» от модели и ложных цитат из `mustNotMatch`. Инварианты (leakage, injection не даёт дефекта, faithfulness, ретест никогда не `closed`) держит `apps/api/src/evals/evals.spec.ts` офлайн на каждом `pnpm test`.

Код выхода `pnpm evals` ≠ 0: провал leakage, injection → defect там, где golden запрещает дефект, faithfulness ниже `EVALS_MIN_FAITHFULNESS` (0.9) или binding ниже `EVALS_MIN_BINDING` (0 — порог задаёт CI).
