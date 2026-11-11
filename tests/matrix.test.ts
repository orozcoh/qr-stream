import { describe, expect, test } from 'vitest';
import { packetToMatrix, qrCapacity } from '../src/qr/matrix';

describe('qrCapacity', () => {
  test('matches the specification table at ECC L', () => {
    expect(qrCapacity(20)).toBe(858);
    expect(qrCapacity(25)).toBe(1273);
    expect(qrCapacity(30)).toBe(1732);
    expect(qrCapacity(40)).toBe(2953);
    expect(qrCapacity(1)).toBe(17);
  });

  test('rejects an out-of-range version', () => {
    expect(() => qrCapacity(0)).toThrow(RangeError);
    expect(() => qrCapacity(41)).toThrow(RangeError);
  });
});

describe('packetToMatrix', () => {
  const packet = Uint8Array.from({ length: 40 }, (_, i) => (i * 7) & 0xff);

  test('size follows the version', () => {
    expect(packetToMatrix(packet, 20).size).toBe(97);
    expect(packetToMatrix(packet, 25).size).toBe(117);
    expect(packetToMatrix(packet, 30).size).toBe(137);
  });

  test('is deterministic', () => {
    const a = packetToMatrix(packet, 20);
    const b = packetToMatrix(packet, 20);
    let differences = 0;
    for (let y = 0; y < a.size; y += 1) {
      for (let x = 0; x < a.size; x += 1) {
        if (a.get(x, y) !== b.get(x, y)) differences += 1;
      }
    }
    expect(differences).toBe(0);
  });

  test('has finder patterns in three corners', () => {
    const matrix = packetToMatrix(packet, 20);
    // A finder pattern is a 7x7 ring: dark border, light ring, 3x3 dark core.
    expect(matrix.get(0, 0)).toBe(true);
    expect(matrix.get(6, 6)).toBe(true);
    expect(matrix.get(0, 6)).toBe(true);
    expect(matrix.get(6, 0)).toBe(true);
    expect(matrix.get(1, 1)).toBe(false);
    expect(matrix.get(3, 3)).toBe(true);
  });

  test('rejects a packet larger than the version holds', () => {
    const tooBig = new Uint8Array(qrCapacity(20) + 1);
    expect(() => packetToMatrix(tooBig, 20)).toThrow(RangeError);
  });

  test('accepts a packet that exactly fills the capacity', () => {
    const exact = new Uint8Array(qrCapacity(20));
    for (let i = 0; i < exact.length; i += 1) exact[i] = (i * 13) & 0xff;
    expect(() => packetToMatrix(exact, 20)).not.toThrow();
  });

  test('different packets produce different matrices', () => {
    const a = packetToMatrix(packet, 20);
    const b = packetToMatrix(Uint8Array.from(packet, (v) => v ^ 0xff), 20);
    let differences = 0;
    for (let y = 0; y < a.size; y += 1) {
      for (let x = 0; x < a.size; x += 1) if (a.get(x, y) !== b.get(x, y)) differences += 1;
    }
    expect(differences).toBeGreaterThan(50);
  });
});
