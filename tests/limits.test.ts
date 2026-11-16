import { describe, expect, test, vi } from 'vitest';
import { encodePacket } from '../src/core/packet';
import { MAX_SOURCE_BLOCKS, createQrStreamReader } from '../src/core/reader';
import { MAX_DECODED_BYTES, MAX_INPUT_BYTES, MAX_WIRE_BYTES } from '../src/core/types';
import { createQrStreamWriter } from '../src/core/writer';

const LEGACY_CAP = 1024 * 1024;

/** Highly compressible JSON, sized to at least `bytes` of source text. */
function compressibleJson(bytes: number): Uint8Array {
  const record = { title: 'a repeated record with enough text to compress well', tags: ['alpha', 'beta', 'gamma'] };
  const count = Math.ceil(bytes / JSON.stringify(record).length);
  return new TextEncoder().encode(JSON.stringify({ records: Array.from({ length: count }, () => record) }));
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Incompressible, so the writer really has to fit it on the wire. */
function noisy(size: number, seed = 7): Uint8Array {
  const rand = lcg(seed);
  return Uint8Array.from({ length: size }, () => Math.floor(rand() * 256));
}

describe('wire-based transfer limits', () => {
  test('raw input above the legacy 1 MiB cap is accepted when the wire fits', async () => {
    const payload = compressibleJson(1_150_000);
    expect(payload.length).toBeGreaterThan(LEGACY_CAP);

    const writer = await createQrStreamWriter(payload, { filename: 'group.json', preset: 'fast' });

    expect(writer.plainBytes).toBe(payload.length);
    expect(writer.wireBytes).toBeLessThanOrEqual(MAX_WIRE_BYTES);
    expect(writer.wireBytes).toBe(writer.meta.wireLen);
    expect(writer.payloadBytes).toBeGreaterThan(writer.wireBytes);
    expect(writer.k).toBeGreaterThan(0);
  });

  test('a compressible payload above the legacy cap round-trips through a default reader', async () => {
    const writer = await createQrStreamWriter(compressibleJson(1_150_000), {
      filename: 'group.json',
      preset: 'fast',
      sessionId: 41,
    });

    const reader = createQrStreamReader();
    let emitted = 0;
    for await (const packet of writer.packets()) {
      reader.add(packet);
      emitted += 1;
      if (reader.progress().solved === writer.k) break;
      if (emitted > writer.k * 20) break;
    }

    const result = await reader.result();
    expect(result?.data.length).toBe(writer.plainBytes);
    expect(result?.meta.plainLen).toBe(writer.plainBytes);
  });

  test('incompressible input over the wire cap fails before any PBKDF2 work', async () => {
    const importKey = vi.spyOn(globalThis.crypto.subtle, 'importKey');

    await expect(
      createQrStreamWriter(noisy(MAX_WIRE_BYTES + 1), {
        filename: 'noise.bin',
        preset: 'fast',
        passphrase: 'should not be hashed',
      }),
    ).rejects.toMatchObject({
      name: 'PayloadTooLargeError',
      code: 'WIRE_TOO_LARGE',
      scope: 'wire',
      limit: MAX_WIRE_BYTES,
      recovery: 'change-input',
    });

    expect(importKey).not.toHaveBeenCalled();
    importKey.mockRestore();
  });

  test('raw input over the hard input cap fails as INPUT_TOO_LARGE', async () => {
    await expect(
      createQrStreamWriter(new Uint8Array(MAX_INPUT_BYTES + 1), {
        filename: 'huge.bin',
        preset: 'fast',
      }),
    ).rejects.toMatchObject({
      code: 'INPUT_TOO_LARGE',
      scope: 'input',
      limit: MAX_INPUT_BYTES,
      recovery: 'change-input',
    });
  });

  test('limits.maxWireBytes tightens the default budget', async () => {
    await expect(
      createQrStreamWriter(noisy(200_000), {
        filename: 'noise.bin',
        preset: 'fast',
        limits: { maxWireBytes: 1_000 },
      }),
    ).rejects.toMatchObject({ code: 'WIRE_TOO_LARGE', scope: 'wire', limit: 1_000 });
  });

  test('limits.maxInputBytes: 1 MiB reproduces the 0.2 cap', async () => {
    const legacy = { maxInputBytes: LEGACY_CAP };

    const accepted = await createQrStreamWriter(new Uint8Array(LEGACY_CAP), {
      filename: 'zeros.bin',
      preset: 'fast',
      limits: legacy,
    });
    expect(accepted.plainBytes).toBe(LEGACY_CAP);

    await expect(
      createQrStreamWriter(new Uint8Array(LEGACY_CAP + 1), {
        filename: 'over.bin',
        preset: 'fast',
        limits: legacy,
      }),
    ).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE', scope: 'input', limit: LEGACY_CAP });
  });

  test('a reader rejects a payload above maxDecodedBytes with DECODED_TOO_LARGE', async () => {
    const writer = await createQrStreamWriter(new TextEncoder().encode('{"a":1}'), {
      filename: 'small.json',
      preset: 'fast',
      sessionId: 42,
    });

    const reader = createQrStreamReader({ limits: { maxDecodedBytes: 4 } });
    for await (const packet of writer.packets()) {
      reader.add(packet);
      if (reader.progress().solved === writer.k) break;
    }

    await expect(reader.result()).rejects.toMatchObject({
      code: 'DECODED_TOO_LARGE',
      scope: 'decoded',
      limit: 4,
      recovery: 'none',
    });
  });

  test('a reader rejects a frame declaring a larger K before it locks', () => {
    const reader = createQrStreamReader({ limits: { maxWireBytes: 1_000 } });
    const packet = encodePacket({
      version: 1,
      flags: 0,
      sessionId: 1,
      symbolIdx: 0,
      k: 100,
      blockSize: 2933,
      payload: new Uint8Array(2933),
    });

    expect(reader.add(packet)).toBe('invalid');
    expect(reader.sessionId()).toBeNull();
  });

  test('MAX_SOURCE_BLOCKS stays derived from the hard wire cap', () => {
    // The 0.2 value: ceil((1 MiB + 256 + 16) / 838). Lowering a caller's
    // maxWireBytes must not move this guard rail.
    expect(MAX_SOURCE_BLOCKS).toBe(1252);
  });

  test('invalid writer limits are INVALID_ARGUMENT', async () => {
    const payload = new Uint8Array(10);
    const bad = [
      { maxWireBytes: 0 },
      { maxWireBytes: -1 },
      { maxWireBytes: 1.5 },
      { maxWireBytes: Number.NaN },
      { maxWireBytes: MAX_WIRE_BYTES + 1 },
      { maxInputBytes: 0 },
      { maxInputBytes: Number.POSITIVE_INFINITY },
      { maxInputBytes: MAX_INPUT_BYTES + 1 },
    ];

    for (const limits of bad) {
      await expect(createQrStreamWriter(payload, { filename: 'x.json', preset: 'fast', limits })).rejects.toMatchObject(
        { code: 'INVALID_ARGUMENT' },
      );
    }
  });

  test('invalid reader limits are INVALID_ARGUMENT', () => {
    const bad = [
      { maxWireBytes: 0 },
      { maxWireBytes: 1.5 },
      { maxWireBytes: MAX_WIRE_BYTES + 1 },
      { maxDecodedBytes: -1 },
      { maxDecodedBytes: MAX_DECODED_BYTES + 1 },
    ];

    for (const limits of bad) {
      expect(() => createQrStreamReader({ limits })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    }
  });
});
