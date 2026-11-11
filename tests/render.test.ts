import { describe, expect, test } from 'vitest';
import { estimateTransferSeconds, quantizeFps } from '../src/browser/render';

describe('quantizeFps', () => {
  test('never exceeds the requested rate', () => {
    expect(quantizeFps(11, 60)).toBe(10);
    expect(quantizeFps(7, 60)).toBe(6);
    expect(quantizeFps(13, 60)).toBe(12);
  });

  test('every result divides the refresh rate', () => {
    for (let fps = 1; fps <= 60; fps += 1) {
      const got = quantizeFps(fps, 60);
      expect(60 % (60 / got)).toBe(0);
      expect(got).toBeLessThanOrEqual(fps);
      expect(got).toBeGreaterThan(0);
    }
  });

  test('a request at the refresh rate is honoured', () => {
    expect(quantizeFps(60, 60)).toBe(60);
  });

  test('handles a 120 Hz display', () => {
    expect(quantizeFps(11, 120)).toBe(10);
    expect(quantizeFps(120, 120)).toBe(120);
  });

  test('clamps nonsense to one frame per second', () => {
    expect(quantizeFps(0.4, 60)).toBe(1);
    expect(quantizeFps(Number.NaN, 60)).toBe(1);
  });
});

describe('estimateTransferSeconds', () => {
  test('scales with block count and frame rate', () => {
    expect(estimateTransferSeconds(100, 10)).toBe(18);
    expect(estimateTransferSeconds(100, 20)).toBe(9);
  });

  test('returns 0 for degenerate input', () => {
    expect(estimateTransferSeconds(0, 10)).toBe(0);
    expect(estimateTransferSeconds(100, 0)).toBe(0);
  });

  test('1 MiB at the fast preset is minutes, not seconds', () => {
    // 1252 blocks at 15 fps with 1.75x fountain overhead.
    expect(estimateTransferSeconds(1252, 15)).toBeGreaterThan(120);
  });
});
