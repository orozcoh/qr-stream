import { readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFountainBench } from './fountain.bench.js';
import { gcAvailable } from './memory.js';
import { runReaderBench } from './reader.bench.js';
import { runRenderBench } from './render.bench.js';
import { formatMetrics, type BenchMetric, type Unit } from './util.js';
import { runWriterBench } from './writer.bench.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(HERE, 'results.json');
const BASELINE_PATH = join(HERE, 'baseline.json');
const BUDGETS_PATH = join(HERE, 'budgets.json');

/** Local guardrail: a run more than this much slower than the baseline is a regression. */
const REGRESSION_PERCENT = 20;

type Mode = 'run' | 'check' | 'compare' | 'baseline';

interface Report {
  schema: 1;
  generatedAt: string;
  runtime: {
    node: string;
    platform: string;
    arch: string;
    release: string;
  };
  environment: {
    cpu: string;
    cores: number;
    totalMemoryMiB: number;
    forcedGc: boolean;
  };
  metrics: BenchMetric[];
}

interface BudgetEntry {
  unit: Unit;
  /** Absolute ceiling; a measurement above this fails `bench:check`. */
  max?: number;
  /** Absolute floor for metrics where higher is better (fps). */
  min?: number;
  note?: string;
}

interface BudgetFile {
  schema: 1;
  rationale: string;
  metrics: Record<string, BudgetEntry>;
}

function machineReport(metrics: BenchMetric[]): Report {
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      release: release(),
    },
    environment: {
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      totalMemoryMiB: Math.round(totalmem() / (1024 * 1024)),
      forcedGc: gcAvailable(),
    },
    metrics,
  };
}

function parseMode(argv: string[]): Mode {
  const flags = argv.filter((argument) => argument.startsWith('-'));
  if (flags.length === 0) return 'run';
  if (flags.length === 1) {
    if (flags[0] === '--check') return 'check';
    if (flags[0] === '--compare') return 'compare';
    if (flags[0] === '--baseline') return 'baseline';
  }
  throw new Error(`unknown arguments: ${flags.join(' ') || argv.join(' ')}`);
}

function writeReport(path: string, report: Report): void {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function checkBudgets(metrics: BenchMetric[]): string[] {
  const budgets = loadJson<BudgetFile>(BUDGETS_PATH);
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  const problems: string[] = [];

  for (const [id, budget] of Object.entries(budgets.metrics)) {
    const metric = byId.get(id);
    if (metric === undefined) {
      problems.push(`${id}: budgeted but not measured`);
      continue;
    }
    if (metric.unit !== budget.unit) {
      problems.push(`${id}: budget unit ${budget.unit} does not match measured unit ${metric.unit}`);
      continue;
    }
    if (budget.max !== undefined && metric.value > budget.max) {
      problems.push(`${id}: ${metric.value} ${metric.unit} exceeds max ${budget.max} ${budget.unit}`);
    }
    if (budget.min !== undefined && metric.value < budget.min) {
      problems.push(`${id}: ${metric.value} ${metric.unit} is below min ${budget.min} ${budget.unit}`);
    }
  }

  const budgeted = new Set(Object.keys(budgets.metrics));
  for (const metric of metrics) {
    if (!budgeted.has(metric.id)) console.warn(`warning: ${metric.id} has no budget entry`);
  }

  return problems;
}

/** Units where a higher number is better; excluded from the lower-is-worse compare. */
const HIGHER_IS_BETTER: ReadonlySet<Unit> = new Set(['fps']);
/** Units where the 20% guardrail is meaningful; memory is too noisy to police. */
const GUARDRAIL_UNITS: ReadonlySet<Unit> = new Set(['ms']);

function compareToBaseline(metrics: BenchMetric[]): string[] {
  const baseline = loadJson<Report>(BASELINE_PATH);
  const baseById = new Map(baseline.metrics.map((metric) => [metric.id, metric]));
  const regressions: string[] = [];

  const header = ['metric', 'baseline', 'current', 'delta%', 'status'];
  const rows: string[][] = [];

  for (const metric of metrics) {
    const base = baseById.get(metric.id);
    if (base === undefined || base.value === 0) continue;
    const delta = ((metric.value - base.value) / base.value) * 100;
    const guarded = GUARDRAIL_UNITS.has(metric.unit) && !HIGHER_IS_BETTER.has(metric.unit);
    const regressed = guarded && delta > REGRESSION_PERCENT;
    if (regressed) regressions.push(`${metric.id}: +${delta.toFixed(1)}%`);
    rows.push([
      metric.id,
      base.value.toFixed(3),
      metric.value.toFixed(3),
      `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`,
      !guarded ? 'info' : regressed ? 'REGRESSED' : 'ok',
    ]);
  }

  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] as string).length)),
  );
  const render = (row: string[]): string =>
    row
      .map((cell, column) => cell.padEnd(widths[column] as number))
      .join('  ')
      .trimEnd();

  console.log(`\nBaseline from ${baseline.generatedAt} (${baseline.runtime.node}, ${baseline.environment.cpu})`);
  console.log([render(header), render(widths.map((width) => '-'.repeat(width))), ...rows.map(render)].join('\n'));

  return regressions;
}

function printUsage(): void {
  console.log(`Usage: tsx bench/run.ts [mode]

  (no mode)   run every benchmark and write bench/results.json
  --check     run, then enforce bench/budgets.json (CI)
  --compare   run, then compare with bench/baseline.json (local 20% guardrail)
  --baseline  run, then replace bench/baseline.json`);
}

async function main(): Promise<void> {
  let mode: Mode;
  try {
    mode = parseMode(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exitCode = 1;
    return;
  }

  const started = performance.now();
  const metrics: BenchMetric[] = [];
  const groups = [
    ['Writer', runWriterBench],
    ['Fountain', runFountainBench],
    ['Render', runRenderBench],
    ['Reader', runReaderBench],
  ] as const;

  for (const [name, run] of groups) {
    const groupStart = performance.now();
    const groupMetrics = await run();
    const groupSeconds = ((performance.now() - groupStart) / 1000).toFixed(1);
    console.log(`\n${name} (${groupSeconds}s)`);
    console.log(formatMetrics(groupMetrics));
    metrics.push(...groupMetrics);
  }

  const report = machineReport(metrics);
  writeReport(RESULTS_PATH, report);
  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `\n${metrics.length} metrics in ${elapsed}s on ${report.environment.cpu} ` +
      `(${report.runtime.node}, ${report.environment.cores} cores)` +
      (report.environment.forcedGc ? '' : ' — no --expose-gc, memory numbers are upper bounds'),
  );
  console.log(`Wrote ${RESULTS_PATH}`);

  if (mode === 'baseline') {
    writeReport(BASELINE_PATH, report);
    console.log(`Wrote ${BASELINE_PATH}`);
  }

  if (mode === 'compare') {
    let regressions: string[];
    try {
      regressions = compareToBaseline(metrics);
    } catch (error) {
      console.error(
        `\nCould not compare: ${error instanceof Error ? error.message : String(error)}. ` +
          'Run `pnpm bench:baseline` to record a baseline.',
      );
      process.exitCode = 1;
      return;
    }
    if (regressions.length > 0) {
      console.error(`\n${regressions.length} regression(s) over ${REGRESSION_PERCENT}%: ${regressions.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log(`\nNo time metric regressed more than ${REGRESSION_PERCENT}%.`);
    }
  }

  if (mode === 'check') {
    let problems: string[];
    try {
      problems = checkBudgets(metrics);
    } catch (error) {
      console.error(
        `\nCould not check budgets: ${error instanceof Error ? error.message : String(error)}. ` +
          'Expected bench/budgets.json next to this script.',
      );
      process.exitCode = 1;
      return;
    }
    if (problems.length > 0) {
      console.error(`\nBudget check failed with ${problems.length} problem(s):`);
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
    } else {
      const budgets = loadJson<BudgetFile>(BUDGETS_PATH);
      console.log(`\nBudget check passed: ${Object.keys(budgets.metrics).length} ceilings/floor(s), 0 misses.`);
    }
  }
}

await main();
