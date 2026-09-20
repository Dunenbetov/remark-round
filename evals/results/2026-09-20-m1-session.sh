#!/bin/bash
# M1 — сессия живых замеров по docs/defense/M1-COMMANDS.md.
# Важно: раннер выходит с кодом 1, когда сработал порог качества (injection → defect, faithfulness, leakage).
# Для M1 это ДАННЫЕ, а не поломка: на температуре 0.7 часть кейсов обязана падать. Поэтому успех прогона —
# наличие отчёта .md, а не код выхода. Настоящая поломка (нет отчёта) три раза подряд — сессия останавливается.
# Повторный запуск продолжает с места: прогоны, у которых отчёт уже есть, пропускаются.
cd ~/Desktop/remark-round || exit 1
source ~/.nvm/nvm.sh >/dev/null && nvm use 24 >/dev/null
set -a; . ./.env; set +a
EVALS_ENV=""
for f in .env.evals evals/.env.evals; do [ -f "$f" ] && EVALS_ENV="$f" && break; done
if [ -n "$EVALS_ENV" ]; then set -a; . "./$EVALS_ENV"; set +a; export LANGFUSE_PUBLIC_URL="$LANGFUSE_BASE_URL"; echo "langfuse: $EVALS_ENV → $LANGFUSE_BASE_URL"; else echo "langfuse: локальный ($LANGFUSE_BASE_URL)"; fi
unset LANGFUSE_TRACING_ENABLED
export LANGFUSE_TRACING_ENVIRONMENT=evals
export JWT_SECRET="${JWT_SECRET:-m1}"
D=$(date +%F)
LOG=evals/results/$D-m1-session.log
FAILS=0
run() { # run <имя> <переменные окружения...> -- <аргументы evals>
  local name=$1; shift
  local envs=(); while [ "$1" != "--" ]; do envs+=("$1"); shift; done; shift
  local out="evals/results/$D-$name"
  if [ -f "$out.md" ]; then echo "[$(date +%H:%M:%S)] ↷ $name — отчёт уже есть, пропускаю" | tee -a "$LOG"; return; fi
  local t0=$(date +%s)
  echo "[$(date +%H:%M:%S)] ▶ $name ${envs[*]}" | tee -a "$LOG"
  env "${envs[@]}" pnpm evals -- "$@" --out "$out" > "$out.stdout" 2>&1
  local code=$?
  if [ -f "$out.md" ]; then
    FAILS=0
    local gate=""
    [ "$code" -ne 0 ] && gate=" · порог: $(grep -m1 'evals: провал' "$out.stdout" | sed 's/evals: провал — //')"
    echo "[$(date +%H:%M:%S)] ✓ $name за $(( $(date +%s) - t0 )) с$gate" | tee -a "$LOG"
  else
    FAILS=$((FAILS + 1))
    echo "[$(date +%H:%M:%S)] ✗ $name БЕЗ ОТЧЁТА (код $code, см. $D-$name.stdout): $(grep -oiE 'insufficient_quota|unauthorized|econnrefused|rate.?limit[a-z_]*|Error: .{0,80}' "$out.stdout" | tail -1)" | tee -a "$LOG"
    if [ "$FAILS" -ge 3 ]; then echo "[$(date +%H:%M:%S)] ⛔ три прогона подряд без отчёта — сессия остановлена" | tee -a "$LOG"; exit 1; fi
  fi
}
echo "M1 старт $(date '+%F %H:%M'), sha $(git rev-parse --short HEAD)" | tee -a "$LOG"
# 0. офлайн-контроль на закоммиченном коде
run offline EVALS_OFFLINE=1 -- --offline
# 1. разброс от прогона к прогону на настройках по умолчанию
run live-base-1 --
run live-base-2 --
# 2. гиперпараметры (база — шаг 1)
run tclassify-0.3 LLM_TEMP_CLASSIFY=0.3 -- --modes triage
run tclassify-0.7 LLM_TEMP_CLASSIFY=0.7 -- --modes triage
run tdraft-0 LLM_TEMP_DRAFT=0 -- --modes triage
run tdraft-0.7 LLM_TEMP_DRAFT=0.7 -- --modes triage
run topp-0.8 LLM_TOP_P=0.8 -- --modes triage
run maxtok-draft-120 LLM_MAX_TOKENS_DRAFT=120 -- --modes triage
run maxtok-draft-400 LLM_MAX_TOKENS_DRAFT=400 -- --modes triage
# 3. модели
run model-all-4.1 LLM_MODEL_FAST=gpt-4.1 -- --modes triage,retest
run model-fast-nano LLM_MODEL_FAST=gpt-4.1-nano -- --modes triage,retest
run model-draft-mini LLM_MODEL_STRONG=gpt-4.1-mini -- --modes triage
# 4. настоящий запасной режим: правила + настоящие эмбеддинги
run rules-real-emb LLM_MODE=rules -- --modes triage
# 5. абляции
run skill-off SKILL_DISABLED=1 -- --modes triage
run vision-off VISION_DISABLED=1 -- --modes triage
# 6. ретест: разброс, detail low
run retest-auto-1 -- --modes retest
run retest-auto-2 -- --modes retest
run retest-detail-low LLM_IMAGE_DETAIL=low -- --modes retest
run triage-frames-detail-low LLM_IMAGE_DETAIL=low -- --modes triage --only defect-save-gray,defect-payment-toast,defect-login-secondary,defect-two-primary,lies-payment-green-profile-shot,lies-label-otpravit,injection-real-defect-save-gray,injection-on-screenshot
# 7. чанкинг
if [ -f "evals/results/$D-rag-eval.txt" ]; then
  echo "[$(date +%H:%M:%S)] ↷ rag-eval — уже есть" | tee -a "$LOG"
else
  echo "[$(date +%H:%M:%S)] ▶ rag-eval" | tee -a "$LOG"
  pnpm --filter @remarkround/api rag:eval > "evals/results/$D-rag-eval.txt" 2>&1 && echo "[$(date +%H:%M:%S)] ✓ rag-eval" | tee -a "$LOG" || echo "[$(date +%H:%M:%S)] ✗ rag-eval" | tee -a "$LOG"
fi
echo "M1 финиш $(date '+%F %H:%M')" | tee -a "$LOG"
