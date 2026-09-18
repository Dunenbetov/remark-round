/**
 * `pnpm evals` — golden set через продуктовые сервисы, две метрики, A/B ретеста, leakage.
 *
 *   pnpm evals                       live с OPENAI_API_KEY (иначе offline автоматически), обе стратегии ретеста
 *   pnpm evals -- --offline          фейковые эмбеддинги + правила: как CI без ключа
 *   pnpm evals -- --only id1,id2     подмножество кейсов
 *   pnpm evals -- --modes triage     triage | retest | leakage через запятую
 *   pnpm evals -- --strategies diff_explain
 *   pnpm evals -- --out evals/results/name   без расширения: пишутся .md и .json
 *
 * Переключатели эксперимента — env (apps/api/src/llm/llm-params.ts): LLM_TEMP_CLASSIFY, LLM_TEMP_DRAFT, LLM_TOP_P,
 * LLM_MAX_TOKENS_DRAFT, LLM_IMAGE_DETAIL, SKILL_DISABLED=1, VISION_DISABLED=1, а также LLM_MODEL_FAST / LLM_MODEL_STRONG
 * и LLM_MODE=rules. Что было задано, пишется в шапку отчёта вместе с коммитом и хешами промптов.
 *
 * Код выхода ≠ 0, если провалился leakage, injection-кейс, где golden запрещает дефект, дал defect, faithfulness ниже
 * EVALS_MIN_FAITHFULNESS (по умолчанию 0.9) или binding ниже EVALS_MIN_BINDING (по умолчанию 0 — порог задаёт CI).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RetestStrategy } from '../agent/graph-state';
import { loadGolden, ROOT } from './golden';
import { summarize, toMarkdown } from './report';
import { runEvals } from './runner';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const offline = process.argv.includes('--offline') || process.env['EVALS_OFFLINE'] === '1';
  const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const modes = arg('modes')?.split(',') as Array<'triage' | 'retest' | 'leakage'> | undefined;
  const strategies = arg('strategies')?.split(',') as RetestStrategy[] | undefined;
  const report = await runEvals({ offline, only, modes, strategies, log: (line) => console.log(line) });
  const summary = summarize(report);
  const markdown = toMarkdown(report, summary);

  const stamp = report.startedAt.slice(0, 16).replace(/[:T]/g, '-');
  const out = resolve(ROOT, arg('out') ?? `evals/results/${stamp}-${report.mode}`);
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(`${out}.md`, markdown);
  writeFileSync(`${out}.json`, JSON.stringify({ report, summary }, null, 2));

  console.log('');
  console.log(markdown.split('\n## Триаж')[0]);
  const run = report.run;
  console.log(`Коммит ${run.gitSha ?? '—'}${run.gitDirty ? ' (+правки)' : ''}; переключатели: ${Object.entries(run.switches).map(([k, v]) => `${k}=${v}`).join(', ') || 'нет'}`);
  const t = summary.triage;
  console.log(`Триаж: binding ${t.bindingOk}/${t.n}, faithfulness ${t.faithfulOk}/${t.n}, ошибок ${t.errors}, $${t.avgCostUsd.toFixed(4)} / ${(t.avgLatencyMs / 1000).toFixed(1)} с на замечание (p50 ${(t.latencyP50Ms / 1000).toFixed(1)}, p95 ${(t.latencyP95Ms / 1000).toFixed(1)} с)`);
  console.log(`Поиск hit@1/3/6: ${t.retrieval.hitAt1}/${t.retrieval.hitAt3}/${t.retrieval.hitAt6} из ${t.retrieval.n}; rewrite ${t.rewrites.total} (в ${t.rewrites.cases} кейсах), bind-циклов ${t.bindLoops.total} (в ${t.bindLoops.cases})`);
  for (const s of summary.retest) console.log(`Ретест ${s.strategy}: ${s.ok}/${s.n}, ложных «исправлено» ${s.falseAddressed}, $${s.avgCostUsd.toFixed(4)} / ${(s.avgLatencyMs / 1000).toFixed(1)} с`);
  console.log(`Итого $${summary.totalCostUsd.toFixed(4)}; вызовов модели ${summary.calls.n}, обрезано max_tokens ${summary.calls.truncated}`);
  if (summary.winner) console.log(`Победитель A/B: ${summary.winner}`);
  console.log(`Leakage: ${summary.leakageOk ? 'ok' : 'ПРОВАЛ'}`);
  console.log(`Отчёт: ${out}.md`);

  const minFaithfulness = Number(process.env['EVALS_MIN_FAITHFULNESS'] ?? '0.9');
  const minBinding = Number(process.env['EVALS_MIN_BINDING'] ?? '0');
  // Injection не даёт дефекта там, где golden его запрещает (mustNot). Кейс «настоящий дефект + команда в тексте»
  // дефектом быть обязан: для него injection проверяют faithfulness и mustNotMatch, а не запрет класса.
  const forbidsDefect = new Set(loadGolden().cases.filter((c) => c.mode === 'triage' && c.gold.mustNot?.includes('defect_candidate')).map((c) => c.id));
  const injectionDefect = report.triage.filter((r) => r.id.startsWith('injection-') && forbidsDefect.has(r.id) && r.proposedClass === 'defect_candidate');
  const failures: string[] = [];
  if (!summary.leakageOk) failures.push('leakage');
  if (injectionDefect.length) failures.push(`injection → defect: ${injectionDefect.map((r) => r.id).join(', ')}`);
  if (summary.triage.n && summary.triage.faithfulness < minFaithfulness) failures.push(`faithfulness ${summary.triage.faithfulness.toFixed(2)} < ${minFaithfulness}`);
  if (summary.triage.n && summary.triage.bindingQuality < minBinding) failures.push(`binding ${summary.triage.bindingQuality.toFixed(2)} < ${minBinding}`);
  if (failures.length) {
    console.error(`evals: провал — ${failures.join('; ')}`);
    process.exitCode = 1;
  }
}

main().catch((e: Error) => {
  console.error(e);
  process.exitCode = 1;
});
