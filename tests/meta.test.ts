import { describe, expect, test } from 'vitest';
import { decodeMeta, encodeMeta, readVarint, sanitizeFilename, type StreamMeta } from '../src/core/meta';

const base: StreamMeta = {
  filename: 'report.json',
  plainLen: 1234,
  wireLen: 567,
  sha256: new Uint8Array(32).fill(7),
  iterations: 600000,
};

describe('metadata block', () => {
  test('round-trips without encryption fields', () => {
    const decoded = decodeMeta(encodeMeta(base));
    expect(decoded.filename).toBe('report.json');
    expect(decoded.plainLen).toBe(1234);
    expect(decoded.wireLen).toBe(567);
    expect(Array.from(decoded.sha256)).toEqual(Array.from(base.sha256));
    expect(decoded.salt).toBeUndefined();
    expect(decoded.nonce).toBeUndefined();
    expect(decoded.iterations).toBe(600000);
  });

  test('round-trips with salt and nonce', () => {
    const meta: StreamMeta = {
      ...base,
      salt: new Uint8Array(16).fill(1),
      nonce: new Uint8Array(12).fill(2),
    };
    const decoded = decodeMeta(encodeMeta(meta));
    expect(Array.from(decoded.salt as Uint8Array)).toEqual(Array.from(meta.salt as Uint8Array));
    expect(Array.from(decoded.nonce as Uint8Array)).toEqual(Array.from(meta.nonce as Uint8Array));
  });

  test('truncates a long filename to 64 bytes without splitting UTF-8', () => {
    const meta: StreamMeta = { ...base, filename: 'é'.repeat(80) };
    const decoded = decodeMeta(encodeMeta(meta));
    const bytes = new TextEncoder().encode(decoded.filename);
    expect(bytes.length).toBeLessThanOrEqual(64);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow();
  });

  test('keeps an emoji filename intact when it fits', () => {
    const decoded = decodeMeta(encodeMeta({ ...base, filename: 'q📄.json' }));
    expect(decoded.filename).toBe('q📄.json');
  });

  test('throws on a truncated buffer', () => {
    const bytes = encodeMeta(base);
    expect(() => decodeMeta(bytes.subarray(0, bytes.length - 5))).toThrow();
  });

  test('throws on a length field that overruns the buffer', () => {
    const bytes = encodeMeta(base);
    bytes[1] = 200;
    expect(() => decodeMeta(bytes)).toThrow();
  });

  test('rejects an unknown metadata version', () => {
    const bytes = encodeMeta(base);
    bytes[0] = 9;
    expect(() => decodeMeta(bytes)).toThrow();
  });

  test('strips bidi controls and path separators from a filename', () => {
    const decoded = decodeMeta(encodeMeta({ ...base, filename: '..\\evil\u202e.json' }));
    expect(decoded.filename).toBe('..evil.json');
    expect(sanitizeFilename('\u0000')).toBe('payload');
  });

  test('rejects a non-canonical varint', () => {
    expect(() => readVarint(Uint8Array.from([0x80, 0x00]), 0)).toThrow();
  });

  test('rejects trailing bytes after the metadata block', () => {
    const bytes = encodeMeta(base);
    const extended = new Uint8Array(bytes.length + 1);
    extended.set(bytes);
    expect(() => decodeMeta(extended)).toThrow();
  });
});
