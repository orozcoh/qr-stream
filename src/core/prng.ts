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

const MAX_DEGREE = 20;

/**
 * Which source blocks a symbol covers.
 *
 * Symbols below `k` are systematic: they carry one raw block. Symbols from `k`
 * up are repairs, covering a pseudorandom subset derived from
 * `(sessionId, symbolIdx)`, so the subset never travels over the wire.
 *
 * Degrees follow `P(1) = 0.5`, the rest spread over `2..min(k, 20)`.
 */
export function symbolIndices(sessionId: number, symbolIdx: number, k: number): number[] {
  if (symbolIdx < k) return [symbolIdx];
  if (k <= 1) return [0];

  const rand = splitmix32((sessionId ^ symbolIdx) >>> 0);
  const maxDegree = Math.min(k, MAX_DEGREE);
  const degree = rand() % 2 === 0 ? 1 : 2 + (rand() % Math.max(1, maxDegree - 1));
  const wanted = Math.min(degree, k);

  const chosen: number[] = [];
  const taken = new Set<number>();
  while (chosen.length < wanted) {
    const candidate = rand() % k;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    chosen.push(candidate);
  }

  return chosen.sort((a, b) => a - b);
}
