import { qrCapacity } from './capacity.js';
import { gzipIfSmaller } from './compress.js';
import { DEFAULT_ITERATIONS, NONCE_BYTES, SALT_BYTES, encryptBytes } from './crypto.js';
import { PayloadTooLargeError, QrStreamError, isQrStreamError } from './errors.js';
import { encodeSymbol } from './fountain.js';
import { GCM_TAG_BYTES, MAX_META_OVERHEAD, resolveTransferLimits } from './limits.js';
import { encodeMeta, sanitizeFilename, writeVarint, type StreamMeta } from './meta.js';
import { FLAG_ENCRYPTED, FLAG_GZIP, encodePacket } from './packet.js';
import { FRAME_OVERHEAD, PRESETS, type PresetName, type TransferLimits } from './types.js';

export interface WriterOptions {
  filename: string;
  preset: PresetName;
  /** Enables encryption. Blank or omitted means the payload travels in the clear. */
  passphrase?: string;
  /** Override for tests; a random 32-bit id otherwise. */
  sessionId?: number;
  /** Transfer budgets. Each value may only tighten the library default. */
  limits?: TransferLimits;
}

export interface QrStreamWriter {
  sessionId: number;
  preset: PresetName;
  /** QR version of the preset. */
  version: number;
  /** Source block count. */
  k: number;
  blockSize: number;
  flags: number;
  meta: StreamMeta;
  /** Original input bytes. */
  plainBytes: number;
  /** Compressed body before encryption; equals `meta.wireLen`. */
  wireBytes: number;
  /** Entire reassembled payload: varint + metadata + wire body (and GCM tag). */
  payloadBytes: number;
  encrypted: boolean;
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
  const limits = resolveTransferLimits(options.limits);

  if (data.length > limits.maxInputBytes) {
    throw new PayloadTooLargeError('input', data.length, limits.maxInputBytes);
  }

  // Compression is the gate that makes oversized raw input legal: only the
  // wire body counts against the transfer budget.
  const compressed = await gzipIfSmaller(data);
  const wireBytes = compressed.data.length;

  // Fail before hashing, metadata encoding, or PBKDF2. A 1 MiB+ payload was
  // already expensive to compress; deriving a key before rejecting it would
  // waste another half second for a transfer that cannot start.
  if (wireBytes > limits.maxWireBytes) {
    throw new PayloadTooLargeError('wire', wireBytes, limits.maxWireBytes);
  }

  const api = requireWebCrypto();
  const digest = await sha256(api, data);

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
  const body = encrypted?.ciphertext ?? compressed.data;

  const payload = new Uint8Array(metaLength.length + metaBytes.length + body.length);
  payload.set(metaLength, 0);
  payload.set(metaBytes, metaLength.length);
  payload.set(body, metaLength.length + metaBytes.length);

  // Defensive: the wire check above bounds the body, so metadata only has to
  // fit its fixed overhead. If this trips, the budget constants are wrong;
  // never hand the sender a stream the reader will reject.
  const payloadBudget = limits.maxWireBytes + MAX_META_OVERHEAD + (hasKey ? GCM_TAG_BYTES : 0);
  if (payload.length > payloadBudget) {
    throw new PayloadTooLargeError('wire', payload.length, payloadBudget);
  }

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
    preset: options.preset,
    version: PRESETS[options.preset].version,
    k,
    blockSize,
    flags,
    meta,
    plainBytes: data.length,
    wireBytes,
    payloadBytes: payload.length,
    encrypted: hasKey,
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
