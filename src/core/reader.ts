import { gunzip } from './compress';
import { decryptBytes } from './crypto';
import { FountainDecoder } from './fountain';
import { decodeMeta, readVarint, type StreamMeta } from './meta';
import { FLAG_ENCRYPTED, FLAG_GZIP, decodePacket } from './packet';

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

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

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
  const seen = new Set<number>();

  const reset = (): void => {
    lockedSession = null;
    lockedFlags = 0;
    decoder = null;
    assembled = null;
    meta = null;
    seen.clear();
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

      if (lockedSession === null) {
        lockedSession = packet.sessionId;
        lockedFlags = packet.flags;
        decoder = new FountainDecoder(packet.k, packet.blockSize, packet.sessionId);
      } else if (packet.sessionId !== lockedSession) {
        return 'stale-session';
      }

      const key = packet.symbolIdx;
      if (seen.has(key)) return 'duplicate';
      seen.add(key);

      decoder?.add(packet.symbolIdx, packet.payload);

      if (decoder?.isComplete && assembled === null) {
        assembled = decoder.assemble();
        if (assembled !== null) {
          const { value: metaLen, next } = readVarint(assembled, 0);
          meta = decodeMeta(assembled.subarray(next, next + metaLen));
        }
      }

      return 'accepted';
    },

    async result(passphrase?: string) {
      if (assembled === null || meta === null) return null;

      const { value: metaLen, next } = readVarint(assembled, 0);
      const body = assembled.subarray(next + metaLen);
      const encrypted = (lockedFlags & FLAG_ENCRYPTED) !== 0;

      let wire: Uint8Array;
      if (encrypted) {
        const end = meta.wireLen + GCM_TAG_BYTES;
        wire = await decryptBytes(
          body.subarray(0, end),
          passphrase ?? '',
          meta.salt as Uint8Array,
          meta.nonce as Uint8Array,
          meta.iterations,
        );
      } else {
        wire = body.subarray(0, meta.wireLen);
      }

      const data = (lockedFlags & FLAG_GZIP) !== 0 ? await gunzip(wire) : wire;

      const digest = await sha256(data);
      if (!sameBytes(digest, meta.sha256)) {
        throw new Error('payload checksum mismatch: the transfer is corrupt, scan it again');
      }

      return { data, meta };
    },
  };
}
