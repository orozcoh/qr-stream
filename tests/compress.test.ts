import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { gunzip, gzipIfSmaller } from '../src/core/compress';
import { PayloadTooLargeError } from '../src/core/errors';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

afterEach(() => {
  vi.unstubAllGlobals();
});

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
  });

  test('gunzip rejects data that is not gzip', async () => {
    await expect(gunzip(utf8('not gzip at all'))).rejects.toMatchObject({
      code: 'DECOMPRESSION_FAILED',
      recovery: 'rescan',
    });
  });

  test('aborts a decompression bomb at the output budget', async () => {
    const zeros = new Uint8Array(2 * 1024 * 1024);
    const bomb = new Uint8Array(gzipSync(zeros));
    const rejected = gunzip(bomb, 1024 * 1024);
    await expect(rejected).rejects.toBeInstanceOf(PayloadTooLargeError);
    await expect(rejected).rejects.toMatchObject({ code: 'DECODED_TOO_LARGE', recovery: 'none' });
  });

  test('accepts a member exactly at the output budget', async () => {
    const zeros = new Uint8Array(1024 * 1024);
    const member = new Uint8Array(gzipSync(zeros));
    const out = await gunzip(member, 1024 * 1024);
    expect(out.length).toBe(zeros.length);
  });

  test('compression reports an unsupported runtime', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    await expect(gzipIfSmaller(utf8('x'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_RUNTIME',
      recovery: 'upgrade-browser',
    });
  });

  test('decompression reports an unsupported runtime', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(gunzip(utf8('x'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_RUNTIME',
      recovery: 'upgrade-browser',
    });
  });
});
