import { describe, expect, test } from 'vitest';
import { encodePacket, type Packet } from '../src/core/packet';
import { MAX_SOURCE_BLOCKS, createQrStreamReader } from '../src/core/reader';
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
    // Use a full-size payload so the rejection comes from the K bound, not from
    // the payload-length check.
    expect(reader.add(encodePacket({ ...valid, k: 0xffff, blockSize: 2933, payload: new Uint8Array(2933) }))).toBe(
      'invalid',
    );
    expect(reader.sessionId()).toBeNull();
  });

  test('rejects K above the largest legal 1 MiB stream', () => {
    const reader = createQrStreamReader();
    expect(
      reader.add(
        encodePacket({ ...valid, k: MAX_SOURCE_BLOCKS + 1, blockSize: 32, payload: new Uint8Array(32) }),
      ),
    ).toBe('invalid');
    expect(reader.sessionId()).toBeNull();
  });

  test('rejects a blockSize above the writer frame payload', () => {
    const reader = createQrStreamReader();
    expect(
      reader.add(encodePacket({ ...valid, blockSize: 2934, payload: new Uint8Array(2934) })),
    ).toBe('invalid');
    expect(reader.sessionId()).toBeNull();
  });

  test('rejects K * blockSize above the 1 MiB stream budget', () => {
    const reader = createQrStreamReader();
    expect(
      reader.add(encodePacket({ ...valid, k: 1252, blockSize: 2933, payload: new Uint8Array(2933) })),
    ).toBe('invalid');
    expect(reader.sessionId()).toBeNull();
  });

  test('a same-session K mismatch is invalid and does not burn the symbol index', () => {
    const reader = createQrStreamReader();
    expect(reader.add(encodePacket(valid))).toBe('accepted');
    expect(reader.add(encodePacket({ ...valid, symbolIdx: 1, k: 5 }))).toBe('invalid');
    // The genuine frame for the same symbol must still be accepted.
    expect(reader.add(encodePacket({ ...valid, symbolIdx: 1 }))).toBe('accepted');
    expect(reader.progress().solved).toBe(2);
  });

  test('a same-session flags mismatch is invalid', () => {
    const reader = createQrStreamReader();
    expect(reader.add(encodePacket(valid))).toBe('accepted');
    expect(reader.add(encodePacket({ ...valid, symbolIdx: 1, flags: 3 }))).toBe('invalid');
  });

  test('frames after completion are duplicates, not new work', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(400), {
      filename: 'x.json',
      preset: 'fast',
      sessionId: 9,
    });
    const packets: Uint8Array[] = [];
    for await (const packet of writer.packets()) {
      packets.push(packet);
      if (packets.length === writer.k + 1) break;
    }

    const reader = createQrStreamReader();
    for (const packet of packets.slice(0, writer.k)) reader.add(packet);
    expect(reader.progress().solved).toBe(writer.k);
    expect(reader.add(packets[writer.k] as Uint8Array)).toBe('duplicate');
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
