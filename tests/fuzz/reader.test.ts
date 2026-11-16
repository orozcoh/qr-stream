import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { QrStreamError } from '../../src/core/errors';
import { encodePacket } from '../../src/core/packet';
import { createQrStreamReader } from '../../src/core/reader';

fc.configureGlobal({ numRuns: Number(process.env.FUZZ_RUNS ?? 1000) });

const ADD_RESULTS = new Set(['accepted', 'duplicate', 'stale-session', 'invalid']);

async function capture(promise: Promise<unknown>): Promise<{ value?: unknown; error?: unknown }> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

describe('reader fuzz', () => {
  test('add never throws for arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        const reader = createQrStreamReader();
        expect(() => reader.add(bytes)).not.toThrow();
        expect(ADD_RESULTS.has(reader.add(bytes))).toBe(true);
      }),
    );
  });

  test('add never throws for a long stream of arbitrary frames', () => {
    fc.assert(
      fc.property(fc.array(fc.uint8Array({ maxLength: 256 }), { maxLength: 64 }), (frames) => {
        const reader = createQrStreamReader();
        for (const frame of frames) {
          expect(() => reader.add(frame)).not.toThrow();
          expect(ADD_RESULTS.has(reader.add(frame))).toBe(true);
          expect(reader.progress().solved).toBeGreaterThanOrEqual(0);
          expect(reader.progress().solved).toBeLessThanOrEqual(reader.progress().k);
        }
      }),
    );
  });

  test('result() is null before every source block has arrived', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 16 }), fc.integer({ min: 1, max: 64 }), async (k, blockSize) => {
        const reader = createQrStreamReader();
        const sessionId = 0xabc0_0001;
        for (let index = 0; index < k - 1; index += 1) {
          reader.add(
            encodePacket({
              version: 1,
              flags: 0,
              sessionId,
              symbolIdx: index,
              k,
              blockSize,
              payload: new Uint8Array(blockSize),
            }),
          );
        }
        expect(await reader.result()).toBeNull();
      }),
    );
  });

  test('a completed garbage stream rejects with a typed error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 0, max: 0xffff_ffff }),
        fc.integer({ min: 0, max: 3 }),
        fc.array(fc.uint8Array({ maxLength: 64 }), { minLength: 8, maxLength: 8 }),
        async (k, blockSize, sessionId, flags, chunks) => {
          const payload = new Uint8Array(k * blockSize);
          payload.set(Uint8Array.from(chunks.flatMap((chunk) => [...chunk])).subarray(0, payload.length));

          const reader = createQrStreamReader();
          for (let index = 0; index < k; index += 1) {
            reader.add(
              encodePacket({
                version: 1,
                flags,
                sessionId,
                symbolIdx: index,
                k,
                blockSize,
                payload,
              }),
            );
          }

          const outcome = await capture(reader.result('passphrase'));
          if (outcome.error !== undefined) {
            expect(outcome.error).toBeInstanceOf(QrStreamError);
          } else {
            // An all-zero or random payload is not a legal stream; returning
            // null is the only non-throwing outcome.
            expect(outcome.value).toBeNull();
          }
        },
      ),
    );
  });
});
