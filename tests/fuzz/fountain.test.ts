import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { FountainDecoder, encodeSymbol } from '../../src/core/fountain';

fc.configureGlobal({ numRuns: Number(process.env.FUZZ_RUNS ?? 1000) });

interface Scenario {
  k: number;
  blockSize: number;
  sessionId: number;
  frames: Array<{ symbolIdx: number; payload: Uint8Array }>;
}

const scenario: fc.Arbitrary<Scenario> = fc
  .tuple(fc.integer({ min: 1, max: 32 }), fc.integer({ min: 1, max: 64 }), fc.integer({ min: 0, max: 0xffff_ffff }))
  .chain(([k, blockSize, sessionId]) =>
    fc.record({
      k: fc.constant(k),
      blockSize: fc.constant(blockSize),
      sessionId: fc.constant(sessionId),
      frames: fc.array(
        fc.record({
          symbolIdx: fc.integer({ min: 0, max: 0xffff }),
          payload: fc.uint8Array({ minLength: blockSize, maxLength: blockSize }),
        }),
        { maxLength: Math.max(1, k * 3) },
      ),
    }),
  );

describe('fountain decoder fuzz', () => {
  test('add stays in bounds and assemble is null until complete', () => {
    fc.assert(
      fc.property(scenario, ({ k, blockSize, sessionId, frames }) => {
        const decoder = new FountainDecoder(k, blockSize, sessionId);

        for (const frame of frames) {
          expect(() => decoder.add(frame.symbolIdx, frame.payload)).not.toThrow();
          expect(decoder.solvedCount).toBeGreaterThanOrEqual(0);
          expect(decoder.solvedCount).toBeLessThanOrEqual(k);
          if (!decoder.isComplete) expect(decoder.assemble()).toBeNull();
        }

        expect(decoder.solvedCount).toBeLessThanOrEqual(k);
        if (decoder.isComplete) {
          const assembled = decoder.assemble();
          expect(assembled).not.toBeNull();
          expect(assembled?.length).toBe(k * blockSize);
        } else {
          expect(decoder.assemble()).toBeNull();
        }
      }),
    );
  });

  test('wrong-length payloads never throw or count as progress', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 0, max: 0xffff_ffff }),
        fc.array(fc.uint8Array({ maxLength: 128 }), { maxLength: 32 }),
        (k, blockSize, sessionId, payloads) => {
          const decoder = new FountainDecoder(k, blockSize, sessionId);
          for (const payload of payloads) {
            if (payload.length === blockSize) continue;
            const before = decoder.solvedCount;
            expect(() => decoder.add(0, payload)).not.toThrow();
            expect(decoder.solvedCount).toBe(before);
          }
        },
      ),
    );
  });

  test('systematic symbols reconstruct the blocks in order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 0, max: 0xffff_ffff }),
        (k, blockSize, sessionId) => {
          const blocks = Array.from({ length: k }, (_, index) =>
            Uint8Array.from({ length: blockSize }, (_, offset) => (index * 31 + offset) & 0xff),
          );
          const decoder = new FountainDecoder(k, blockSize, sessionId);
          for (let index = 0; index < k; index += 1) {
            decoder.add(index, blocks[index] as Uint8Array);
            expect(decoder.solvedCount).toBe(index + 1);
          }
          expect(decoder.isComplete).toBe(true);
          expect(decoder.assemble()).toEqual(Uint8Array.from(blocks.flatMap((block) => [...block])));
        },
      ),
    );
  });

  test('repair symbols complete a stream missing source symbols', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 16 }),
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 0, max: 0xffff_ffff }),
        (k, blockSize, sessionId) => {
          const blocks = Array.from({ length: k }, (_, index) =>
            Uint8Array.from({ length: blockSize }, (_, offset) => (index * 37 + offset) & 0xff),
          );
          const decoder = new FountainDecoder(k, blockSize, sessionId);

          // Publish only the even source blocks, then repair symbols until the
          // decoder has enough independent equations for the rest.
          for (let index = 0; index < k; index += 2) {
            decoder.add(index, blocks[index] as Uint8Array);
          }
          for (let index = k; !decoder.isComplete && index < k + 4 * k + 32; index += 1) {
            decoder.add(index, encodeSymbol(blocks, sessionId, index));
          }

          expect(decoder.isComplete).toBe(true);
          expect(decoder.assemble()).toEqual(Uint8Array.from(blocks.flatMap((block) => [...block])));
        },
      ),
    );
  });
});
