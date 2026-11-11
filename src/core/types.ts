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

/** Largest accepted input, in bytes. */
export const MAX_INPUT_BYTES = 250 * 1024;
