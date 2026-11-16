import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { gunzip } from '../../src/core/compress';
import { QrStreamError } from '../../src/core/errors';
import { MAX_DECODED_BYTES } from '../../src/core/types';

fc.configureGlobal({ numRuns: Number(process.env.FUZZ_RUNS ?? 1000) });

const TYPED_CODES = new Set(['DECOMPRESSION_FAILED', 'DECODED_TOO_LARGE']);

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function capture(promise: Promise<unknown>): Promise<{ value?: unknown; error?: unknown }> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

describe('gunzip fuzz', () => {
  test('arbitrary bytes either decode within the cap or throw a typed error', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 1024 }), async (bytes) => {
        const limit = 4096;
        const outcome = await capture(gunzip(bytes, limit));
        if (outcome.error !== undefined) {
          expect(outcome.error).toBeInstanceOf(QrStreamError);
          expect(TYPED_CODES.has((outcome.error as QrStreamError).code)).toBe(true);
          return;
        }
        expect((outcome.value as Uint8Array).length).toBeLessThanOrEqual(limit);
      }),
    );
  });

  test('arbitrary valid gzip members round-trip within the cap', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 2048 }), async (bytes) => {
        const compressed = await gzipBytes(bytes);
        const decoded = await gunzip(compressed, Math.max(1, bytes.length));
        expect(decoded).toEqual(bytes);
      }),
    );
  });

  test('a gzip bomb is cancelled at the cap instead of being fully materialized', async () => {
    const expandedBytes = 4 * 1024 * 1024;
    const bomb = await gzipBytes(new Uint8Array(expandedBytes));
    const outcome = await capture(gunzip(bomb, 1024));

    expect(outcome.error).toBeInstanceOf(QrStreamError);
    const error = outcome.error as QrStreamError & { actual?: number; limit?: number; scope?: string };
    expect(error.code).toBe('DECODED_TOO_LARGE');
    expect(error.limit).toBe(1024);
    expect(error.scope).toBe('decoded');
    // The reader stops at the first chunk that crosses the cap; it never
    // allocates the full expanded payload.
    expect(error.actual).toBeLessThan(expandedBytes);
  });

  test('the default cap is MAX_DECODED_BYTES', async () => {
    const oversized = new Uint8Array(MAX_DECODED_BYTES + 1);
    const bomb = await gzipBytes(oversized);
    const outcome = await capture(gunzip(bomb));

    expect(outcome.error).toBeInstanceOf(QrStreamError);
    const error = outcome.error as QrStreamError & { limit?: number };
    expect(error.code).toBe('DECODED_TOO_LARGE');
    expect(error.limit).toBe(MAX_DECODED_BYTES);
  });
});
