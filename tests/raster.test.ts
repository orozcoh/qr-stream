import { describe, expect, test } from 'vitest';
import type { QrMatrix } from '../src/qr/matrix';
import { matrixToRGBA, type RasterOptions } from '../src/qr/raster';

/** A 2x2 matrix whose only dark module is the top-left one. */
const matrix: QrMatrix = {
  version: 1,
  size: 2,
  get: (x: number, y: number) => x === 0 && y === 0,
};

function rgbaAt(data: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return Array.from(data.slice(offset, offset + 4));
}

function catchCode(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return null;
}

describe('matrixToRGBA defaults', () => {
  test('stays black on white with a four-module quiet zone', () => {
    const image = matrixToRGBA(matrix, 1);

    // 2 modules plus 4 modules of quiet zone on each side.
    expect(image.width).toBe(10);
    expect(image.height).toBe(10);

    // The quiet zone and the unused modules are white.
    expect(rgbaAt(image.data, image.width, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(rgbaAt(image.data, image.width, 9, 9)).toEqual([255, 255, 255, 255]);

    // Module (0, 0) starts after the quiet zone; module (1, 0) stays light.
    expect(rgbaAt(image.data, image.width, 4, 4)).toEqual([0, 0, 0, 255]);
    expect(rgbaAt(image.data, image.width, 5, 4)).toEqual([255, 255, 255, 255]);
  });

  test('still accepts a numeric third argument as the quiet zone', () => {
    expect(matrixToRGBA(matrix, 1, 0).width).toBe(2);
    expect(matrixToRGBA(matrix, 1, 2).width).toBe(6);
  });
});

describe('matrixToRGBA colors', () => {
  test('applies custom dark and light colors to modules and quiet zone', () => {
    const image = matrixToRGBA(matrix, 1, {
      dark: [10, 20, 30, 255],
      light: [240, 230, 220, 255],
    });

    // The light color fills the quiet zone and the light modules.
    expect(rgbaAt(image.data, image.width, 0, 0)).toEqual([240, 230, 220, 255]);
    expect(rgbaAt(image.data, image.width, 9, 9)).toEqual([240, 230, 220, 255]);
    // Module (0, 0) carries the dark color.
    expect(rgbaAt(image.data, image.width, 4, 4)).toEqual([10, 20, 30, 255]);
  });

  test('falls back to defaults for a missing dark or light color', () => {
    const darkOnly = matrixToRGBA(matrix, 1, { dark: [10, 20, 30, 255] });
    expect(rgbaAt(darkOnly.data, darkOnly.width, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(rgbaAt(darkOnly.data, darkOnly.width, 4, 4)).toEqual([10, 20, 30, 255]);

    const lightOnly = matrixToRGBA(matrix, 1, { light: [240, 230, 220, 255] });
    expect(rgbaAt(lightOnly.data, lightOnly.width, 0, 0)).toEqual([240, 230, 220, 255]);
    expect(rgbaAt(lightOnly.data, lightOnly.width, 4, 4)).toEqual([0, 0, 0, 255]);
  });

  test('honours quietZone in the options object', () => {
    const image = matrixToRGBA(matrix, 2, { quietZone: 0 });
    expect(image.width).toBe(4);
    expect(rgbaAt(image.data, image.width, 0, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe('matrixToRGBA validation', () => {
  test('a fractional scale is INVALID_SCALE', () => {
    expect(catchCode(() => matrixToRGBA(matrix, 2.5))).toBe('INVALID_SCALE');
    expect(catchCode(() => matrixToRGBA(matrix, 0))).toBe('INVALID_SCALE');
  });

  test('an invalid channel is INVALID_ARGUMENT', () => {
    expect(catchCode(() => matrixToRGBA(matrix, 1, { dark: [256, 0, 0, 255] }))).toBe('INVALID_ARGUMENT');
    expect(catchCode(() => matrixToRGBA(matrix, 1, { light: [0, 0, 0, -1] }))).toBe('INVALID_ARGUMENT');
    expect(catchCode(() => matrixToRGBA(matrix, 1, { dark: [1.5, 0, 0, 255] }))).toBe('INVALID_ARGUMENT');
  });

  test('a color without four channels is INVALID_ARGUMENT', () => {
    const short = [0, 0, 0] as unknown as RasterOptions['dark'];
    expect(catchCode(() => matrixToRGBA(matrix, 1, { dark: short }))).toBe('INVALID_ARGUMENT');
  });

  test('a fractional or negative quiet zone is INVALID_ARGUMENT', () => {
    expect(catchCode(() => matrixToRGBA(matrix, 1, 2.5))).toBe('INVALID_ARGUMENT');
    expect(catchCode(() => matrixToRGBA(matrix, 1, -1))).toBe('INVALID_ARGUMENT');
    expect(catchCode(() => matrixToRGBA(matrix, 1, { quietZone: 2.5 }))).toBe('INVALID_ARGUMENT');
    expect(catchCode(() => matrixToRGBA(matrix, 1, { quietZone: -4 }))).toBe('INVALID_ARGUMENT');
  });
});
