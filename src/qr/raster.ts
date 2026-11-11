import type { QrMatrix } from './matrix';

export interface RasterImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/**
 * Expand a module matrix into RGBA pixels.
 *
 * `scale` must be an integer: at a fractional scale the modules land on
 * sub-pixel boundaries, blur into each other, and the code stops decoding.
 * The quiet zone is 4 modules, the QR specification's minimum.
 */
export function matrixToRGBA(matrix: QrMatrix, scale: number, quietZone = 4): RasterImage {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new RangeError(`scale must be a positive integer, got ${scale}`);
  }

  const modules = matrix.size + quietZone * 2;
  const width = modules * scale;
  const height = width;
  const data = new Uint8ClampedArray(width * height * 4);

  // Everything starts light.
  data.fill(255);

  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (!matrix.get(x, y)) continue;
      const left = (x + quietZone) * scale;
      const top = (y + quietZone) * scale;
      for (let py = top; py < top + scale; py += 1) {
        let offset = (py * width + left) * 4;
        for (let px = 0; px < scale; px += 1) {
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 255;
          offset += 4;
        }
      }
    }
  }

  return { data, width, height };
}
