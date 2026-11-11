import { describe, expect, test } from 'vitest';
import {
  FRAME_OVERHEAD,
  HEADER_SIZE,
  MAX_INPUT_BYTES,
  PRESETS,
} from '../src/core/types';

describe('shared constants', () => {
  test('header is 16 bytes and full frame overhead is 20', () => {
    expect(HEADER_SIZE).toBe(16);
    expect(FRAME_OVERHEAD).toBe(20);
  });

  test('presets pin their QR version', () => {
    expect(PRESETS.fast.version).toBe(20);
    expect(PRESETS.balanced.version).toBe(25);
    expect(PRESETS.dense.version).toBe(30);
    expect(PRESETS.extreme.version).toBe(40);
  });

  test('input cap is 250 KiB', () => {
    expect(MAX_INPUT_BYTES).toBe(256000);
  });
});
