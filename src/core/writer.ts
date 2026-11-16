import { qrCapacity } from './capacity.js';
import { gzipIfSmaller } from './compress.js';
import { DEFAULT_ITERATIONS, NONCE_BYTES, SALT_BYTES, encryptBytes } from './crypto.js';
import { PayloadTooLargeError, QrStreamError, isQrStreamError } from './errors.js';
import { encodeSymbol } from './fountain.js';
import { encodeMeta, sanitizeFilename, writeVarint, type StreamMeta } from './meta.js';
import { FLAG_ENCRYPTED, FLAG_GZIP, encodePacket } from './packet.js';
import { FRAME_OVERHEAD, MAX_INPUT_BYTES, PRESETS, type PresetName } from './types.js';

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

/** Fail before a crypto call that would otherwise surface an opaque TypeError. */
function requireWebCrypto(): Crypto {
  const api = (globalThis as { crypto?: Crypto }).crypto;
  if (!api?.subtle || typeof api.getRandomValues !== 'function') {
    throw new QrStreamError(
      'UNSUPPORTED_RUNTIME',
      'Web Crypto is not available; use a secure context in a modern browser',
      {
        recovery: 'upgrade-browser',
      },
    );
  }
  return api;
}

async function sha256(api: Crypto, bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await api.subtle.digest('SHA-256', bytes as BufferSource));
  } catch (cause) {
    throw new QrStreamError('CRYPTO_FAILED', 'failed to hash the payload', { cause, recovery: 'retry' });
  }
}

function randomBytes(api: Crypto, length: number): Uint8Array {
  try {
    return api.getRandomValues(new Uint8Array(length));
  } catch (cause) {
    throw new QrStreamError('CRYPTO_FAILED', 'failed to generate random bytes', { cause, recovery: 'retry' });
  }
}

function randomSessionId(api: Crypto): number {
  try {
    return api.getRandomValues(new Uint32Array(1))[0] ?? 1;
  } catch (cause) {
    throw new QrStreamError('CRYPTO_FAILED', 'failed to generate a session id', { cause, recovery: 'retry' });
  }
}

/**
 * Prepare a payload for optical transmission.
 *
 * Order is fixed: compress, then encrypt, then fountain-encode. Encrypting
 * first would hand gzip incompressible bytes and lose the whole compression win.
 */
export async function createQrStreamWriter(data: Uint8Array, options: WriterOptions): Promise<QrStreamWriter> {
  if (data.length > MAX_INPUT_BYTES) {
    throw new PayloadTooLargeError('input', data.length, MAX_INPUT_BYTES);
  }

  const api = requireWebCrypto();
  const digest = await sha256(api, data);
  const compressed = await gzipIfSmaller(data);

  // Normalise before deciding: a passphrase of spaces would otherwise enable
  // encryption with an empty key, showing a filled password field while anyone
  // can decrypt with "".
  const passphrase = options.passphrase?.normalize('NFKC').trim() ?? '';
  const hasKey = passphrase.length > 0;

  // Generate the salt and nonce before the metadata block so the exact encoded
  // metadata can be passed as AES-GCM additional authenticated data.
  const salt = hasKey ? randomBytes(api, SALT_BYTES) : undefined;
  const nonce = hasKey ? randomBytes(api, NONCE_BYTES) : undefined;

  const meta: StreamMeta = {
    filename: sanitizeFilename(options.filename),
    plainLen: data.length,
    wireLen: compressed.data.length,
    sha256: digest,
    iterations: hasKey ? DEFAULT_ITERATIONS : 0,
    ...(salt ? { salt } : {}),
    ...(nonce ? { nonce } : {}),
  };

  const metaBytes = encodeMeta(meta);
  let encrypted: Awaited<ReturnType<typeof encryptBytes>> | null = null;
  if (hasKey) {
    try {
      encrypted = await encryptBytes(compressed.data, passphrase, DEFAULT_ITERATIONS, {
        salt,
        nonce,
        additionalData: metaBytes,
      });
    } catch (cause) {
      if (isQrStreamError(cause)) throw cause;
      throw new QrStreamError('CRYPTO_FAILED', 'failed to encrypt the payload', { cause, recovery: 'retry' });
    }
  }

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
  const sessionId = options.sessionId ?? randomSessionId(api);

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
