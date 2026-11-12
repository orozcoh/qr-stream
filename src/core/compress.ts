import { MAX_INPUT_BYTES } from './types';

async function pipe(bytes: Uint8Array, transform: CompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Compress with gzip, but only if it actually pays for itself. */
export async function gzipIfSmaller(bytes: Uint8Array): Promise<{ data: Uint8Array; gzipped: boolean }> {
  const compressed = await pipe(bytes, new CompressionStream('gzip'));
  if (compressed.length < bytes.length) return { data: compressed, gzipped: true };
  return { data: bytes, gzipped: false };
}

/**
 * Decompress with a hard output budget.
 *
 * A peer controls the gzip payload, so the limit has to be enforced while the
 * stream is read. Buffering the whole member first and checking its length
 * afterwards lets a few kilobytes of deflate expand to gigabytes before the
 * check runs. Cancelling the reader at the cap keeps peak allocation at
 * `maxBytes` plus one chunk.
 */
export async function gunzip(bytes: Uint8Array, maxBytes = MAX_INPUT_BYTES): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError(`decoded payload exceeds the size limit (${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
