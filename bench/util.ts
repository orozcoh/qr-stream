import type { Bench } from 'tinybench';

/** Units a benchmark can report. Time units are always "lower is better". */
export type Unit = 'ms' | 'MiB' | 'KiB' | 'fps' | 'packets';

export interface BenchMetric {
  /** Stable key shared by results, budgets, and the baseline file. */
  id: string;
  group: 'writer' | 'fountain' | 'render' | 'reader';
  description: string;
  unit: Unit;
  /** Mean across samples. For constant metrics this is the only value. */
  value: number;
  p50: number;
  p99: number;
  /** Relative margin of error, percent. Zero for constant metrics. */
  rme: number;
  samples: number;
  /** True when the number is an estimate rather than a direct measurement. */
  approximate?: boolean;
}

export interface MetricSpec {
  id: string;
  group: BenchMetric['group'];
  description: string;
  unit: Unit;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

export function constantMetric(spec: MetricSpec, value: number, approximate = false): BenchMetric {
  const rounded = round(value);
  return {
    ...spec,
    value: rounded,
    p50: rounded,
    p99: rounded,
    rme: 0,
    samples: 1,
    ...(approximate ? { approximate: true } : {}),
  };
}

/**
 * Run a bench and convert every task's latency statistics into a metric.
 *
 * Task names double as metric ids so a budget cannot silently drift from the
 * measurement it names.
 */
export async function runAndCollect(bench: Bench, specs: MetricSpec[]): Promise<BenchMetric[]> {
  await bench.run();

  return specs.map((spec) => {
    const task = bench.getTask(spec.id);
    if (task === undefined) throw new Error(`bench task ${spec.id} is missing`);
    const result = task.result;
    if (result.state !== 'completed') {
      const detail = 'error' in result ? `: ${result.error.message}` : '';
      throw new Error(`bench task ${spec.id} ended in state ${result.state}${detail}`);
    }
    return {
      ...spec,
      value: round(result.latency.mean),
      p50: round(result.latency.p50),
      p99: round(result.latency.p99),
      rme: round(result.latency.rme, 2),
      samples: result.latency.samplesCount,
    };
  });
}

function formatValue(metric: BenchMetric, value: number): string {
  if (metric.unit === 'fps' || metric.unit === 'MiB' || metric.unit === 'KiB') return value.toFixed(2);
  if (metric.unit === 'packets') return value.toFixed(0);
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(3);
}

/** Plain-text table; keeps CI logs readable and avoids a table dependency. */
export function formatMetrics(metrics: BenchMetric[]): string {
  const header = ['metric', 'unit', 'mean', 'p50', 'p99', 'rme%', 'n'];
  const rows = metrics.map((metric) => [
    metric.id,
    metric.unit,
    formatValue(metric, metric.value),
    formatValue(metric, metric.p50),
    formatValue(metric, metric.p99),
    metric.rme.toFixed(1),
    String(metric.samples),
  ]);

  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] as string).length)),
  );
  const render = (row: string[]): string =>
    row
      .map((cell, column) => cell.padEnd(widths[column] as number))
      .join('  ')
      .trimEnd();

  return [render(header), render(widths.map((width) => '-'.repeat(width))), ...rows.map(render)].join('\n');
}
