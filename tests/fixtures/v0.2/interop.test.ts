import { describe, expect, test } from 'vitest';
import { FLAG_ENCRYPTED, FLAG_GZIP } from '../../../src/core/packet';
import { createQrStreamReader } from '../../../src/core/reader';
import { createQrStreamWriter } from '../../../src/core/writer';
import golden from './golden.json';
import { createQrStreamReader as createLegacyReader } from './reader';
import { createQrStreamWriter as createLegacyWriter } from './writer';

const SESSION_ID = 0x5151_0001;

interface PacketSource {
  k: number;
  packets(): AsyncGenerator<Uint8Array>;
}

/** Deterministic, poorly compressible bytes so the stream spans several blocks. */
function makePayload(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 0x0bad_f00d;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

/** A compressible payload that exercises the gzip flag on both sides. */
const compressiblePayload = new TextEncoder().encode(
  'qr-stream interop fixture: the wire format did not change between 0.2 and 1.0. '.repeat(48),
);

async function sourcePackets(writer: PacketSource): Promise<Uint8Array[]> {
  const packets: Uint8Array[] = [];
  for await (const packet of writer.packets()) {
    packets.push(packet);
    if (packets.length === writer.k) break;
  }
  return packets;
}

function feed(reader: { add(bytes: Uint8Array): string }, packets: Uint8Array[]): void {
  for (const packet of packets) {
    expect(reader.add(packet)).toBe('accepted');
  }
}

describe('0.2 interop', () => {
  test('the frozen 0.2 reader reads a 1.0 writer stream (plain)', async () => {
    const payload = makePayload(4096);
    const writer = await createQrStreamWriter(payload, {
      filename: 'interop-plain.bin',
      preset: 'fast',
      sessionId: SESSION_ID,
      limits: { maxInputBytes: 1024 * 1024 },
    });

    const reader = createLegacyReader();
    feed(reader, await sourcePackets(writer));
    const result = await reader.result();
    expect(result?.data).toEqual(payload);
  });

  test('the frozen 0.2 reader reads a 1.0 writer stream (encrypted, gzip)', async () => {
    const writer = await createQrStreamWriter(compressiblePayload, {
      filename: 'interop-secret.txt',
      preset: 'fast',
      sessionId: SESSION_ID,
      passphrase: 'correct horse battery staple',
      limits: { maxInputBytes: 1024 * 1024 },
    });
    expect(writer.flags & FLAG_GZIP).toBe(FLAG_GZIP);
    expect(writer.flags & FLAG_ENCRYPTED).toBe(FLAG_ENCRYPTED);

    const reader = createLegacyReader();
    feed(reader, await sourcePackets(writer));
    const result = await reader.result('correct horse battery staple');
    expect(result?.data).toEqual(compressiblePayload);
  });

  test('the 1.0 reader reads a frozen 0.2 writer stream (plain)', async () => {
    const payload = makePayload(4096);
    const writer = await createLegacyWriter(payload, {
      filename: 'legacy-plain.bin',
      preset: 'fast',
      sessionId: SESSION_ID,
    });

    const reader = createQrStreamReader();
    feed(reader, await sourcePackets(writer));
    const result = await reader.result();
    expect(result?.data).toEqual(payload);
  });

  test('the 1.0 reader reads a frozen 0.2 writer stream (encrypted, gzip)', async () => {
    const writer = await createLegacyWriter(compressiblePayload, {
      filename: 'legacy-secret.txt',
      preset: 'fast',
      sessionId: SESSION_ID,
      passphrase: 'correct horse battery staple',
    });
    expect(writer.flags & FLAG_GZIP).toBe(FLAG_GZIP);
    expect(writer.flags & FLAG_ENCRYPTED).toBe(FLAG_ENCRYPTED);

    const reader = createQrStreamReader();
    feed(reader, await sourcePackets(writer));
    const result = await reader.result('correct horse battery staple');
    expect(result?.data).toEqual(compressiblePayload);
  });

  test('the 1.0 reader reconstructs the committed 0.2 golden streams', async () => {
    const payload = new Uint8Array(Buffer.from(golden.payloadBase64, 'base64'));

    for (const [name, stream] of [
      ['plain', golden.plain],
      ['encrypted', golden.encrypted],
    ] as const) {
      const reader = createQrStreamReader();
      feed(
        reader,
        stream.packets.map((packet) => new Uint8Array(Buffer.from(packet, 'base64'))),
      );
      const result = await reader.result('passphrase' in stream ? stream.passphrase : undefined);
      expect(result?.data, name).toEqual(payload);
    }
  });

  test('the committed golden packets are what the frozen writer emits today', async () => {
    // Base64 is only a transport for the fixture; the session id and payload
    // identify the stream, so a truncated or hand-edited golden file fails.
    const writer = await createLegacyWriter(new Uint8Array(Buffer.from(golden.payloadBase64, 'base64')), {
      filename: 'golden.txt',
      preset: 'fast',
      sessionId: golden.sessionId,
    });
    expect(writer.k).toBe(golden.plain.k);
    expect(writer.blockSize).toBe(golden.plain.blockSize);
    expect(writer.flags).toBe(golden.plain.flags);
  });
});
