/** QR code density presets. `version` is the QR version; `fps` is the default cycle rate. */
export type PresetName = 'fast' | 'balanced' | 'dense' | 'extreme';

export interface Preset {
  /** QR version, 20-40. Determines bytes per frame. */
  version: number;
  /** Default frames per second on the sender. */
  fps: number;
}

export const PRESETS: Record<PresetName, Preset> = {
  fast: { version: 20, fps: 15 },
  balanced: { version: 25, fps: 12 },
  dense: { version: 30, fps: 10 },
  extreme: { version: 40, fps: 6 },
};

/** Bytes of packet header, excluding the trailing CRC-32. */
export const HEADER_SIZE = 16;

/** Header plus CRC-32: the number of bytes a frame spends on framing. */
export const FRAME_OVERHEAD = HEADER_SIZE + 4;

/**
 * Largest transfer body the wire format budgets, in bytes.
 *
 * This is the compressed body *before* encryption: metadata, the varint
 * prefix, and the GCM tag are budgeted separately and ride in the fountain
 * padding. 1 MiB of incompressible data at the `fast` preset is K = 1252
 * blocks, which is ~146 seconds of scanning.
 */
export const MAX_WIRE_BYTES = 1024 * 1024;

/**
 * Largest raw input, in bytes, before compression.
 *
 * Input and wire are separate budgets: 8 MiB of JSON typically compresses to
 * well under the 1 MiB wire cap, so the practical ceiling is wall clock and
 * the sender shows the estimate before you start. A host that wants the 0.2
 * raw cap passes `limits: { maxInputBytes: 1024 * 1024 }`.
 */
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;

/** Largest decompressed payload a reader will materialize, in bytes. */
export const MAX_DECODED_BYTES = 8 * 1024 * 1024;

/**
 * Budgets for the sender. Each value may only tighten the library default;
 * values that are not positive integers at or below the hard ceiling are
 * rejected with `INVALID_ARGUMENT`.
 */
export interface TransferLimits {
  /** Compressed body before encryption. Default and ceiling: `MAX_WIRE_BYTES`. */
  maxWireBytes?: number;
  /** Original input bytes. Default and ceiling: `MAX_INPUT_BYTES`. */
  maxInputBytes?: number;
}

/**
 * Budgets for the reader. Limits are initial configuration for a reader
 * instance, not a per-frame setting.
 */
export interface ReaderLimits {
  /** Compressed body declared by the sender. Default and ceiling: `MAX_WIRE_BYTES`. */
  maxWireBytes?: number;
  /** Decompressed output. Default and ceiling: `MAX_DECODED_BYTES`. */
  maxDecodedBytes?: number;
}
