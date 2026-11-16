import { describe, expect, test } from 'vitest';
import {
  FRAME_OVERHEAD,
  HEADER_SIZE,
  MAX_DECODED_BYTES,
  MAX_INPUT_BYTES,
  MAX_WIRE_BYTES,
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

  test('transfer limits are 1 MiB on the wire and 8 MiB in and out', () => {
    expect(MAX_WIRE_BYTES).toBe(1048576);
    expect(MAX_INPUT_BYTES).toBe(8388608);
    expect(MAX_DECODED_BYTES).toBe(8388608);
  });
});
