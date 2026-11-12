import { MAX_FRAME_PAYLOAD, qrCapacity } from './capacity';
import { gunzip } from './compress';
import { NONCE_BYTES, SALT_BYTES, decryptBytes } from './crypto';
import { FountainDecoder } from './fountain';
import { decodeMeta, readVarint, type StreamMeta } from './meta';
import { FLAG_ENCRYPTED, FLAG_GZIP, decodePacket } from './packet';
import { FRAME_OVERHEAD, MAX_INPUT_BYTES, PRESETS } from './types';

export type AddResult = 'accepted' | 'duplicate' | 'stale-session' | 'invalid';

export interface QrStreamReader {
  /** The session this reader has locked onto, or null before the first frame. */
  sessionId(): number | null;
  add(packetBytes: Uint8Array): AddResult;
  progress(): { solved: number; k: number };
  /** Forgets everything, including the session lock. */
  reset(): void;
  /** Resolves to null until every block has arrived. */
  result(passphrase?: string): Promise<{ data: Uint8Array; meta: StreamMeta } | null>;
}

const GCM_TAG_BYTES = 16;
const WIRE_VERSION = 1;
const RESERVED_FLAGS = ~(FLAG_GZIP | FLAG_ENCRYPTED) & 0xff;
const MAX_KDF_ITERATIONS = 2_000_000;
const MAX_META_OVERHEAD = 256;

/**
 * The writer caps a frame at `qrCapacity(version) - FRAME_OVERHEAD`. The
 * version-40 / ECC-L table value (2953) is the raw QR capacity, not a legal
 * packet payload, so the receiver must use the smaller writer bound.
 */
const MAX_BLOCK_SIZE = MAX_FRAME_PAYLOAD - FRAME_OVERHEAD;
const MIN_PRESET_BLOCK_SIZE = qrCapacity(PRESETS.fast.version) - FRAME_OVERHEAD;

/**
 * The largest payload a legal 1 MiB transfer can produce, including metadata,
 * the varint prefix, and the GCM tag. `k * blockSize` is checked against this
 * plus one block of zero padding.
 */
const MAX_STREAM_BYTES = MAX_INPUT_BYTES + MAX_META_OVERHEAD + GCM_TAG_BYTES;

/**
 * Largest source-block count a legal stream can declare. At the smallest
 * preset a 1 MiB transfer needs ~1252 blocks; accepting the u16 limit (65535)
 * lets a 21-byte frame drive the fountain decoder's superlinear work.
 */
export const MAX_SOURCE_BLOCKS = Math.ceil(MAX_STREAM_BYTES / MIN_PRESET_BLOCK_SIZE);

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Everything a peer frame claims about the stream, checked before we trust it. */
function isPlausible(packet: {
  version: number;
  flags: number;
  k: number;
  blockSize: number;
  payload: Uint8Array;
}): boolean {
  if (packet.version !== WIRE_VERSION) return false;
  if ((packet.flags & RESERVED_FLAGS) !== 0) return false;
  if (packet.k < 1 || packet.k > MAX_SOURCE_BLOCKS) return false;
  if (packet.blockSize < 1 || packet.blockSize > MAX_BLOCK_SIZE) return false;
  // A legal stream can be at most MAX_STREAM_BYTES of payload, plus the padding
  // of the final block. This rejects a peer that declares a huge K with a large
  // blockSize even when each individual field is within its type's range.
  if (packet.k * packet.blockSize > MAX_STREAM_BYTES + packet.blockSize) return false;
  // The writer always pads to blockSize, so a short payload is malformed even
  // for the final source block. Rejecting it here keeps a later good copy from
  // being swallowed as a duplicate.
  if (packet.payload.length !== packet.blockSize) return false;
  return true;
}

/**
 * Reassembles a stream from whatever frames the camera managed to read.
 *
 * The reader locks to the first `sessionId` it sees so a stray stream in the
 * room cannot contaminate an in-progress transfer, and keeps the reassembled
 * ciphertext after a failed decrypt so a mistyped passphrase costs a retype,
 * not another scan.
 */
export function createQrStreamReader(): QrStreamReader {
  let lockedSession: number | null = null;
  let lockedFlags = 0;
  let lockedK = 0;
  let lockedBlockSize = 0;
  let decoder: FountainDecoder | null = null;
  let assembled: Uint8Array | null = null;
  let meta: StreamMeta | null = null;
  let assemblyError: Error | null = null;
  let generation = 0;
  let cachedResult: { data: Uint8Array; meta: StreamMeta } | null = null;
  const seen = new Set<number>();

  const reset = (): void => {
    lockedSession = null;
    lockedFlags = 0;
    lockedK = 0;
    lockedBlockSize = 0;
    decoder = null;
    assembled = null;
    meta = null;
    assemblyError = null;
    cachedResult = null;
    generation += 1;
    seen.clear();
  };

  const complete = (): void => {
    if (assembled !== null || assemblyError !== null) return;
    const bytes = decoder?.assemble() ?? null;
    if (bytes === null) return;

    try {
      const { value: metaLen, next } = readVarint(bytes, 0);
      if (metaLen > bytes.length - next) throw new RangeError('metadata length exceeds payload');
      const parsed = decodeMeta(bytes.subarray(next, next + metaLen));

      if (parsed.plainLen > MAX_INPUT_BYTES) throw new RangeError('advertised size exceeds the limit');
      if (parsed.iterations > MAX_KDF_ITERATIONS) throw new RangeError('absurd KDF iteration count');

      const bodyLen = bytes.length - next - metaLen;
      const encrypted = (lockedFlags & FLAG_ENCRYPTED) !== 0;
      const requiredWire = parsed.wireLen + (encrypted ? GCM_TAG_BYTES : 0);
      if (requiredWire > bodyLen) throw new RangeError('wire length exceeds payload');

      if (encrypted) {
        if (
          parsed.salt?.length !== SALT_BYTES ||
          parsed.nonce?.length !== NONCE_BYTES ||
          parsed.iterations < 1
        ) {
          throw new RangeError('invalid encryption parameters in metadata');
        }
      }

      assembled = bytes;
      meta = parsed;
    } catch (cause) {
      assemblyError = cause instanceof Error ? cause : new Error(String(cause));
    }
  };

  return {
    sessionId: () => lockedSession,

    progress() {
      return { solved: decoder?.solvedCount ?? 0, k: decoder?.sourceCount ?? 0 };
    },

    reset,

    add(packetBytes: Uint8Array): AddResult {
      const packet = decodePacket(packetBytes);
      if (packet === null) return 'invalid';
      if (!isPlausible(packet)) return 'invalid';

      if (lockedSession === null) {
        lockedSession = packet.sessionId;
        lockedFlags = packet.flags;
        lockedK = packet.k;
        lockedBlockSize = packet.blockSize;
        decoder = new FountainDecoder(packet.k, packet.blockSize, packet.sessionId);
      } else {
        if (packet.sessionId !== lockedSession) return 'stale-session';
        // K, blockSize, and flags are session constants. A frame that disagrees
        // is malformed and must not burn a symbol index in `seen`.
        if (packet.k !== lockedK || packet.blockSize !== lockedBlockSize || packet.flags !== lockedFlags) {
          return 'invalid';
        }
      }

      // The payload cannot change once assembled. Further frames are pure work.
      if (assembled !== null || assemblyError !== null) return 'duplicate';
      if (seen.has(packet.symbolIdx)) return 'duplicate';

      decoder?.add(packet.symbolIdx, packet.payload);
      seen.add(packet.symbolIdx);
      if (decoder?.isComplete) complete();

      return 'accepted';
    },

    async result(passphrase?: string) {
      if (assemblyError !== null) throw assemblyError;
      if (assembled === null || meta === null) return null;
      if (cachedResult !== null) return cachedResult;

      const myGeneration = generation;
      const parsed = meta;
      const bytes = assembled;
      const { value: metaLen, next } = readVarint(bytes, 0);
      const metaBytes = bytes.subarray(next, next + metaLen);
      const body = bytes.subarray(next + metaLen);
      const encrypted = (lockedFlags & FLAG_ENCRYPTED) !== 0;

      let wire: Uint8Array;
      if (encrypted) {
        wire = await decryptBytes(
          body.subarray(0, parsed.wireLen + GCM_TAG_BYTES),
          passphrase ?? '',
          parsed.salt as Uint8Array,
          parsed.nonce as Uint8Array,
          parsed.iterations,
          metaBytes,
        );
        if (generation !== myGeneration) return null;
      } else {
        wire = body.subarray(0, parsed.wireLen);
      }

      const data = (lockedFlags & FLAG_GZIP) !== 0 ? await gunzip(wire) : wire;
      if (generation !== myGeneration) return null;

      if (data.length > MAX_INPUT_BYTES) throw new RangeError('decoded payload exceeds the size limit');
      if (data.length !== parsed.plainLen) {
        throw new RangeError('decoded length does not match metadata plainLen');
      }

      const digest = await sha256(data);
      if (generation !== myGeneration) return null;
      if (!sameBytes(digest, parsed.sha256)) {
        throw new Error('payload checksum mismatch: the transfer is corrupt, scan it again');
      }

      cachedResult = { data, meta: parsed };
      return cachedResult;
    },
  };
}
