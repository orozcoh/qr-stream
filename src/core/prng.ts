/**
 * splitmix32 — deterministic 32-bit PRNG using integer ops only.
 *
 * Sender and receiver must derive identical symbol sets without transmitting
 * them, so this may never use floating point.
 */
export function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/**
 * Which source blocks a symbol covers.
 *
 * Symbols below `k` are systematic: they carry one raw block. Symbols from `k`
 * up are repairs, covering a pseudorandom subset derived from
 * `(sessionId, symbolIdx)`, so the subset never travels over the wire.
 *
 * Degree is uniform over `1..k`. This was measured, not assumed: a sparse
 * degree distribution (50% singletons, flat tail) failed 14% of 30-block
 * transfers at 1.5x symbols, because half the repairs were duplicates that add
 * no rank. Dense subsets cost peeling efficiency — the decoder falls through
 * to Gaussian elimination — but `k` is at most a few hundred here, so that
 * elimination is cheap and the transfer completes.
 */
export function symbolIndices(sessionId: number, symbolIdx: number, k: number): number[] {
  if (symbolIdx < k) return [symbolIdx];
  if (k <= 1) return [0];

  const rand = splitmix32((sessionId ^ symbolIdx) >>> 0);
  const degree = 1 + (rand() % k);

  const chosen: number[] = [];
  const taken = new Set<number>();
  while (chosen.length < degree) {
    const candidate = rand() % k;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    chosen.push(candidate);
  }

  return chosen.sort((a, b) => a - b);
}
