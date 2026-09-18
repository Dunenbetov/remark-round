# M1 — команды сессии живых замеров

Задача M1 из [DEFENSE-PLAN.md](DEFENSE-PLAN.md). Подготовлено 18.09 после P4/P5 (коммит `312cbc7`). Около $3 при исправленной цене (P3), $0.15–0.2 за полный прогон. Перед стартом всё закоммичено, чтобы в отчёте был чистый sha.

Решить до запуска: убирать ли слова «дело», «судья», «улики» из системного промпта. Любая правка промпта после M1 обесценит цифры.

```bash
cd ~/Desktop/remark-round && source ~/.nvm/nvm.sh && nvm use 24
docker compose up -d postgres && docker compose stop api mcp
set -a; . ./.env; set +a; export LANGFUSE_TRACING_ENVIRONMENT=evals   # ключ OpenAI + ключи Langfuse Cloud (EU)
D=$(date +%F)
# 0. офлайн-контроль на закоммиченном коде
pnpm evals -- --offline --out evals/results/$D-offline
# 1. разброс от прогона к прогону на настройках по умолчанию (полный прогон)
pnpm evals -- --out evals/results/$D-live-base-1
pnpm evals -- --out evals/results/$D-live-base-2
# 2. гиперпараметры (база — шаг 1)
LLM_TEMP_CLASSIFY=0.3 pnpm evals -- --modes triage --out evals/results/$D-tclassify-0.3
LLM_TEMP_CLASSIFY=0.7 pnpm evals -- --modes triage --out evals/results/$D-tclassify-0.7
LLM_TEMP_DRAFT=0 pnpm evals -- --modes triage --out evals/results/$D-tdraft-0
LLM_TEMP_DRAFT=0.7 pnpm evals -- --modes triage --out evals/results/$D-tdraft-0.7
LLM_TOP_P=0.8 pnpm evals -- --modes triage --out evals/results/$D-topp-0.8
LLM_MAX_TOKENS_DRAFT=120 pnpm evals -- --modes triage --out evals/results/$D-maxtok-draft-120
LLM_MAX_TOKENS_DRAFT=400 pnpm evals -- --modes triage --out evals/results/$D-maxtok-draft-400
# 3. модели
LLM_MODEL_FAST=gpt-4.1 pnpm evals -- --modes triage,retest --out evals/results/$D-model-all-4.1
LLM_MODEL_FAST=gpt-4.1-nano pnpm evals -- --modes triage,retest --out evals/results/$D-model-fast-nano
LLM_MODEL_STRONG=gpt-4.1-mini pnpm evals -- --modes triage --out evals/results/$D-model-draft-mini
# 4. настоящий запасной режим: правила + настоящие эмбеддинги
LLM_MODE=rules pnpm evals -- --modes triage --out evals/results/$D-rules-real-emb
# 5. абляции
SKILL_DISABLED=1 pnpm evals -- --modes triage --out evals/results/$D-skill-off
VISION_DISABLED=1 pnpm evals -- --modes triage --out evals/results/$D-vision-off
# 6. ретест с новыми кейсами 2x, detail low против auto
pnpm evals -- --modes retest --out evals/results/$D-retest-auto-1
pnpm evals -- --modes retest --out evals/results/$D-retest-auto-2
LLM_IMAGE_DETAIL=low pnpm evals -- --modes retest --out evals/results/$D-retest-detail-low
LLM_IMAGE_DETAIL=low pnpm evals -- --modes triage --only defect-save-gray,defect-payment-toast,defect-login-secondary,defect-two-primary,lies-payment-green-profile-shot,lies-label-otpravit,injection-real-defect-save-gray,injection-on-screenshot --out evals/results/$D-triage-frames-detail-low
# 7. чанкинг
pnpm --filter @remarkround/api rag:eval | tee evals/results/$D-rag-eval.txt
```

После прогона: отчёты в `evals/results/` закоммитить одним коммитом, затем задача M2 (переписать `docs/EVALS.md`).
