import { PayloadTooLargeError, QrStreamError } from './errors.js';
import { MAX_INPUT_BYTES } from './types.js';

function unsupportedRuntime(feature: string): QrStreamError {
  return new QrStreamError('UNSUPPORTED_RUNTIME', `${feature} is not available in this browser`, {
    recovery: 'upgrade-browser',
  });
}

function decompressionFailed(cause: unknown): QrStreamError {
  return new QrStreamError('DECOMPRESSION_FAILED', 'the payload could not be decompressed', {
    cause,
    recovery: 'rescan',
  });
}

async function pipe(bytes: Uint8Array, transform: CompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Compress with gzip, but only if it actually pays for itself. */
export async function gzipIfSmaller(bytes: Uint8Array): Promise<{ data: Uint8Array; gzipped: boolean }> {
  if (typeof CompressionStream === 'undefined') throw unsupportedRuntime('CompressionStream');

  let compressed: Uint8Array;
  try {
    compressed = await pipe(bytes, new CompressionStream('gzip'));
  } catch (cause) {
    throw new QrStreamError('COMPRESSION_FAILED', 'the payload could not be compressed', {
      cause,
      recovery: 'retry',
    });
  }

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
  if (typeof DecompressionStream === 'undefined') throw unsupportedRuntime('DecompressionStream');

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  } catch (cause) {
    throw decompressionFailed(cause);
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (cause) {
        throw decompressionFailed(cause);
      }

      const { value, done } = read;
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PayloadTooLargeError('decoded', total, maxBytes);
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
