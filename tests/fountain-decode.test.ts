import { describe, expect, test } from 'vitest';
import { encodeSymbol, FountainDecoder } from '../src/core/fountain';

/** Deterministic LCG so a failure reproduces. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeBlocks(k: number, size: number, seed: number): Uint8Array[] {
  const rand = lcg(seed);
  return Array.from({ length: k }, () =>
    Uint8Array.from({ length: size }, () => Math.floor(rand() * 256)),
  );
}

const concat = (blocks: Uint8Array[]): Uint8Array =>
  blocks.reduce((all, b) => new Uint8Array([...all, ...b]), new Uint8Array());

const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The sender loops forever, so the receiver keeps collecting until it has the
 * requested number of symbols. `erase` models which emissions are missed.
 */
function receive(
  blocks: Uint8Array[],
  sessionId: number,
  want: number,
  erase: (symbolIdx: number) => boolean,
): { symbolIdx: number; payload: Uint8Array }[] {
  const received: { symbolIdx: number; payload: Uint8Array }[] = [];
  for (let symbolIdx = 0; received.length < want && symbolIdx < want * 100; symbolIdx += 1) {
    if (erase(symbolIdx)) continue;
    received.push({ symbolIdx, payload: encodeSymbol(blocks, sessionId, symbolIdx) });
  }
  return received;
}

describe('FountainDecoder', () => {
  test('reconstructs after 30% random erasure across 1000 seeds', () => {
    let failures = 0;
    for (let seed = 0; seed < 1000; seed += 1) {
      const k = 30;
      const sessionId = 0x5000 + seed;
      const blocks = makeBlocks(k, 16, seed);
      const rand = lcg(seed);

      const received = receive(blocks, sessionId, Math.ceil(1.75 * k), () => rand() < 0.3);

      const decoder = new FountainDecoder(k, 16, sessionId);
      for (const symbol of received) decoder.add(symbol.symbolIdx, symbol.payload);
      if (!decoder.isComplete || !same(decoder.assemble() as Uint8Array, concat(blocks))) {
        failures += 1;
      }
    }
    expect(failures).toBeLessThanOrEqual(1);
  });

  test('reconstructs after a contiguous 30% erasure', () => {
    let failures = 0;
    for (let seed = 0; seed < 1000; seed += 1) {
      const k = 30;
      const sessionId = 0x9000 + seed;
      const blocks = makeBlocks(k, 16, seed);

      // A single unbroken run of 30 lost frames, the shape a specular hotspot
      // or a bad refresh alignment produces.
      const received = receive(blocks, sessionId, Math.ceil(1.75 * k), (index) => index >= 20 && index < 50);

      const decoder = new FountainDecoder(k, 16, sessionId);
      for (const symbol of received) decoder.add(symbol.symbolIdx, symbol.payload);
      if (!decoder.isComplete || !same(decoder.assemble() as Uint8Array, concat(blocks))) {
        failures += 1;
      }
    }
    expect(failures).toBeLessThanOrEqual(1);
  });

  test('works at the largest supported block count', () => {
    const k = 306;
    const sessionId = 0x1234;
    const blocks = makeBlocks(k, 8, 3);
    const rand = lcg(99);

    const received = receive(blocks, sessionId, Math.ceil(1.15 * k), () => rand() < 0.3);

    const decoder = new FountainDecoder(k, 8, sessionId);
    for (const symbol of received) decoder.add(symbol.symbolIdx, symbol.payload);
    expect(decoder.isComplete).toBe(true);
  });

  test('assembles the original bytes exactly', () => {
    const k = 12;
    const blocks = makeBlocks(k, 8, 7);
    const decoder = new FountainDecoder(k, 8, 42);
    for (let symbolIdx = 0; symbolIdx < k; symbolIdx += 1) {
      decoder.add(symbolIdx, encodeSymbol(blocks, 42, symbolIdx));
    }
    expect(decoder.isComplete).toBe(true);
    expect(same(decoder.assemble() as Uint8Array, concat(blocks))).toBe(true);
  });

  test('returns null from assemble while incomplete', () => {
    const blocks = makeBlocks(5, 4, 1);
    const decoder = new FountainDecoder(5, 4, 3);
    decoder.add(0, encodeSymbol(blocks, 3, 0));
    expect(decoder.assemble()).toBeNull();
    expect(decoder.solvedCount).toBe(1);
  });

  test('adding the same symbol twice is idempotent', () => {
    const k = 6;
    const blocks = makeBlocks(k, 4, 9);
    const decoder = new FountainDecoder(k, 4, 11);
    const payload = encodeSymbol(blocks, 11, 0);
    decoder.add(0, payload);
    decoder.add(0, payload);
    expect(decoder.solvedCount).toBe(1);
  });

  test('a single-block stream completes from symbol 0 alone', () => {
    const blocks = makeBlocks(1, 6, 2);
    const decoder = new FountainDecoder(1, 6, 77);
    decoder.add(0, encodeSymbol(blocks, 77, 0));
    expect(decoder.isComplete).toBe(true);
    expect(same(decoder.assemble() as Uint8Array, blocks[0] as Uint8Array)).toBe(true);
  });

  test('ignores payloads of the wrong length', () => {
    const blocks = makeBlocks(3, 4, 4);
    const decoder = new FountainDecoder(3, 4, 5);
    decoder.add(0, new Uint8Array(9));
    expect(decoder.solvedCount).toBe(0);
  });

  test('completes from repair symbols alone', () => {
    const k = 8;
    const blocks = makeBlocks(k, 4, 21);
    const decoder = new FountainDecoder(k, 4, 33);
    for (let symbolIdx = k; symbolIdx < k + 400 && !decoder.isComplete; symbolIdx += 1) {
      decoder.add(symbolIdx, encodeSymbol(blocks, 33, symbolIdx));
    }
    expect(decoder.isComplete).toBe(true);
  });
});
