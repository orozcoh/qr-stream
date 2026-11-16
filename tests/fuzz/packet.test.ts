import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { decodePacket, encodePacket, type Packet } from '../../src/core/packet';

fc.configureGlobal({ numRuns: Number(process.env.FUZZ_RUNS ?? 1000) });

/** Give random bytes a valid magic so the decoder reaches the header fields. */
function withMagic(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  copy[0] = 0x51;
  copy[1] = 0x53;
  return copy;
}

const packetFields: fc.Arbitrary<Packet> = fc
  .record({
    version: fc.integer({ min: 0, max: 0xff }),
    flags: fc.integer({ min: 0, max: 0xff }),
    sessionId: fc.integer({ min: 0, max: 0xffff_ffff }),
    symbolIdx: fc.integer({ min: 0, max: 0xffff }),
    k: fc.integer({ min: 1, max: 0xffff }),
    payload: fc.uint8Array({ minLength: 1, maxLength: 2048 }),
  })
  .map((packet) => ({ ...packet, blockSize: packet.payload.length }));

describe('packet decoding fuzz', () => {
  test('never throws for arbitrary bytes and bounds every decoded field', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        const decoded = decodePacket(bytes);
        if (decoded === null) return;

        expect(decoded.payload.length).toBeLessThanOrEqual(decoded.blockSize);
        expect(decoded.blockSize).toBeLessThanOrEqual(0xffff);
        expect(decoded.k).toBeLessThanOrEqual(0xffff);
        expect(decoded.symbolIdx).toBeLessThanOrEqual(0xffff);
        expect(decoded.sessionId).toBeLessThanOrEqual(0xffff_ffff);
        expect(decoded.version).toBeLessThanOrEqual(0xff);
        expect(decoded.flags).toBeLessThanOrEqual(0xff);
      }),
    );
  });

  test('never throws for arbitrary bytes behind the magic', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 20, maxLength: 4096 }).map(withMagic), (bytes) => {
        const decoded = decodePacket(bytes);
        if (decoded === null) return;
        expect(decoded.payload.length).toBeLessThanOrEqual(decoded.blockSize);
      }),
    );
  });

  test('never throws for a valid packet with one byte corrupted', () => {
    fc.assert(
      fc.property(packetFields, fc.nat({ max: 4095 }), (packet, offset) => {
        const bytes = encodePacket(packet);
        const index = offset % bytes.length;
        bytes[index] = (bytes[index] as number) ^ 0x01;
        expect(() => decodePacket(bytes)).not.toThrow();
      }),
    );
  });

  test('round-trips every valid field combination', () => {
    fc.assert(
      fc.property(packetFields, (packet) => {
        const decoded = decodePacket(encodePacket(packet));
        expect(decoded).not.toBeNull();
        expect(decoded).toEqual(packet);
      }),
    );
  });

  test('decodes correctly when the input has a non-zero byte offset', () => {
    fc.assert(
      fc.property(packetFields, fc.nat({ max: 32 }), (packet, padding) => {
        const encoded = encodePacket(packet);
        const wrapped = new Uint8Array(encoded.length + padding);
        wrapped.set(encoded, padding);
        expect(decodePacket(wrapped.subarray(padding))).toEqual(packet);
      }),
    );
  });
});
