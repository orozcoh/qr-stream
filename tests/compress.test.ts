import { describe, expect, test } from 'vitest';
import { gunzip, gzipIfSmaller } from '../src/core/compress';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('gzipIfSmaller', () => {
  test('compresses repetitive JSON and round-trips', async () => {
    const input = utf8('{"a":1},'.repeat(250));
    const result = await gzipIfSmaller(input);
    expect(result.gzipped).toBe(true);
    expect(result.data.length).toBeLessThan(input.length);
    expect(Array.from(await gunzip(result.data))).toEqual(Array.from(input));
  });

  test('leaves incompressible data alone', async () => {
    const input = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff);
    const result = await gzipIfSmaller(input);
    if (!result.gzipped) {
      expect(Array.from(result.data)).toEqual(Array.from(input));
    } else {
      expect(result.data.length).toBeLessThan(input.length);
    }
  });

  test('handles an empty payload', async () => {
    const result = await gzipIfSmaller(new Uint8Array(0));
    expect(result.gzipped).toBe(false);
    expect(result.data.length).toBe(0);
    expect(Array.from(await gunzip(result.data))).toEqual([]);
  });

  test('gunzip rejects data that is not gzip', async () => {
    await expect(gunzip(utf8('not gzip at all'))).rejects.toBeTruthy();
  });
});
