import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { QrStreamError } from '../../src/core/errors';
import { decodeMeta, encodeMeta, type StreamMeta } from '../../src/core/meta';

fc.configureGlobal({ numRuns: Number(process.env.FUZZ_RUNS ?? 1000) });

const TYPED_CODES = new Set(['INVALID_METADATA', 'UNSUPPORTED_VERSION']);

function assertTypedRejection(error: unknown): void {
  expect(error).toBeInstanceOf(QrStreamError);
  const typed = error as QrStreamError;
  expect(TYPED_CODES.has(typed.code)).toBe(true);
}

/** Force a metadata version of 1 so the parser reaches the length fields. */
function versionOne(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  if (copy.length > 0) copy[0] = 1;
  return copy;
}

const metaArbitrary: fc.Arbitrary<StreamMeta> = fc.record({
  filename: fc.string({ maxLength: 100 }),
  plainLen: fc.integer({ min: 0, max: 0xffff_ffff }),
  wireLen: fc.integer({ min: 0, max: 0xffff_ffff }),
  sha256: fc.uint8Array({ minLength: 32, maxLength: 32 }),
  salt: fc.option(fc.uint8Array({ minLength: 1, maxLength: 64 }), { nil: undefined }),
  nonce: fc.option(fc.uint8Array({ minLength: 1, maxLength: 32 }), { nil: undefined }),
  iterations: fc.integer({ min: 0, max: 0xffff_ffff }),
});

describe('metadata parsing fuzz', () => {
  test('arbitrary bytes throw a typed error or return a bounded meta', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        let meta: StreamMeta | null = null;
        try {
          meta = decodeMeta(bytes);
        } catch (error) {
          assertTypedRejection(error);
          return;
        }

        expect(meta).not.toBeNull();
        const parsed = meta as StreamMeta;
        expect(parsed.filename.length).toBeLessThanOrEqual(64);
        expect(new TextEncoder().encode(parsed.filename).length).toBeLessThanOrEqual(64);
        expect(parsed.plainLen).toBeGreaterThanOrEqual(0);
        expect(parsed.plainLen).toBeLessThanOrEqual(0xffff_ffff);
        expect(parsed.wireLen).toBeLessThanOrEqual(0xffff_ffff);
        expect(parsed.sha256.length).toBe(32);
        expect(parsed.salt?.length ?? 0).toBeLessThanOrEqual(0xffff);
        expect(parsed.nonce?.length ?? 0).toBeLessThanOrEqual(0xffff);
        expect(parsed.iterations).toBeGreaterThanOrEqual(0);
        expect(parsed.iterations).toBeLessThanOrEqual(0xffff_ffff);
      }),
    );
  });

  test('arbitrary bytes claiming version 1 throw typed errors or return a bounded meta', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 512 }).map(versionOne), (bytes) => {
        try {
          const parsed = decodeMeta(bytes);
          expect(parsed.filename.length).toBeLessThanOrEqual(64);
          expect(parsed.sha256.length).toBe(32);
        } catch (error) {
          assertTypedRejection(error);
        }
      }),
    );
  });

  test('a peer filename cannot expand past the 64-byte metadata bound', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 64, maxLength: 64 }), (nameBytes) => {
        const encoded = encodeMeta({
          filename: 'x'.repeat(64),
          plainLen: 0,
          wireLen: 0,
          sha256: new Uint8Array(32),
          iterations: 0,
        });
        // Replace the encoded filename bytes with arbitrary peer-controlled UTF-8.
        encoded.set(nameBytes, 2);
        const decoded = decodeMeta(encoded);
        expect(new TextEncoder().encode(decoded.filename).length).toBeLessThanOrEqual(64);
      }),
    );
  });

  test('regression seed 829397707: invalid UTF-8 filename bytes stay bounded', () => {
    const encoded = encodeMeta({
      filename: 'x'.repeat(64),
      plainLen: 0,
      wireLen: 0,
      sha256: new Uint8Array(32),
      iterations: 0,
    });
    // 64 bytes of 0xff decode to 64 U+FFFD characters (192 UTF-8 bytes) without
    // the bound check after decoding.
    encoded.fill(0xff, 2, 2 + 64);
    const decoded = decodeMeta(encoded);
    expect(new TextEncoder().encode(decoded.filename).length).toBeLessThanOrEqual(64);
    expect(decoded.filename.length).toBeGreaterThan(0);
  });

  test('round-trips encoded metadata and stays stable under re-encoding', () => {
    fc.assert(
      fc.property(metaArbitrary, (meta) => {
        const encoded = encodeMeta(meta);
        const decoded = decodeMeta(encoded);

        expect(decoded.plainLen).toBe(meta.plainLen);
        expect(decoded.wireLen).toBe(meta.wireLen);
        expect(decoded.sha256).toEqual(meta.sha256);
        expect(decoded.iterations).toBe(meta.iterations);
        expect(decoded.salt).toEqual(meta.salt);
        expect(decoded.nonce).toEqual(meta.nonce);
        expect(encodeMeta(decoded)).toEqual(encoded);
      }),
    );
  });

  test('a corrupted encoded meta never throws an untyped error', () => {
    fc.assert(
      fc.property(metaArbitrary, fc.nat({ max: 1024 }), (meta, offset) => {
        const bytes = encodeMeta(meta);
        const index = offset % bytes.length;
        bytes[index] = (bytes[index] as number) ^ 0x80;
        try {
          decodeMeta(bytes);
        } catch (error) {
          assertTypedRejection(error);
        }
      }),
    );
  });
});
