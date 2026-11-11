import { describe, expect, test } from 'vitest';
import { encodePacket, type Packet } from '../src/core/packet';
import { createQrStreamReader } from '../src/core/reader';
import { createQrStreamWriter } from '../src/core/writer';

const valid: Packet = {
  version: 1,
  flags: 0,
  sessionId: 77,
  symbolIdx: 0,
  k: 4,
  blockSize: 32,
  payload: new Uint8Array(32),
};

describe('reader hardening', () => {
  test('rejects k = 0 instead of locking the session', () => {
    const reader = createQrStreamReader();
    expect(reader.add(encodePacket({ ...valid, k: 0 }))).toBe('invalid');
    expect(reader.sessionId()).toBeNull();
  });

  test('rejects an unknown wire version', () => {
    const reader = createQrStreamReader();
    expect(reader.add(encodePacket({ ...valid, version: 2 }))).toBe('invalid');
    expect(reader.sessionId()).toBeNull();
  });

  test('rejects reserved flag bits', () => {
    const reader = createQrStreamReader();
    expect(reader.add(encodePacket({ ...valid, flags: 0b1000_0000 }))).toBe('invalid');
    expect(reader.sessionId()).toBeNull();
  });

  test('rejects an absurd blockSize', () => {
    const reader = createQrStreamReader();
    expect(reader.add(encodePacket({ ...valid, blockSize: 60000, payload: new Uint8Array(32) }))).toBe(
      'invalid',
    );
  });

  test('a short final payload does not poison the symbol index', () => {
    const reader = createQrStreamReader();
    const short = encodePacket({ ...valid, payload: new Uint8Array(8) });
    expect(reader.add(short)).toBe('invalid');

    // The same symbol arriving correctly must still be accepted.
    expect(reader.add(encodePacket(valid))).toBe('accepted');
    expect(reader.progress().solved).toBe(1);
  });

  test('a hostile stream is rejected before it can be trusted', () => {
    const reader = createQrStreamReader();
    expect(reader.add(encodePacket({ ...valid, k: 0xffff, blockSize: 2953 }))).toBe('invalid');
    expect(reader.sessionId()).toBeNull();
  });
});

describe('writer passphrase handling', () => {
  test('a whitespace-only passphrase does not enable encryption', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(400), {
      filename: 'x.json',
      preset: 'fast',
      passphrase: '   ',
    });
    expect(writer.flags & 2).toBe(0);
    expect(writer.meta.salt).toBeUndefined();
  });

  test('a real passphrase does enable encryption', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(400), {
      filename: 'x.json',
      preset: 'fast',
      passphrase: 'seven words here',
    });
    expect(writer.flags & 2).toBe(2);
    expect(writer.meta.salt?.length).toBe(16);
  });
});
