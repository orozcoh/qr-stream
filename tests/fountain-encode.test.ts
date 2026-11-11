import { describe, expect, test } from 'vitest';
import { encodeSymbol } from '../src/core/fountain';
import { symbolIndices } from '../src/core/prng';

const makeBlocks = (k: number, size = 8): Uint8Array[] =>
  Array.from({ length: k }, (_, i) => new Uint8Array(size).fill((i + 1) & 0xff));

describe('encodeSymbol', () => {
  test('a source symbol copies its block', () => {
    const blocks = makeBlocks(5);
    const symbol = encodeSymbol(blocks, 7, 2);
    expect(Array.from(symbol)).toEqual(Array.from(blocks[2] as Uint8Array));

    symbol[0] = 0xff;
    expect((blocks[2] as Uint8Array)[0]).not.toBe(0xff);
  });

  test('a repair symbol is the XOR of its chosen blocks', () => {
    const blocks = makeBlocks(6, 4);
    const symbolIdx = 11;

    const expected = new Uint8Array(4);
    for (const index of symbolIndices(7, symbolIdx, 6)) {
      const block = blocks[index] as Uint8Array;
      for (let i = 0; i < 4; i += 1) expected[i] = (expected[i] ?? 0) ^ (block[i] ?? 0);
    }

    expect(Array.from(encodeSymbol(blocks, 7, symbolIdx))).toEqual(Array.from(expected));
  });

  test('every symbol has the block length', () => {
    const blocks = makeBlocks(10, 32);
    for (let symbolIdx = 0; symbolIdx < 40; symbolIdx += 1) {
      expect(encodeSymbol(blocks, 3, symbolIdx).length).toBe(32);
    }
  });

  test('a single-block stream can still emit repairs', () => {
    const blocks = makeBlocks(1, 4);
    expect(Array.from(encodeSymbol(blocks, 3, 99))).toEqual(Array.from(blocks[0] as Uint8Array));
  });

  test('does not mutate the source blocks', () => {
    const blocks = makeBlocks(4, 4);
    const snapshot = blocks.map((b) => Array.from(b));
    encodeSymbol(blocks, 5, 40);
    expect(blocks.map((b) => Array.from(b))).toEqual(snapshot);
  });
});
