import { describe, expect, test } from 'vitest';
import { createQrStreamReader } from '../src/core/reader';
import { createQrStreamWriter } from '../src/core/writer';

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const makeJson = (records: number): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      generated: '2026-11-11',
      records: Array.from({ length: records }, (_, i) => ({
        id: i,
        title: `record ${i}`,
        status: i % 3 === 0 ? 'open' : 'closed',
        tags: ['alpha', 'beta', 'gamma'],
        nested: { score: i * 7, active: i % 2 === 0 },
      })),
    }),
  );

async function roundTrip(payload: Uint8Array, preset: 'fast' | 'balanced', passphrase?: string) {
  const writer = await createQrStreamWriter(payload, {
    filename: 'e2e.json',
    preset,
    ...(passphrase ? { passphrase } : {}),
  });

  const reader = createQrStreamReader();
  const rand = lcg(4242);
  const cap = writer.k * 20 + 50;
  let emitted = 0;
  let batch: Uint8Array[] = [];

  const drain = (): void => {
    // Deliver out of order: a real camera never sees symbols in sequence.
    for (let i = batch.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [batch[i], batch[j]] = [batch[j] as Uint8Array, batch[i] as Uint8Array];
    }
    for (const packet of batch) reader.add(packet);
    batch = [];
  };

  // The real sender loops forever, so emit until the reader is satisfied rather
  // than through a fixed window: a fixed 1.5xK window is marginal when gzip has
  // collapsed the payload into only a few blocks.
  for await (const packet of writer.packets()) {
    emitted += 1;
    if (rand() >= 0.25) batch.push(packet);
    if (batch.length >= 8) drain();
    if (reader.progress().solved === writer.k) break;
    if (emitted >= cap) break;
  }
  drain();

  return reader.result(passphrase);
}

describe('core end to end', () => {
  test('60 KB of JSON survives 25% loss and out-of-order delivery', async () => {
    const payload = makeJson(500);
    expect(payload.length).toBeGreaterThan(50_000);
    const result = await roundTrip(payload, 'fast');
    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(result?.data)).toBe(new TextDecoder().decode(payload));
    expect(result?.meta.filename).toBe('e2e.json');
    expect(result?.meta.plainLen).toBe(payload.length);
  });

  test('the same payload with a passphrase', async () => {
    const payload = makeJson(200);
    const result = await roundTrip(payload, 'balanced', 'orange lantern');
    expect(new TextDecoder().decode(result?.data)).toBe(new TextDecoder().decode(payload));
  });

  test('a one-byte payload round-trips', async () => {
    const result = await roundTrip(new Uint8Array([42]), 'fast');
    expect(Array.from(result?.data ?? [])).toEqual([42]);
  });

  test('a 250 KiB incompressible payload completes', async () => {
    // Pseudo-random, so gzip cannot shrink it and k stays at the realistic
    // worst case (~306 blocks). A repeating pattern compresses to a handful of
    // blocks, which makes the fixed 25%-loss window flaky for reasons that have
    // nothing to do with the codec.
    const payload = new Uint8Array(250 * 1024);
    const rand = lcg(2026);
    for (let i = 0; i < payload.length; i += 1) payload[i] = Math.floor(rand() * 256);
    const result = await roundTrip(payload, 'fast');
    expect(result?.data.length).toBe(payload.length);
    expect(Array.from(result?.data.slice(0, 8) ?? [])).toEqual(Array.from(payload.slice(0, 8)));
  }, 30_000);
});
