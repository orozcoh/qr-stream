import { describe, expect, test } from 'vitest';
import { crc32 } from '../src/core/crc32';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('crc32', () => {
  test('matches the standard check vector', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
  });

  test('empty input is zero', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  test('seeded chaining equals one-shot over concatenation', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const whole = new Uint8Array([...a, ...b]);
    expect(crc32(b, crc32(a))).toBe(crc32(whole));
  });

  test('detects a single flipped bit', () => {
    const original = utf8('the quick brown fox');
    const flipped = new Uint8Array(original);
    flipped[4] = (flipped[4] ?? 0) ^ 0x01;
    expect(crc32(flipped)).not.toBe(crc32(original));
  });

  test('returns an unsigned 32-bit integer', () => {
    const value = crc32(utf8('unsigned'));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(value)).toBe(true);
  });
});
