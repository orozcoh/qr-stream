import { describe, expect, test } from 'vitest';
import { splitmix32, symbolIndices } from '../src/core/prng';

describe('splitmix32', () => {
  test('is deterministic for a seed', () => {
    const a = splitmix32(42);
    const b = splitmix32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test('differs between seeds', () => {
    expect(splitmix32(1)()).not.toBe(splitmix32(2)());
  });

  test('stays inside uint32', () => {
    const rand = splitmix32(0);
    for (let i = 0; i < 1000; i += 1) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('symbolIndices', () => {
  test('a source symbol is a singleton', () => {
    expect(symbolIndices(7, 0, 10)).toEqual([0]);
    expect(symbolIndices(7, 9, 10)).toEqual([9]);
  });

  test('repair symbols reference existing blocks only', () => {
    for (let symbolIdx = 10; symbolIdx < 500; symbolIdx += 1) {
      const indices = symbolIndices(0x1234, symbolIdx, 10);
      expect(indices.length).toBeGreaterThanOrEqual(1);
      expect([...indices].sort((a, b) => a - b)).toEqual(indices);
      expect(new Set(indices).size).toBe(indices.length);
      for (const index of indices) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(10);
      }
    }
  });

  test('is deterministic across calls', () => {
    expect(symbolIndices(99, 4242, 200)).toEqual(symbolIndices(99, 4242, 200));
  });

  test('depends on the session id', () => {
    expect(symbolIndices(1, 500, 200)).not.toEqual(symbolIndices(2, 500, 200));
  });

  test('degree 1 occurs about half the time', () => {
    const trials = 10000;
    let singles = 0;
    for (let symbolIdx = 100; symbolIdx < 100 + trials; symbolIdx += 1) {
      if (symbolIndices(0xabcd, symbolIdx, 100).length === 1) singles += 1;
    }
    const fraction = singles / trials;
    expect(fraction).toBeGreaterThanOrEqual(0.48);
    expect(fraction).toBeLessThanOrEqual(0.52);
  });

  test('never exceeds k distinct indices', () => {
    for (let symbolIdx = 1; symbolIdx < 200; symbolIdx += 1) {
      expect(symbolIndices(5, symbolIdx, 1)).toEqual([0]);
      expect(symbolIndices(5, symbolIdx, 3).length).toBeLessThanOrEqual(3);
    }
  });
});
