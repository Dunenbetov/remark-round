# Evals

Golden set: [`golden.json`](golden.json) — 30 кейсов триажа по 12 типам ударов судьи (REMARKROUND.md §11), 11 кейсов ретеста для A/B и leakage чужого проекта. Семена типов — `../fixtures/evals/seed.json`; кадры — `../fixtures/screenshots/*.png`.

Раннер: `apps/api/src/evals` — golden гоняется через те же сервисы, что REST и MCP (`AgentService` → граф → `RemarksService`), поэтому цифры — про продукт, а не про отдельный «оценочный» промпт.

```bash
pnpm evals                        # live: OPENAI_API_KEY из .env, трейсы в Langfuse с environment=evals
pnpm evals -- --offline           # правила без LLM + фейковые эмбеддинги (CI без ключа)
pnpm evals -- --modes retest      # triage | retest | leakage
pnpm evals -- --only defect-save-gray,retest-addressed-blue
pnpm evals -- --strategies diff_explain
```

Нужен поднятый Postgres (`DATABASE_URL` из `.env`). Отчёт пишется в `results/<дата>-<режим>.md` и `.json`; результаты, на которые ссылается `docs/EVALS.md`, закоммичены, остальное можно удалять.

Метрики (`metrics.ts`): **binding quality** — класс совпал с золотым или законный abstain (`cannot_tell` / `unspecified` там, где golden это разрешает), нужный раздел среди цитат, повтор указывает на оригинал; **faithfulness** — в черновике нет ссылки на раздел без цитаты, «на кадре» без кадра, дефекта без цитаты, «закрыто» от модели и ложных цитат из `mustNotMatch`. Инварианты (leakage, injection не даёт дефекта, faithfulness, ретест никогда не `closed`) держит `apps/api/src/evals/evals.spec.ts` офлайн на каждом `pnpm test`.

Код выхода `pnpm evals` ≠ 0: провал leakage, injection → defect, faithfulness ниже `EVALS_MIN_FAITHFULNESS` (0.9) или binding ниже `EVALS_MIN_BINDING` (0 — порог задаёт CI).
