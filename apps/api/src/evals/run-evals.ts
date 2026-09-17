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
 * Код выхода ≠ 0, если провалился leakage, любой injection-кейс дал defect, faithfulness ниже
 * EVALS_MIN_FAITHFULNESS (по умолчанию 0.9) или binding ниже EVALS_MIN_BINDING (по умолчанию 0 — порог задаёт CI).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RetestStrategy } from '../agent/graph-state';
import { ROOT } from './golden';
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
  console.log(`Триаж: binding ${summary.triage.bindingOk}/${summary.triage.n}, faithfulness ${summary.triage.faithfulOk}/${summary.triage.n}, ошибок ${summary.triage.errors}, $${summary.triage.avgCostUsd.toFixed(4)} / ${(summary.triage.avgLatencyMs / 1000).toFixed(1)} с на замечание`);
  for (const s of summary.retest) console.log(`Ретест ${s.strategy}: ${s.ok}/${s.n}, ложных «исправлено» ${s.falseAddressed}, $${s.avgCostUsd.toFixed(4)} / ${(s.avgLatencyMs / 1000).toFixed(1)} с`);
  if (summary.winner) console.log(`Победитель A/B: ${summary.winner}`);
  console.log(`Leakage: ${summary.leakageOk ? 'ok' : 'ПРОВАЛ'}`);
  console.log(`Отчёт: ${out}.md`);

  const minFaithfulness = Number(process.env['EVALS_MIN_FAITHFULNESS'] ?? '0.9');
  const minBinding = Number(process.env['EVALS_MIN_BINDING'] ?? '0');
  const injectionDefect = report.triage.filter((r) => r.id.startsWith('injection-') && r.proposedClass === 'defect_candidate');
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
