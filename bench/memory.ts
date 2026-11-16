/**
 * Approximate retained-memory measurement.
 *
 * `process.memoryUsage().heapUsed` alone misses typed-array backing stores,
 * which is where nearly all of a 1 MiB transfer lives, so this sums
 * `heapUsed` and `arrayBuffers`. The delta is taken around one full operation
 * with a forced GC on either side when `--expose-gc` is available.
 *
 * This is deliberately coarse. V8 may defer reclaiming a transient buffer, and
 * the measurement includes compression temporaries that a steady-state writer
 * does not keep. The numbers are useful as a leak/runaway guard with generous
 * ceilings, never as an exact memory profile.
 */
const MIB = 1024 * 1024;

function collect(): void {
  (globalThis as { gc?: () => void }).gc?.();
}

export function gcAvailable(): boolean {
  return typeof (globalThis as { gc?: () => void }).gc === 'function';
}

/** Force a collection when the runner was started with `--expose-gc`. */
export function forceGc(): void {
  collect();
}

function usedBytes(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.arrayBuffers;
}

function bestEstimate(samples: number[]): number {
  // Transient compression buffers are not always reclaimed inside the timed
  // window, so every sample is an overestimate. The minimum is the closest
  // approximation of what the writer actually retains; a real leak raises
  // every sample and still trips the ceiling.
  const positive = samples.filter((sample) => sample > 0);
  return positive.length === 0 ? 0 : Math.min(...positive);
}

/**
 * Keep the value returned by `run` alive while measuring, so the footprint of
 * a writer (payload, blocks, metadata) is counted rather than collected first.
 */
export async function measureArrayBufferMibAsync(run: () => Promise<unknown>, rounds = 5): Promise<number> {
  const samples: number[] = [];
  let retained: unknown;

  for (let round = 0; round < rounds; round += 1) {
    retained = undefined;
    collect();
    const before = usedBytes();
    retained = await run();
    collect();
    const after = usedBytes();
    samples.push((after - before) / MIB);
  }

  void retained;
  return bestEstimate(samples);
}
