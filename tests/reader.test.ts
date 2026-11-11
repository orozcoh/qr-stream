import { describe, expect, test } from 'vitest';
import { createQrStreamReader } from '../src/core/reader';
import { createQrStreamWriter } from '../src/core/writer';
import { decodePacket, encodePacket } from '../src/core/packet';
import { WrongKeyError } from '../src/core/crypto';

async function collect(writer: Awaited<ReturnType<typeof createQrStreamWriter>>, count: number) {
  const out: Uint8Array[] = [];
  for await (const p of writer.packets()) {
    out.push(p);
    if (out.length === count) break;
  }
  return out;
}

const json = new TextEncoder().encode(
  JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item-${i}`, ok: true }))),
);

describe('createQrStreamReader', () => {
  test('a foreign QR code is invalid', () => {
    const reader = createQrStreamReader();
    expect(reader.add(new TextEncoder().encode('https://example.com'))).toBe('invalid');
  });

  test('the same symbol twice is a duplicate', async () => {
    const writer = await createQrStreamWriter(json, { filename: 'a.json', preset: 'fast' });
    const [first] = await collect(writer, 1);
    const reader = createQrStreamReader();
    expect(reader.add(first as Uint8Array)).toBe('accepted');
    expect(reader.add(first as Uint8Array)).toBe('duplicate');
  });

  test('a second session is rejected as stale', async () => {
    const a = await createQrStreamWriter(json, { filename: 'a.json', preset: 'fast', sessionId: 111 });
    const b = await createQrStreamWriter(json, { filename: 'b.json', preset: 'fast', sessionId: 222 });
    const [fromA] = await collect(a, 1);
    const [fromB] = await collect(b, 1);
    const reader = createQrStreamReader();
    expect(reader.add(fromA as Uint8Array)).toBe('accepted');
    expect(reader.add(fromB as Uint8Array)).toBe('stale-session');
    expect(reader.sessionId()).toBe(111);
  });

  test('reconstructs out of order with 30% dropped', async () => {
    const writer = await createQrStreamWriter(json, { filename: 'data.json', preset: 'fast' });
    const packets = await collect(writer, Math.ceil(writer.k * 2));
    const kept = packets.filter((_, i) => i % 10 !== 3);
    const reader = createQrStreamReader();
    for (const p of kept.reverse()) reader.add(p);

    const result = await reader.result();
    expect(result).not.toBeNull();
    expect(new TextDecoder().decode((result as { data: Uint8Array }).data)).toBe(
      new TextDecoder().decode(json),
    );
    expect((result as { meta: { filename: string } }).meta.filename).toBe('data.json');
  });

  test('an encrypted stream needs the passphrase, and retries without re-receiving', async () => {
    const writer = await createQrStreamWriter(json, {
      filename: 'secret.json',
      preset: 'fast',
      passphrase: 'blue seven kilo',
    });
    const reader = createQrStreamReader();
    for (const p of await collect(writer, writer.k)) reader.add(p);

    expect(reader.progress().solved).toBe(writer.k);
    await expect(reader.result('wrong')).rejects.toBeInstanceOf(WrongKeyError);

    const retried = await reader.result('blue seven kilo');
    expect(new TextDecoder().decode(retried.data)).toBe(new TextDecoder().decode(json));
  });

  test('reset forgets the session', async () => {
    const writer = await createQrStreamWriter(json, { filename: 'a.json', preset: 'fast', sessionId: 5 });
    const [first] = await collect(writer, 1);
    const reader = createQrStreamReader();
    reader.add(first as Uint8Array);
    reader.reset();
    expect(reader.sessionId()).toBeNull();
    expect(reader.progress().solved).toBe(0);
  });

  test('result is null until complete', async () => {
    const writer = await createQrStreamWriter(json, { filename: 'a.json', preset: 'fast' });
    const [first] = await collect(writer, 1);
    const reader = createQrStreamReader();
    reader.add(first as Uint8Array);
    expect(await reader.result()).toBeNull();
  });

  test('a corrupted payload is reported, not silently returned', async () => {
    const writer = await createQrStreamWriter(json, { filename: 'a.json', preset: 'fast', sessionId: 9 });
    const packets = await collect(writer, writer.k);
    const reader = createQrStreamReader();

    // Flip a byte inside block 0 and re-seal the frame, so it passes the CRC
    // gate and reaches the fountain decoder as genuine-looking data.
    const head = decodePacket(packets[0] as Uint8Array);
    if (head === null) throw new Error('expected a valid first packet');
    const payload = new Uint8Array(head.payload);
    payload[40] = (payload[40] ?? 0) ^ 0xff;
    reader.add(encodePacket({ ...head, payload }));

    for (const p of packets.slice(1)) reader.add(p);
    await expect(reader.result()).rejects.toBeTruthy();
  });
});
