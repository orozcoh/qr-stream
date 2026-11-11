import { describe, expect, test } from 'vitest';
import { HEADER_SIZE } from '../src/core/types';
import {
  FLAG_ENCRYPTED,
  FLAG_GZIP,
  MAGIC,
  decodePacket,
  encodePacket,
  type Packet,
} from '../src/core/packet';

const sample = (overrides: Partial<Packet> = {}): Packet => ({
  version: 1,
  flags: FLAG_GZIP,
  sessionId: 0xdeadbeef,
  symbolIdx: 3,
  k: 10,
  blockSize: 64,
  payload: new Uint8Array([1, 2, 3]),
  ...overrides,
});

describe('packet codec', () => {
  test('round-trips every field', () => {
    const packet = sample();
    const decoded = decodePacket(encodePacket(packet));
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(packet);
  });

  test('round-trips an encrypted packet with both flags set', () => {
    const packet = sample({ flags: FLAG_GZIP | FLAG_ENCRYPTED });
    expect(decodePacket(encodePacket(packet))?.flags).toBe(3);
  });

  test('rejects a flipped payload byte', () => {
    const bytes = encodePacket(sample());
    bytes[HEADER_SIZE] = (bytes[HEADER_SIZE] ?? 0) ^ 0x01;
    expect(decodePacket(bytes)).toBeNull();
  });

  test('rejects a flipped header byte', () => {
    const bytes = encodePacket(sample());
    bytes[9] = (bytes[9] ?? 0) ^ 0x01;
    expect(decodePacket(bytes)).toBeNull();
  });

  test('rejects a foreign QR code', () => {
    const url = new TextEncoder().encode('https://example.com');
    expect(decodePacket(url)).toBeNull();
  });

  test('rejects a truncated packet', () => {
    const bytes = encodePacket(sample());
    expect(decodePacket(bytes.subarray(0, bytes.length - 1))).toBeNull();
  });

  test('rejects trailing bytes', () => {
    const bytes = encodePacket(sample());
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes);
    expect(decodePacket(padded)).toBeNull();
  });

  test('rejects a payload longer than blockSize', () => {
    const bytes = encodePacket(sample({ blockSize: 2, payload: new Uint8Array([1, 2, 3]) }));
    expect(decodePacket(bytes)).toBeNull();
  });

  test('accepts a payload exactly filling blockSize', () => {
    const payload = new Uint8Array(64).fill(7);
    const decoded = decodePacket(encodePacket(sample({ blockSize: 64, payload })));
    expect(decoded?.payload.length).toBe(64);
  });

  test('magic identifies the stream format', () => {
    expect(MAGIC).toBe(0x5153);
  });
});
