/**
 * Сводка отчёта evals: цифры для docs/EVALS.md и порог для CI. Markdown пишется в evals/results/.
 */
import type { RetestStrategy } from '../agent/graph-state';
import { pct, ratio } from './metrics';
import type { EvalReport, RetestResult, TriageResult } from './runner';

export interface TriageSummary {
  n: number;
  bindingOk: number;
  bindingQuality: number;
  abstained: number;
  faithfulOk: number;
  faithfulness: number;
  errors: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  byType: Array<{ type: string; n: number; bindingOk: number; faithfulOk: number }>;
}

export interface StrategySummary {
  strategy: RetestStrategy;
  n: number;
  ok: number;
  quality: number;
  falseAddressed: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  avgTokens: number;
}

export interface Summary {
  triage: TriageSummary;
  retest: StrategySummary[];
  leakageOk: boolean;
  /** Победитель A/B по правилу docs/EVALS.md: качество, при равенстве — меньше ложных «исправлено», потом стоимость. */
  winner: RetestStrategy | null;
}

export function summarize(report: EvalReport): Summary {
  const t = report.triage;
  const byType = new Map<string, { n: number; bindingOk: number; faithfulOk: number }>();
  for (const r of t) {
    const row = byType.get(r.type) ?? { n: 0, bindingOk: 0, faithfulOk: 0 };
    row.n++;
    if (r.binding.ok) row.bindingOk++;
    if (r.faithfulness.ok) row.faithfulOk++;
    byType.set(r.type, row);
  }
  const triage: TriageSummary = {
    n: t.length,
    bindingOk: t.filter((r) => r.binding.ok).length,
    bindingQuality: ratio(t.filter((r) => r.binding.ok).length, t.length),
    abstained: t.filter((r) => r.binding.abstained).length,
    faithfulOk: t.filter((r) => r.faithfulness.ok).length,
    faithfulness: ratio(t.filter((r) => r.faithfulness.ok).length, t.length),
    errors: t.filter((r) => r.error).length,
    avgCostUsd: avg(t.map((r) => r.usage.costUsd)),
    avgLatencyMs: avg(t.map((r) => r.usage.latencyMs)),
    byType: [...byType.entries()].map(([type, row]) => ({ type, ...row })),
  };
  const strategies = [...new Set(report.retest.map((r) => r.strategy))];
  const retest = strategies.map((strategy) => {
    const rows = report.retest.filter((r) => r.strategy === strategy);
    return {
      strategy,
      n: rows.length,
      ok: rows.filter((r) => r.score.ok).length,
      quality: ratio(rows.filter((r) => r.score.ok).length, rows.length),
      falseAddressed: rows.filter((r) => r.score.falseAddressed).length,
      avgCostUsd: avg(rows.map((r) => r.usage.costUsd)),
      avgLatencyMs: avg(rows.map((r) => r.usage.latencyMs)),
      avgTokens: avg(rows.map((r) => r.usage.inputTokens + r.usage.outputTokens)),
    };
  });
  const winner = [...retest].sort((a, b) => b.quality - a.quality || a.falseAddressed - b.falseAddressed || a.avgCostUsd - b.avgCostUsd)[0]?.strategy ?? null;
  return { triage, retest, leakageOk: report.leakage.every((l) => l.ok), winner };
}

export function toMarkdown(report: EvalReport, summary: Summary): string {
  const lines: string[] = [];
  lines.push(`# Evals — ${report.startedAt.slice(0, 16).replace('T', ' ')} UTC, режим ${report.mode}`);
  lines.push('');
  lines.push(`Модель: \`${report.model}\`, эмбеддинги: \`${report.embeddings}\`, golden v${report.golden.version} (${report.golden.cases} кейсов), длительность ${duration(report)}.`);
  lines.push('');
  lines.push('## Триаж');
  lines.push('');
  lines.push('| Метрика | Значение |');
  lines.push('|---|---|');
  lines.push(`| N | ${summary.triage.n} |`);
  lines.push(`| Binding quality | ${summary.triage.bindingOk}/${summary.triage.n} = **${pct(summary.triage.bindingQuality)}** (из них законный abstain: ${summary.triage.abstained}) |`);
  lines.push(`| Faithfulness | ${summary.triage.faithfulOk}/${summary.triage.n} = **${pct(summary.triage.faithfulness)}** |`);
  lines.push(`| Ошибок прогона | ${summary.triage.errors} |`);
  lines.push(`| Средняя стоимость триажа | $${summary.triage.avgCostUsd.toFixed(4)} |`);
  lines.push(`| Средняя латентность | ${(summary.triage.avgLatencyMs / 1000).toFixed(1)} с |`);
  lines.push('');
  lines.push('| Тип | N | Binding | Faithfulness |');
  lines.push('|---|---|---|---|');
  for (const row of summary.triage.byType) lines.push(`| ${row.type} | ${row.n} | ${row.bindingOk}/${row.n} | ${row.faithfulOk}/${row.n} |`);
  lines.push('');
  lines.push('| Кейс | Предложено | Цитаты | Binding | Faithfulness | $ | с |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of report.triage) lines.push(triageRow(r));
  lines.push('');
  lines.push('## Ретест: A/B');
  lines.push('');
  lines.push('| Вариант | N | Quality | Ложных «исправлено» | Avg cost USD | Avg latency | Avg tokens |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of summary.retest) {
    lines.push(`| ${label(s.strategy)} | ${s.n} | ${s.ok}/${s.n} = **${pct(s.quality)}** | ${s.falseAddressed} | $${s.avgCostUsd.toFixed(4)} | ${(s.avgLatencyMs / 1000).toFixed(1)} с | ${Math.round(s.avgTokens)} |`);
  }
  if (summary.winner) lines.push('', `Победитель: **${label(summary.winner)}**.`);
  lines.push('');
  lines.push('| Кейс | Вариант | Исход | Ок | Пояснение |');
  lines.push('|---|---|---|---|---|');
  for (const r of report.retest) lines.push(retestRow(r));
  lines.push('');
  lines.push('## Leakage');
  lines.push('');
  for (const l of report.leakage) lines.push(`- ${l.ok ? '✓' : '✗'} \`${l.id}\`: ${l.detail}`);
  lines.push('');
  return lines.join('\n');
}

export function label(strategy: RetestStrategy): string {
  return strategy === 'diff_explain' ? 'H1 diff+explain' : 'H0 LLM-only';
}

function triageRow(r: TriageResult): string {
  const notes = [...r.binding.reasons, ...r.faithfulness.issues.map((i) => `faithfulness: ${i}`), ...(r.error ? [`ошибка: ${r.error}`] : [])].join('; ');
  return `| \`${r.id}\` | ${r.proposedClass ?? '—'} | ${r.citedSections.join(', ') || '—'} | ${r.binding.ok ? '✓' : `✗ ${escape(notes)}`} | ${r.faithfulness.ok ? '✓' : '✗'} | ${r.usage.costUsd.toFixed(4)} | ${(r.usage.latencyMs / 1000).toFixed(1)} |`;
}

function retestRow(r: RetestResult): string {
  return `| \`${r.id}\` | ${label(r.strategy)} | ${r.outcome ?? '—'} | ${r.score.ok ? '✓' : `✗ ${escape(r.score.issues.join('; '))}`} | ${escape(r.explanation.slice(0, 140))} |`;
}

function escape(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function duration(report: EvalReport): string {
  const ms = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  return `${Math.round(ms / 1000)} с`;
}
