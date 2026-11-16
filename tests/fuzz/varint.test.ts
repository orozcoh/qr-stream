import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { QrStreamError } from '../../src/core/errors';
import { readVarint, writeVarint } from '../../src/core/meta';

fc.configureGlobal({ numRuns: Number(process.env.FUZZ_RUNS ?? 1000) });

function expectInvalidMetadata(read: () => unknown): void {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(QrStreamError);
    expect((error as QrStreamError).code).toBe('INVALID_METADATA');
    return;
  }
  throw new Error('expected readVarint to reject');
}

describe('varint fuzz', () => {
  test('terminates on arbitrary bytes and every offset', () => {
    fc.assert(
      fc.property(
        fc
          .uint8Array({ maxLength: 64 })
          .chain((bytes) => fc.tuple(fc.constant(bytes), fc.integer({ min: 0, max: bytes.length + 1 }))),
        ([bytes, offset]) => {
          try {
            const { value, next } = readVarint(bytes, offset);
            expect(next).toBeGreaterThan(offset);
            expect(next).toBeLessThanOrEqual(bytes.length);
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          } catch (error) {
            expect(error).toBeInstanceOf(QrStreamError);
            expect(['truncated varint', 'non-canonical varint', 'varint too large']).toContain(
              (error as QrStreamError).message,
            );
          }
        },
      ),
    );
  });

  test('round-trips canonical values in the supported range', () => {
    fc.assert(
      fc.property(fc.nat({ max: Number.MAX_SAFE_INTEGER }), (value) => {
        const encoded = writeVarint(value);
        const decoded = readVarint(encoded, 0);
        expect(decoded.value).toBe(value);
        expect(decoded.next).toBe(encoded.length);
      }),
    );
  });

  test('rejects a truncated varint', () => {
    expectInvalidMetadata(() => readVarint(new Uint8Array([0x80]), 0));
    expectInvalidMetadata(() => readVarint(new Uint8Array([]), 0));
  });

  test('rejects a non-canonical varint', () => {
    expectInvalidMetadata(() => readVarint(new Uint8Array([0x81, 0x00]), 0));
    expectInvalidMetadata(() => readVarint(new Uint8Array([0xff, 0x80, 0x00]), 0));
  });

  test('rejects an oversized varint', () => {
    // Eight continuation bytes push the shift past 2^49 with no terminator in
    // sight, so the parser must stop instead of accumulating forever.
    expectInvalidMetadata(() => readVarint(new Uint8Array(8).fill(0x80), 0));
  });

  test('a truncated varint after a valid prefix still rejects', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 40 }), (value) => {
        const encoded = writeVarint(value);
        const truncated = encoded.subarray(0, encoded.length - 1);
        expect(() => readVarint(truncated, 0)).toThrow(QrStreamError);
      }),
    );
  });
});
