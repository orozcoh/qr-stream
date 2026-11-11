import { describe, expect, test } from 'vitest';
import { quantizeFps } from '../src/browser/render';

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
