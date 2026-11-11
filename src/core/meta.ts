export interface StreamMeta {
  /** Original file name, at most 64 UTF-8 bytes. */
  filename: string;
  /** Size of the original bytes. */
  plainLen: number;
  /** Size after compression, before encryption. */
  wireLen: number;
  /** SHA-256 of the original bytes; the final correctness gate. */
  sha256: Uint8Array;
  /** Present only when the transfer is encrypted. */
  salt?: Uint8Array;
  /** Present only when the transfer is encrypted. */
  nonce?: Uint8Array;
  /** PBKDF2 iterations, stored so old streams stay readable if the default changes. */
  iterations: number;
}

const META_VERSION = 1;
const MAX_FILENAME_BYTES = 64;
const SHA256_BYTES = 32;

/** Trim to a byte budget without cutting a multi-byte code point in half. */
function truncateUtf8(text: string, maxBytes: number): Uint8Array {
  const full = new TextEncoder().encode(text);
  if (full.length <= maxBytes) return full;

  let end = maxBytes;
  while (end > 0 && ((full[end] as number) & 0b1100_0000) === 0b1000_0000) end -= 1;
  return full.subarray(0, end);
}

export function writeVarint(value: number): Uint8Array {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    out.push(byte);
  } while (rest > 0);
  return Uint8Array.from(out);
}

export function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 1;
  let cursor = offset;
  for (;;) {
    if (cursor >= bytes.length) throw new RangeError('truncated varint');
    const byte = bytes[cursor] as number;
    value += (byte & 0x7f) * shift;
    shift *= 128;
    cursor += 1;
    if ((byte & 0x80) === 0) break;
    if (shift > 2 ** 49) throw new RangeError('varint too large');
  }
  return { value, next: cursor };
}

export function encodeMeta(meta: StreamMeta): Uint8Array {
  const filename = truncateUtf8(meta.filename, MAX_FILENAME_BYTES);
  const salt = meta.salt ?? new Uint8Array(0);
  const nonce = meta.nonce ?? new Uint8Array(0);

  const size = 1 + 1 + filename.length + 4 + 4 + SHA256_BYTES + 2 + salt.length + 2 + nonce.length + 4;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;

  out[offset] = META_VERSION;
  offset += 1;

  out[offset] = filename.length;
  offset += 1;
  out.set(filename, offset);
  offset += filename.length;

  view.setUint32(offset, meta.plainLen);
  offset += 4;
  view.setUint32(offset, meta.wireLen);
  offset += 4;

  if (meta.sha256.length !== SHA256_BYTES) throw new RangeError('sha256 must be 32 bytes');
  out.set(meta.sha256, offset);
  offset += SHA256_BYTES;

  view.setUint16(offset, salt.length);
  offset += 2;
  out.set(salt, offset);
  offset += salt.length;

  view.setUint16(offset, nonce.length);
  offset += 2;
  out.set(nonce, offset);
  offset += nonce.length;

  view.setUint32(offset, meta.iterations);
  return out;
}

export function decodeMeta(bytes: Uint8Array): StreamMeta {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const need = (count: number): void => {
    if (offset + count > bytes.length) throw new RangeError('metadata block truncated');
  };

  need(1);
  const version = bytes[offset] as number;
  if (version !== META_VERSION) throw new RangeError(`unsupported metadata version ${version}`);
  offset += 1;

  need(1);
  const filenameLen = bytes[offset] as number;
  offset += 1;
  need(filenameLen);
  const filename = new TextDecoder().decode(bytes.subarray(offset, offset + filenameLen));
  offset += filenameLen;

  need(8);
  const plainLen = view.getUint32(offset);
  offset += 4;
  const wireLen = view.getUint32(offset);
  offset += 4;

  need(SHA256_BYTES);
  const sha256 = bytes.slice(offset, offset + SHA256_BYTES);
  offset += SHA256_BYTES;

  need(2);
  const saltLen = view.getUint16(offset);
  offset += 2;
  need(saltLen);
  const salt = saltLen > 0 ? bytes.slice(offset, offset + saltLen) : undefined;
  offset += saltLen;

  need(2);
  const nonceLen = view.getUint16(offset);
  offset += 2;
  need(nonceLen);
  const nonce = nonceLen > 0 ? bytes.slice(offset, offset + nonceLen) : undefined;
  offset += nonceLen;

  need(4);
  const iterations = view.getUint32(offset);

  return { filename, plainLen, wireLen, sha256, salt, nonce, iterations };
}
