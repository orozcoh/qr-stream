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

interface Equation {
  /** One bit per still-unsolved source block. */
  mask: bigint;
  /** Running XOR of the blocks this equation touches. */
  data: Uint8Array;
}

const bit = (index: number): bigint => 1n << BigInt(index);

function popcount(mask: bigint): number {
  let rest = mask;
  let count = 0;
  while (rest !== 0n) {
    rest &= rest - 1n;
    count += 1;
  }
  return count;
}

function singleBitIndex(mask: bigint): number {
  return mask.toString(2).length - 1;
}

function xorInto(target: Uint8Array, source: Uint8Array): void {
  for (let i = 0; i < target.length; i += 1) {
    target[i] = (target[i] as number) ^ (source[i] as number);
  }
}

/**
 * Rebuilds a payload from any sufficiently large set of symbols, in any order,
 * tolerating duplicates and gaps.
 *
 * Peeling handles the common case; when it stalls, Gaussian elimination over
 * GF(2) finishes the job. Masks are `bigint` so `k` can reach the 16-bit field
 * limit without a dependency.
 */
export class FountainDecoder {
  private readonly sourceCount: number;
  private readonly blockSize: number;
  private readonly sessionId: number;
  private readonly blocks: (Uint8Array | null)[];
  private pending: Equation[] = [];
  private readonly seen = new Set<number>();
  private solved = 0;

  constructor(k: number, blockSize: number, sessionId: number) {
    this.sourceCount = k;
    this.blockSize = blockSize;
    this.sessionId = sessionId;
    this.blocks = new Array<Uint8Array | null>(k).fill(null);
  }

  get solvedCount(): number {
    return this.solved;
  }

  get isComplete(): boolean {
    return this.solved === this.sourceCount;
  }

  add(symbolIdx: number, payload: Uint8Array): void {
    if (this.seen.has(symbolIdx)) return;
    this.seen.add(symbolIdx);
    if (payload.length !== this.blockSize) return;

    let mask = 0n;
    const data = payload.slice();
    for (const index of symbolIndices(this.sessionId, symbolIdx, this.sourceCount)) {
      const known = this.blocks[index];
      if (known === null || known === undefined) {
        mask |= bit(index);
      } else {
        // Blocks solved before this symbol arrived must come out of its payload,
        // or the reduced equation solves to the wrong value.
        xorInto(data, known);
      }
    }
    if (mask === 0n) return;

    this.pending.push({ mask, data });
    this.peel();
  }

  assemble(): Uint8Array | null {    if (!this.isComplete) return null;
    const out = new Uint8Array(this.sourceCount * this.blockSize);
    for (let i = 0; i < this.sourceCount; i += 1) {
      out.set(this.blocks[i] as Uint8Array, i * this.blockSize);
    }
    return out;
  }

  private solve(index: number, value: Uint8Array): void {
    if (this.blocks[index] !== null) return;
    this.blocks[index] = value;
    this.solved += 1;

    const solvedBit = bit(index);
    const kept: Equation[] = [];
    for (const equation of this.pending) {
      if ((equation.mask & solvedBit) !== 0n) {
        equation.mask ^= solvedBit;
        xorInto(equation.data, value);
      }
      if (equation.mask !== 0n) kept.push(equation);
    }
    this.pending = kept;
  }

  private peel(): void {
    for (;;) {
      if (this.isComplete) return;

      const single = this.pending.find((equation) => popcount(equation.mask) === 1);
      if (single !== undefined) {
        this.pending.splice(this.pending.indexOf(single), 1);
        this.solve(singleBitIndex(single.mask), single.data);
        continue;
      }

      if (!this.eliminate()) return;
    }
  }

  /** Reduced row echelon over GF(2). Returns whether anything was solved. */
  private eliminate(): boolean {
    const rows = this.pending;
    let rowStart = 0;

    for (let column = 0; column < this.sourceCount && rowStart < rows.length; column += 1) {
      const columnBit = bit(column);

      let pivot = -1;
      for (let r = rowStart; r < rows.length; r += 1) {
        if (((rows[r] as Equation).mask & columnBit) !== 0n) {
          pivot = r;
          break;
        }
      }
      if (pivot === -1) continue;

      const swap = rows[rowStart] as Equation;
      rows[rowStart] = rows[pivot] as Equation;
      rows[pivot] = swap;

      const pivotRow = rows[rowStart] as Equation;
      for (let r = 0; r < rows.length; r += 1) {
        if (r === rowStart) continue;
        const row = rows[r] as Equation;
        if ((row.mask & columnBit) !== 0n) {
          row.mask ^= pivotRow.mask;
          xorInto(row.data, pivotRow.data);
        }
      }

      rowStart += 1;
    }

    const resolved: Equation[] = [];
    for (let r = rows.length - 1; r >= 0; r -= 1) {
      const row = rows[r] as Equation;
      if (row.mask === 0n) {
        rows.splice(r, 1);
      } else if (popcount(row.mask) === 1) {
        resolved.push(row);
        rows.splice(r, 1);
      }
    }

    for (const row of resolved) this.solve(singleBitIndex(row.mask), row.data);
    return resolved.length > 0;
  }
}
