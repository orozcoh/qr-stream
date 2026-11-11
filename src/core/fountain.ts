import { symbolIndices } from './prng';

/**
 * Produce the payload for one symbol.
 *
 * Symbols below `k` are systematic — a copy of the raw block. Symbols from `k`
 * up are repairs: the XOR of the blocks `symbolIndices` selects. Every result
 * is the same length, so repairs can be combined without bookkeeping.
 */
export function encodeSymbol(blocks: Uint8Array[], sessionId: number, symbolIdx: number): Uint8Array {
  const k = blocks.length;
  if (symbolIdx < k) {
    return (blocks[symbolIdx] as Uint8Array).slice();
  }

  const size = blocks[0]?.length ?? 0;
  const out = new Uint8Array(size);
  for (const index of symbolIndices(sessionId, symbolIdx, k)) {
    const block = blocks[index] as Uint8Array;
    for (let i = 0; i < size; i += 1) {
      out[i] = (out[i] as number) ^ (block[i] as number);
    }
  }
  return out;
}
