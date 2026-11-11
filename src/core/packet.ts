import { crc32 } from './crc32';
import { HEADER_SIZE } from './types';

/** "QS" — rejects QR codes that belong to something else. */
export const MAGIC = 0x5153;

export const FLAG_GZIP = 1;
export const FLAG_ENCRYPTED = 2;

export interface Packet {
  version: number;
  flags: number;
  /** Random per transfer; the reader locks to the first one it sees. */
  sessionId: number;
  /** `< k` is a raw source block; `>= k` is a repair symbol. */
  symbolIdx: number;
  /** Source block count. */
  k: number;
  /** Bytes per padded block. */
  blockSize: number;
  /** Meaningful bytes; only the final source block is shorter than blockSize. */
  payload: Uint8Array;
}

/**
 * Encode a packet. Layout, big-endian:
 * `magic u16 | version u8 | flags u8 | sessionId u32 | symbolIdx u16 |
 *  k u16 | blockSize u16 | payloadLen u16 | payload | crc32 u32`
 */
export function encodePacket(packet: Packet): Uint8Array {
  const { payload } = packet;
  const bytes = new Uint8Array(HEADER_SIZE + payload.length + 4);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, MAGIC);
  view.setUint8(2, packet.version);
  view.setUint8(3, packet.flags);
  view.setUint32(4, packet.sessionId);
  view.setUint16(8, packet.symbolIdx);
  view.setUint16(10, packet.k);
  view.setUint16(12, packet.blockSize);
  view.setUint16(14, payload.length);
  bytes.set(payload, HEADER_SIZE);
  view.setUint32(HEADER_SIZE + payload.length, crc32(bytes.subarray(0, HEADER_SIZE + payload.length)));

  return bytes;
}

/**
 * Decode a packet, returning `null` for anything that is not a well-formed
 * frame of this format: wrong magic, wrong length, or a CRC mismatch.
 */
export function decodePacket(bytes: Uint8Array): Packet | null {
  if (bytes.length < HEADER_SIZE + 4) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0) !== MAGIC) return null;

  const payloadLen = view.getUint16(14);
  if (bytes.length !== HEADER_SIZE + payloadLen + 4) return null;

  const blockSize = view.getUint16(12);
  if (payloadLen > blockSize) return null;

  const expected = view.getUint32(HEADER_SIZE + payloadLen);
  const actual = crc32(bytes.subarray(0, HEADER_SIZE + payloadLen));
  if (expected !== actual) return null;

  return {
    version: view.getUint8(2),
    flags: view.getUint8(3),
    sessionId: view.getUint32(4),
    symbolIdx: view.getUint16(8),
    k: view.getUint16(10),
    blockSize,
    payload: bytes.slice(HEADER_SIZE, HEADER_SIZE + payloadLen),
  };
}
