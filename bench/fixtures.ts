import { splitmix32 } from '../src/core/prng.js';

export const MIB = 1024 * 1024;

/**
 * Deterministic incompressible bytes.
 *
 * splitmix32 is already a project dependency and, more importantly, the same
 * generator on every run keeps the gzip outcome (not smaller than the input)
 * and the QR contents stable across machines. `Math.random` here would make
 * the writer baseline itself vary between runs.
 */
export function incompressibleBytes(size = MIB, seed = 0x5eed1234): Uint8Array {
  const next = splitmix32(seed);
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = next() & 0xff;
  return out;
}

/**
 * About 1 MiB of realistic JSON: repeated records with short strings, numbers,
 * booleans, and nested arrays. Compression ratio is the point, not validity of
 * the final byte, which is truncated to exactly `size`.
 */
export function compressibleJson(size = MIB): Uint8Array {
  const parts: string[] = ['{"records":['];
  let length = parts[0]?.length ?? 0;
  for (let i = 0; length < size; i += 1) {
    const record =
      `${i === 0 ? '' : ','}` +
      `{"id":${i},"name":"user-${i % 500}","email":"user${i % 500}@example.com",` +
      `"active":${i % 3 === 0},"score":${i % 97},` +
      `"tags":["alpha","beta","gamma"],"note":"the quick brown fox jumps over the lazy dog"}`;
    parts.push(record);
    length += record.length;
  }
  parts.push(']}');

  const bytes = new TextEncoder().encode(parts.join(''));
  return bytes.slice(0, size);
}

/** A packet of the size the writer puts in one frame at this version. */
export function packetFor(capacity: number, seed: number): Uint8Array {
  return incompressibleBytes(capacity, seed);
}
