/**
 * Сводка отчёта evals: цифры для docs/EVALS.md и порог для CI. Markdown пишется в evals/results/.
 */
import type { RetestStrategy } from '../agent/graph-state';
import { DEFAULT_LLM_PARAMS } from '../llm/llm-params';
import { percentile, pct, ratio } from './metrics';
import type { EvalReport, LlmCall, RetestResult, RunMeta, TriageResult } from './runner';

/** Вызовы модели за прогон (P4): сколько, почём, сколько ответов упёрлись в max_tokens. В офлайне все нули. */
export interface CallSummary {
  n: number;
  /** finish_reason=length — ответ обрезан потолком max_tokens. */
  truncated: number;
  truncatedShare: number;
  inputTokens: number;
  outputTokens: number;
  /** По прайсу pricing.ts, как AgentRun.costUsd. */
  costUsd: number;
  byNode: Array<{ node: string; models: string[]; n: number; truncated: number; avgInputTokens: number; avgOutputTokens: number; costUsd: number; latencyP50Ms: number; latencyP95Ms: number }>;
}

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
  totalCostUsd: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  /** Переписываний запроса всего и в скольких кейсах был хотя бы один. */
  rewrites: { total: number; cases: number };
  /** Циклов faithfulness → bind всего и в скольких кейсах. */
  bindLoops: { total: number; cases: number };
  /** hit@k поиска по кейсам с gold.section. */
  retrieval: { n: number; hitAt1: number; hitAt3: number; hitAt6: number };
  calls: CallSummary;
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
  totalCostUsd: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  /** Кейсов, где модель вызывалась (остальные решила предпроверка кадров без модели). */
  withModel: number;
  calls: CallSummary;
}

export interface Summary {
  triage: TriageSummary;
  retest: StrategySummary[];
  leakageOk: boolean;
  /** Победитель A/B по правилу docs/EVALS.md: качество, при равенстве — меньше ложных «исправлено», потом стоимость. */
  winner: RetestStrategy | null;
  /** Весь прогон: триаж + все стратегии ретеста. */
  totalCostUsd: number;
  calls: CallSummary;
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
    totalCostUsd: sum(t.map((r) => r.usage.costUsd)),
    latencyP50Ms: percentile(t.map((r) => r.usage.latencyMs), 0.5),
    latencyP95Ms: percentile(t.map((r) => r.usage.latencyMs), 0.95),
    rewrites: { total: sum(t.map((r) => r.rewriteCount ?? 0)), cases: t.filter((r) => (r.rewriteCount ?? 0) > 0).length },
    bindLoops: { total: sum(t.map((r) => r.bindLoops ?? 0)), cases: t.filter((r) => (r.bindLoops ?? 0) > 0).length },
    retrieval: {
      n: t.filter((r) => r.retrieval).length,
      hitAt1: t.filter((r) => r.retrieval?.hitAt1).length,
      hitAt3: t.filter((r) => r.retrieval?.hitAt3).length,
      hitAt6: t.filter((r) => r.retrieval?.hitAt6).length,
    },
    calls: callSummary(t.flatMap((r) => r.calls ?? [])),
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
      totalCostUsd: sum(rows.map((r) => r.usage.costUsd)),
      latencyP50Ms: percentile(rows.map((r) => r.usage.latencyMs), 0.5),
      latencyP95Ms: percentile(rows.map((r) => r.usage.latencyMs), 0.95),
      withModel: rows.filter((r) => (r.calls ?? []).length > 0 || r.usage.inputTokens > 0).length,
      calls: callSummary(rows.flatMap((r) => r.calls ?? [])),
    };
  });
  const winner = [...retest].sort((a, b) => b.quality - a.quality || a.falseAddressed - b.falseAddressed || a.avgCostUsd - b.avgCostUsd)[0]?.strategy ?? null;
  const totalCostUsd = triage.totalCostUsd + sum(retest.map((s) => s.totalCostUsd));
  const calls = callSummary([...t.flatMap((r) => r.calls ?? []), ...report.retest.flatMap((r) => r.calls ?? [])]);
  return { triage, retest, leakageOk: report.leakage.every((l) => l.ok), winner, totalCostUsd, calls };
}

export function callSummary(calls: LlmCall[]): CallSummary {
  const nodes = [...new Set(calls.map((c) => c.node))];
  const truncated = calls.filter((c) => c.finishReason === 'length').length;
  return {
    n: calls.length,
    truncated,
    truncatedShare: ratio(truncated, calls.length),
    inputTokens: sum(calls.map((c) => c.inputTokens)),
    outputTokens: sum(calls.map((c) => c.outputTokens)),
    costUsd: sum(calls.map((c) => c.costUsd)),
    byNode: nodes.map((node) => {
      const rows = calls.filter((c) => c.node === node);
      return {
        node,
        models: [...new Set(rows.map((c) => c.model))],
        n: rows.length,
        truncated: rows.filter((c) => c.finishReason === 'length').length,
        avgInputTokens: avg(rows.map((c) => c.inputTokens)),
        avgOutputTokens: avg(rows.map((c) => c.outputTokens)),
        costUsd: sum(rows.map((c) => c.costUsd)),
        latencyP50Ms: percentile(rows.map((c) => c.latencyMs), 0.5),
        latencyP95Ms: percentile(rows.map((c) => c.latencyMs), 0.95),
      };
    }),
  };
}

export function toMarkdown(report: EvalReport, summary: Summary): string {
  const lines: string[] = [];
  lines.push(`# Evals — ${report.startedAt.slice(0, 16).replace('T', ' ')} UTC, режим ${report.mode}`);
  lines.push('');
  lines.push(`Модель: \`${report.model}\`, эмбеддинги: \`${report.embeddings}\`, golden v${report.golden.version} (${report.golden.cases} кейсов), длительность ${duration(report)}.`);
  lines.push('');
  if (report.run) lines.push(...runSection(report.run, report.mode), '');
  lines.push(`Итого за прогон: **$${summary.totalCostUsd.toFixed(4)}** (триаж $${summary.triage.totalCostUsd.toFixed(4)}${summary.retest.map((s) => ` + ${label(s.strategy)} $${s.totalCostUsd.toFixed(4)}`).join('')}); вызовов модели ${summary.calls.n}, обрезано max_tokens (finish_reason=length) ${summary.calls.truncated}.`);
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
  lines.push(`| Латентность p50 / p95 | ${sec(summary.triage.latencyP50Ms)} / ${sec(summary.triage.latencyP95Ms)} с |`);
  lines.push(`| Стоимость триажа всего | $${summary.triage.totalCostUsd.toFixed(4)} |`);
  const rv = summary.triage.retrieval;
  lines.push(`| Поиск hit@1 / @3 / @6 (кейсов с gold.section: ${rv.n}) | ${rv.hitAt1}/${rv.n} · ${rv.hitAt3}/${rv.n} · ${rv.hitAt6}/${rv.n} = ${pct(ratio(rv.hitAt1, rv.n))} · ${pct(ratio(rv.hitAt3, rv.n))} · ${pct(ratio(rv.hitAt6, rv.n))} |`);
  lines.push(`| Переписываний запроса (rewrite ≤ 2) | ${summary.triage.rewrites.total} в ${summary.triage.rewrites.cases} кейсах |`);
  lines.push(`| Циклов faithfulness → bind (≤ 2) | ${summary.triage.bindLoops.total} в ${summary.triage.bindLoops.cases} кейсах |`);
  lines.push(`| Ответов, обрезанных max_tokens | ${truncatedText(summary.triage.calls)} |`);
  lines.push('');
  if (summary.calls.n) {
    lines.push('### Вызовы модели по шагам');
    lines.push('');
    lines.push('| Шаг | Модель | Вызовов | finish_reason=length | Ср. вход, ток. | Ср. выход, ток. | $ всего | p50 / p95, с |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const row of summary.calls.byNode) {
      lines.push(`| ${row.node} | ${row.models.join(', ')} | ${row.n} | ${row.truncated} | ${Math.round(row.avgInputTokens)} | ${Math.round(row.avgOutputTokens)} | $${row.costUsd.toFixed(4)} | ${sec(row.latencyP50Ms)} / ${sec(row.latencyP95Ms)} |`);
    }
    lines.push('');
  }
  lines.push('| Тип | N | Binding | Faithfulness |');
  lines.push('|---|---|---|---|');
  for (const row of summary.triage.byType) lines.push(`| ${row.type} | ${row.n} | ${row.bindingOk}/${row.n} | ${row.faithfulOk}/${row.n} |`);
  lines.push('');
  lines.push('| Кейс | Предложено | Цитаты | Binding | Faithfulness | $ | с | rewrite | bind-циклы | Поиск (место опоры) |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of report.triage) lines.push(triageRow(r));
  lines.push('');
  lines.push('## Ретест: A/B');
  lines.push('');
  lines.push('| Вариант | N | Quality | Ложных «исправлено» | Avg cost USD | Avg latency | Avg tokens | p50 / p95 | $ всего | С вызовом модели | Обрезано max_tokens |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of summary.retest) {
    lines.push(`| ${label(s.strategy)} | ${s.n} | ${s.ok}/${s.n} = **${pct(s.quality)}** | ${s.falseAddressed} | $${s.avgCostUsd.toFixed(4)} | ${(s.avgLatencyMs / 1000).toFixed(1)} с | ${Math.round(s.avgTokens)} | ${sec(s.latencyP50Ms)} / ${sec(s.latencyP95Ms)} с | $${s.totalCostUsd.toFixed(4)} | ${s.withModel}/${s.n} | ${truncatedText(s.calls)} |`);
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
  const retrieval = r.retrieval ? `${r.retrieval.section}: ${r.retrieval.rank ? `#${r.retrieval.rank}` : 'нет среди найденного'}` : '—';
  return `| \`${r.id}\` | ${r.proposedClass ?? '—'} | ${r.citedSections.join(', ') || '—'} | ${r.binding.ok ? '✓' : `✗ ${escape(notes)}`} | ${r.faithfulness.ok ? '✓' : '✗'} | ${r.usage.costUsd.toFixed(4)} | ${(r.usage.latencyMs / 1000).toFixed(1)} | ${r.rewriteCount ?? '—'} | ${r.bindLoops ?? '—'} | ${escape(retrieval)} |`;
}

/** Шапка «с чем сняты цифры»: коммит, модели, эффективные параметры, переключатели, хеши промптов. */
function runSection(run: RunMeta, mode: EvalReport['mode']): string[] {
  const p = run.llmParams;
  const d = DEFAULT_LLM_PARAMS;
  const mark = (changed: boolean) => (changed ? ' ⚑' : '');
  const short = (h: string | null) => (h ? `\`${h.slice(0, 12)}\`` : '—');
  const switches = Object.entries(run.switches);
  return [
    '## Прогон',
    '',
    '| Параметр | Значение |',
    '|---|---|',
    `| Коммит | ${run.gitSha ? `\`${run.gitSha}\`` : '— (не git)'}${run.gitDirty ? ' + незакоммиченные правки' : ''} |`,
    `| Модели OpenAI | fast \`${run.models.fast}\` (vision, rewrite, classify, explain, judge), strong \`${run.models.strong}\` (draft); эмбеддинги \`${run.models.embeddings}\`${mode === 'offline' ? ' — в офлайне модель не вызывается' : ''} |`,
    `| temperature | classify ${p.temperature.classify}${mark(p.temperature.classify !== d.temperature.classify)}, draft ${p.temperature.draft}${mark(p.temperature.draft !== d.temperature.draft)}; vision, rewrite, explain, judge — 0 |`,
    `| top_p | ${p.topP === null ? 'не передаётся (дефолт OpenAI = 1)' : `${p.topP} во всех вызовах ⚑`} |`,
    `| max_tokens | ${Object.entries(p.maxTokens).map(([node, v]) => `${node} ${v}${mark(v !== d.maxTokens[node as keyof typeof d.maxTokens])}`).join(' · ')} |`,
    `| Кадр в модель (detail) | ${p.imageDetail}${mark(p.imageDetail !== d.imageDetail)} |`,
    `| Skill в системном промпте | ${run.prompts.skillInjected ? 'да' : `нет${p.skillDisabled ? ' (SKILL_DISABLED) ⚑' : ' (SKILL.md не найден)'}`}; SKILL.md sha256 ${short(run.prompts.skillSha256)} |`,
    `| Vision (кадр замечания) | ${p.visionDisabled ? 'выключен (VISION_DISABLED): граф не смотрит кадр ⚑' : 'включён'} |`,
    `| Переключатели | ${switches.length ? switches.map(([k, v]) => `\`${k}=${v}\``).join(', ') : 'нет — поведение по умолчанию'} |`,
    `| sha256 системных промптов | ${Object.entries(run.prompts.systemSha256).map(([k, h]) => `${k} ${short(h)}`).join(' · ')} |`,
    `| sha256 шаблонов шагов | ${Object.entries(run.prompts.templateSha256).map(([k, h]) => `${k} ${short(h)}`).join(' · ')} |`,
    `| Режимы / стратегии ретеста | ${run.modes.join(', ')} / ${run.strategies.join(', ')}${run.only ? `; только ${run.only.join(', ')}` : ''} |`,
    `| Langfuse environment | ${run.langfuseEnvironment ?? '—'} |`,
    '',
    '⚑ — отличается от значения по умолчанию.',
  ];
}

function truncatedText(c: CallSummary): string {
  return c.n ? `${c.truncated}/${c.n} = ${pct(c.truncatedShare)}` : '— (модель не вызывалась)';
}

function sec(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
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
