#!/bin/bash
# A/B «желание против дефекта»: подмножество golden на границе дефект / новое желание / дыра / конфликт,
# N прогонов подряд на текущем коде. Запуск: wish.sh <метка> <N> [full]
cd ~/Desktop/remark-round || exit 1
source ~/.nvm/nvm.sh >/dev/null && nvm use 24 >/dev/null
set -a; . ./.env; set +a
set -a; . ./evals/.env.evals; set +a; export LANGFUSE_PUBLIC_URL="$LANGFUSE_BASE_URL"
unset LANGFUSE_TRACING_ENABLED
export LANGFUSE_TRACING_ENVIRONMENT=evals JWT_SECRET="${JWT_SECRET:-m1}"
D=$(date +%F); TAG=$1; N=${2:-5}
LOG=evals/results/$D-wish-ab.log
ONLY=injection-on-screenshot,cr-dark-theme,cr-language-switch,cr-2fa-sms,cr-google-login,conflict-gray-section-5,conflict-accounting-gray,protocol-empty-illustration,hole-excel-export,hole-filter-reset,hole-2fa-missing,hole-payment-history,lies-label-otpravit,lies-payment-green-profile-shot
echo "[$(date +%H:%M:%S)] $TAG ×$N на $(git rev-parse --short HEAD)$(git diff --quiet || echo ' (+правки)')" | tee -a "$LOG"
for i in $(seq 1 "$N"); do
  out="evals/results/$D-wish-$TAG-$i"
  [ -f "$out.md" ] && { echo "  ↷ $TAG-$i уже есть" | tee -a "$LOG"; continue; }
  pnpm evals -- --modes triage --only "$ONLY" --out "$out" > "$out.stdout" 2>&1
  [ -f "$out.md" ] && echo "  ✓ $TAG-$i" | tee -a "$LOG" || echo "  ✗ $TAG-$i БЕЗ ОТЧЁТА" | tee -a "$LOG"
done
if [ "$3" = "full" ]; then
  for i in 1 2; do
    out="evals/results/$D-fix-base-$i"
    [ -f "$out.md" ] && continue
    pnpm evals -- --out "$out" > "$out.stdout" 2>&1
    [ -f "$out.md" ] && echo "  ✓ fix-base-$i (полный прогон)" | tee -a "$LOG" || echo "  ✗ fix-base-$i БЕЗ ОТЧЁТА" | tee -a "$LOG"
  done
fi
echo "[$(date +%H:%M:%S)] $TAG готово" | tee -a "$LOG"
