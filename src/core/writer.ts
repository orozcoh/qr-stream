import { gzipIfSmaller } from './compress';
import { encryptBytes } from './crypto';
import { encodeSymbol } from './fountain';
import { encodeMeta, writeVarint, type StreamMeta } from './meta';
import { FLAG_ENCRYPTED, FLAG_GZIP, encodePacket } from './packet';
import { FRAME_OVERHEAD, MAX_INPUT_BYTES, PRESETS, type PresetName } from './types';
import { qrCapacity } from './capacity';

export interface WriterOptions {
  filename: string;
  preset: PresetName;
  /** Enables encryption. Blank or omitted means the payload travels in the clear. */
  passphrase?: string;
  /** Override for tests; a random 32-bit id otherwise. */
  sessionId?: number;
}

export interface QrStreamWriter {
  sessionId: number;
  /** Source block count. */
  k: number;
  blockSize: number;
  flags: number;
  meta: StreamMeta;
  /** Infinite stream of encoded packets, source symbols first. */
  packets(): AsyncGenerator<Uint8Array>;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/**
 * Prepare a payload for optical transmission.
 *
 * Order is fixed: compress, then encrypt, then fountain-encode. Encrypting
 * first would hand gzip incompressible bytes and lose the whole compression win.
 */
export async function createQrStreamWriter(data: Uint8Array, options: WriterOptions): Promise<QrStreamWriter> {
  if (data.length > MAX_INPUT_BYTES) {
    throw new RangeError(`input is ${data.length} bytes; the limit is ${MAX_INPUT_BYTES}`);
  }

  const digest = await sha256(data);
  const compressed = await gzipIfSmaller(data);

  // Normalise before deciding: a passphrase of spaces would otherwise enable
  // encryption with an empty key, showing a filled password field while anyone
  // can decrypt with "".
  const passphrase = options.passphrase?.normalize('NFKC').trim() ?? '';
  const encrypted = passphrase.length > 0 ? await encryptBytes(compressed.data, passphrase) : null;

  const salt = encrypted?.salt;
  const nonce = encrypted?.nonce;
  const meta: StreamMeta = {
    filename: options.filename,
    plainLen: data.length,
    wireLen: compressed.data.length,
    sha256: digest,
    iterations: encrypted?.iterations ?? 0,
    ...(salt ? { salt } : {}),
    ...(nonce ? { nonce } : {}),
  };

  const metaBytes = encodeMeta(meta);
  const metaLength = writeVarint(metaBytes.length);
  const wireBytes = encrypted?.ciphertext ?? compressed.data;

  const payload = new Uint8Array(metaLength.length + metaBytes.length + wireBytes.length);
  payload.set(metaLength, 0);
  payload.set(metaBytes, metaLength.length);
  payload.set(wireBytes, metaLength.length + metaBytes.length);

  const blockSize = qrCapacity(PRESETS[options.preset].version) - FRAME_OVERHEAD;
  const k = Math.max(1, Math.ceil(payload.length / blockSize));

  const blocks: Uint8Array[] = [];
  for (let i = 0; i < k; i += 1) {
    const block = new Uint8Array(blockSize);
    block.set(payload.subarray(i * blockSize, Math.min((i + 1) * blockSize, payload.length)));
    blocks.push(block);
  }

  const flags = (compressed.gzipped ? FLAG_GZIP : 0) | (encrypted ? FLAG_ENCRYPTED : 0);
  const sessionId = options.sessionId ?? crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;

  return {
    sessionId,
    k,
    blockSize,
    flags,
    meta,
    async *packets() {
      for (let symbolIdx = 0; ; symbolIdx += 1) {
        yield encodePacket({
          version: 1,
          flags,
          sessionId,
          symbolIdx: symbolIdx % 0xffff,
          k,
          blockSize,
          payload: encodeSymbol(blocks, sessionId, symbolIdx),
        });
      }
    },
  };
}
