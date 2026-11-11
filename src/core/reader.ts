import { MAX_FRAME_PAYLOAD } from './capacity';
import { gunzip } from './compress';
import { decryptBytes } from './crypto';
import { FountainDecoder } from './fountain';
import { decodeMeta, readVarint, type StreamMeta } from './meta';
import { FLAG_ENCRYPTED, FLAG_GZIP, decodePacket } from './packet';
import { MAX_INPUT_BYTES } from './types';

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
  if (packet.k < 1 || packet.k > 0xffff) return false;
  if (packet.blockSize < 1 || packet.blockSize > MAX_FRAME_PAYLOAD) return false;
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
  let decoder: FountainDecoder | null = null;
  let assembled: Uint8Array | null = null;
  let meta: StreamMeta | null = null;
  let assemblyError: Error | null = null;
  const seen = new Set<number>();

  const reset = (): void => {
    lockedSession = null;
    lockedFlags = 0;
    decoder = null;
    assembled = null;
    meta = null;
    assemblyError = null;
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
      if (parsed.wireLen + GCM_TAG_BYTES > bytes.length) throw new RangeError('wire length exceeds payload');

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
        decoder = new FountainDecoder(packet.k, packet.blockSize, packet.sessionId);
      } else if (packet.sessionId !== lockedSession) {
        return 'stale-session';
      }

      if (seen.has(packet.symbolIdx)) return 'duplicate';
      seen.add(packet.symbolIdx);

      decoder?.add(packet.symbolIdx, packet.payload);
      if (decoder?.isComplete) complete();

      return 'accepted';
    },

    async result(passphrase?: string) {
      if (assemblyError !== null) throw assemblyError;
      if (assembled === null || meta === null) return null;

      const parsed = meta;
      const bytes = assembled;
      const { value: metaLen, next } = readVarint(bytes, 0);
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
        );
      } else {
        wire = body.subarray(0, parsed.wireLen);
      }

      const data = (lockedFlags & FLAG_GZIP) !== 0 ? await gunzip(wire) : wire;

      if (data.length > MAX_INPUT_BYTES) throw new RangeError('decoded payload exceeds the size limit');

      const digest = await sha256(data);
      if (!sameBytes(digest, parsed.sha256)) {
        throw new Error('payload checksum mismatch: the transfer is corrupt, scan it again');
      }

      return { data, meta: parsed };
    },
  };
}
