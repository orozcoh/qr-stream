import { describe, expect, test } from 'vitest';
import { MAX_INPUT_BYTES, PRESETS } from '../src/core/types';
import { createQrStreamWriter } from '../src/core/writer';
import { decodePacket } from '../src/core/packet';
import { decodeMeta } from '../src/core/meta';
import { readVarint } from '../src/core/meta';

const take = async <T>(gen: AsyncGenerator<T>, count: number): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of gen) {
    out.push(item);
    if (out.length === count) break;
  }
  return out;
};

describe('createQrStreamWriter', () => {
  test('a small payload fits in one block', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(300).fill(65), {
      filename: 'small.json',
      preset: 'fast',
    });
    expect(writer.k).toBe(1);
    expect(writer.meta.plainLen).toBe(300);
    expect(writer.meta.filename).toBe('small.json');
  });

  test('blockSize is capacity minus framing for every preset', async () => {
    const expected: Record<string, number> = { fast: 838, balanced: 1253, dense: 1712, extreme: 2933 };
    for (const preset of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      const writer = await createQrStreamWriter(new Uint8Array(100), { filename: 'a.json', preset });
      expect(writer.blockSize).toBe(expected[preset]);
    }
  });

  test('the first packet carries decodable metadata', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(3000).fill(66), {
      filename: 'meta.json',
      preset: 'fast',
    });
    const [first] = await take(writer.packets(), 1);
    const packet = decodePacket(first as Uint8Array);
    expect(packet).not.toBeNull();
    const { value: metaLen, next } = readVarint((packet as NonNullable<typeof packet>).payload, 0);
    const meta = decodeMeta((packet as NonNullable<typeof packet>).payload.subarray(next, next + metaLen));
    expect(meta.filename).toBe('meta.json');
    expect(meta.plainLen).toBe(3000);
    expect(meta.sha256.length).toBe(32);
  });

  test('emits every source symbol then repairs', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(20000).fill(67), {
      filename: 'big.json',
      preset: 'fast',
    });
    const packets = await take(writer.packets(), writer.k + 5);
    const decoded = packets.map((p) => decodePacket(p));
    for (let i = 0; i < writer.k; i += 1) expect(decoded[i]?.symbolIdx).toBe(i);
    for (let i = 0; i < 5; i += 1) expect(decoded[writer.k + i]?.symbolIdx).toBe(writer.k + i);
  });

  test('every packet payload is exactly blockSize', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(5000).fill(68), {
      filename: 'x.json',
      preset: 'balanced',
    });
    for (const bytes of await take(writer.packets(), writer.k + 3)) {
      expect(decodePacket(bytes)?.payload.length).toBe(writer.blockSize);
    }
  });

  test('rejects input over the cap', async () => {
    await expect(
      createQrStreamWriter(new Uint8Array(MAX_INPUT_BYTES + 1), { filename: 'huge.json', preset: 'fast' }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  test('accepts exactly the cap', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(MAX_INPUT_BYTES), {
      filename: 'edge.json',
      preset: 'fast',
    });
    expect(writer.k).toBeGreaterThan(0);
  });

  test('sets the encrypted flag only when a passphrase is given', async () => {
    const plain = await createQrStreamWriter(new Uint8Array(500), { filename: 'p.json', preset: 'fast' });
    const sealed = await createQrStreamWriter(new Uint8Array(500), {
      filename: 'p.json',
      preset: 'fast',
      passphrase: 'k',
    });
    expect(plain.flags & 2).toBe(0);
    expect(sealed.flags & 2).toBe(2);
    expect(sealed.meta.salt?.length).toBe(16);
    expect(sealed.meta.nonce?.length).toBe(12);
  });
});
