import { QrStreamError } from '../core/errors.js';
import type { QrMatrix } from './matrix.js';

export interface RasterImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** One pixel in RGBA order, each channel an integer from 0 to 255. */
export type QrRgba = readonly [red: number, green: number, blue: number, alpha: number];

export interface RasterOptions {
  /** Quiet zone in modules. Defaults to 4, the QR specification's minimum. */
  quietZone?: number;
  /**
   * Color of a set module. Defaults to opaque black. It must be darker than
   * `light`; an inverted code is not guaranteed to decode.
   */
  dark?: QrRgba;
  /**
   * Color of an unset module and the quiet zone. Defaults to opaque white.
   * It fills the whole bitmap, including the quiet zone.
   */
  light?: QrRgba;
}

const DEFAULT_DARK: QrRgba = [0, 0, 0, 255];
const DEFAULT_LIGHT: QrRgba = [255, 255, 255, 255];
const DEFAULT_QUIET_ZONE = 4;

interface ResolvedRasterOptions {
  quietZone: number;
  dark: QrRgba;
  light: QrRgba;
}

function invalidArgument(message: string): QrStreamError {
  return new QrStreamError('INVALID_ARGUMENT', message);
}

/** A fractional quiet zone would shift the module grid off pixel boundaries. */
function resolveQuietZone(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw invalidArgument(`quietZone must be a non-negative integer, got ${value}`);
  }
  return value;
}

function resolveColor(name: string, value: QrRgba | undefined, fallback: QrRgba): QrRgba {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length !== 4) {
    throw invalidArgument(`${name} must be a [red, green, blue, alpha] tuple`);
  }
  for (const channel of value) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw invalidArgument(`${name} channels must be integers from 0 to 255`);
    }
  }
  return value;
}

function resolveOptions(options: number | RasterOptions | undefined): ResolvedRasterOptions {
  if (typeof options === 'number') {
    return { quietZone: resolveQuietZone(options), dark: DEFAULT_DARK, light: DEFAULT_LIGHT };
  }

  const settings = options ?? {};
  return {
    quietZone: settings.quietZone === undefined ? DEFAULT_QUIET_ZONE : resolveQuietZone(settings.quietZone),
    dark: resolveColor('dark', settings.dark, DEFAULT_DARK),
    light: resolveColor('light', settings.light, DEFAULT_LIGHT),
  };
}

function isOpaqueWhite(color: QrRgba): boolean {
  return color[0] === 255 && color[1] === 255 && color[2] === 255 && color[3] === 255;
}

/**
 * Expand a module matrix into RGBA pixels.
 *
 * `scale` must be an integer: at a fractional scale the modules land on
 * sub-pixel boundaries, blur into each other, and the code stops decoding.
 * The quiet zone is 4 modules, the QR specification's minimum.
 *
 * A numeric third argument is the quiet zone. Pass an options object to change
 * the colors; dark modules must be darker than light ones, or the code is not
 * guaranteed to decode.
 */
export function matrixToRGBA(matrix: QrMatrix, scale: number, options?: number | RasterOptions): RasterImage {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new QrStreamError('INVALID_SCALE', `scale must be a positive integer, got ${scale}`);
  }

  const { quietZone, dark, light } = resolveOptions(options);
  const modules = matrix.size + quietZone * 2;
  const width = modules * scale;
  const height = width;
  const data = new Uint8ClampedArray(width * height * 4);

  // Everything starts light, including the quiet zone.
  if (isOpaqueWhite(light)) {
    data.fill(255);
  } else {
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = light[0];
      data[offset + 1] = light[1];
      data[offset + 2] = light[2];
      data[offset + 3] = light[3];
    }
  }

  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (!matrix.get(x, y)) continue;
      const left = (x + quietZone) * scale;
      const top = (y + quietZone) * scale;
      for (let py = top; py < top + scale; py += 1) {
        let offset = (py * width + left) * 4;
        for (let px = 0; px < scale; px += 1) {
          data[offset] = dark[0];
          data[offset + 1] = dark[1];
          data[offset + 2] = dark[2];
          data[offset + 3] = dark[3];
          offset += 4;
        }
      }
    }
  }

  return { data, width, height };
}
