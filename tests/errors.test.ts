import { describe, expect, test } from 'vitest';
import {
  CameraError,
  DecoderError,
  PayloadTooLargeError,
  QrStreamError,
  RenderError,
  WrongKeyError,
  isQrStreamError,
} from '../src/core/errors';
import { decodeMeta, encodeMeta, readVarint, type StreamMeta } from '../src/core/meta';
import { decodePacket, encodePacket } from '../src/core/packet';
import { createQrStreamReader } from '../src/core/reader';
import { createQrStreamWriter } from '../src/core/writer';
import { WrongKeyError as RootWrongKeyError } from '../src/index';

const meta: StreamMeta = {
  filename: 'report.json',
  plainLen: 10,
  wireLen: 10,
  sha256: new Uint8Array(32).fill(3),
  iterations: 0,
};

async function collect(writer: Awaited<ReturnType<typeof createQrStreamWriter>>, count: number) {
  const out: Uint8Array[] = [];
  for await (const packet of writer.packets()) {
    out.push(packet);
    if (out.length === count) break;
  }
  return out;
}

describe('QrStreamError', () => {
  test('a base error carries a stable code, name, message, and recovery', () => {
    const error = new QrStreamError('INVALID_PACKET', 'bad frame');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('QrStreamError');
    expect(error.code).toBe('INVALID_PACKET');
    expect(error.message).toBe('bad frame');
    expect(error.recovery).toBe('none');
  });

  test('recovery is explicit when the throw site knows the next step', () => {
    const error = new QrStreamError('CRYPTO_FAILED', 'hash failed', { recovery: 'retry' });
    expect(error.recovery).toBe('retry');
  });

  test('details are frozen', () => {
    const error = new QrStreamError('INVALID_METADATA', 'bad block', {
      details: { offset: 4 },
    });
    expect(error.details).toEqual({ offset: 4 });
    expect(Object.isFrozen(error.details)).toBe(true);
  });
});

describe('PayloadTooLargeError', () => {
  test('input scope maps to INPUT_TOO_LARGE and change-input', () => {
    const error = new PayloadTooLargeError('input', 2_000_000, 1_048_576);
    expect(error.name).toBe('PayloadTooLargeError');
    expect(error.code).toBe('INPUT_TOO_LARGE');
    expect(error.scope).toBe('input');
    expect(error.actual).toBe(2_000_000);
    expect(error.limit).toBe(1_048_576);
    expect(error.recovery).toBe('change-input');
    expect(error.details).toEqual({ scope: 'input', actual: 2_000_000, limit: 1_048_576 });
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(error.message).toBe('input is 2000000 bytes; the limit is 1048576');
  });

  test('wire scope maps to WIRE_TOO_LARGE and change-input', () => {
    const error = new PayloadTooLargeError('wire', 2_000_000, 1_048_576);
    expect(error.code).toBe('WIRE_TOO_LARGE');
    expect(error.recovery).toBe('change-input');
    expect(error.details).toEqual({ scope: 'wire', actual: 2_000_000, limit: 1_048_576 });
    expect(error.message).toBe('compressed payload is 2000000 bytes; the wire limit is 1048576');
  });

  test('decoded scope maps to DECODED_TOO_LARGE and none', () => {
    const error = new PayloadTooLargeError('decoded', 2_000_000, 1_048_576);
    expect(error.code).toBe('DECODED_TOO_LARGE');
    expect(error.recovery).toBe('none');
    expect(error.details).toEqual({ scope: 'decoded', actual: 2_000_000, limit: 1_048_576 });
    expect(error.message).toBe('decoded payload exceeds the size limit (1048576 bytes)');
  });
});

describe('WrongKeyError', () => {
  test('keeps its name, code, and recovery', () => {
    const error = new WrongKeyError();
    expect(error).toBeInstanceOf(QrStreamError);
    expect(error.name).toBe('WrongKeyError');
    expect(error.code).toBe('WRONG_PASSPHRASE');
    expect(error.recovery).toBe('retry-passphrase');
    expect(error.message).toBe('The passphrase does not match this transfer, or the payload is damaged.');
  });

  test('is still exported from the package root', () => {
    expect(RootWrongKeyError).toBe(WrongKeyError);
  });
});

describe('cause preservation', () => {
  test('a camera error keeps the original DOMException', () => {
    const cause = new DOMException('denied', 'NotAllowedError');
    const error = new CameraError('CAMERA_PERMISSION_DENIED', 'denied', { cause });
    expect(error.cause).toBe(cause);
    expect(error.code).toBe('CAMERA_PERMISSION_DENIED');
    expect(error.recovery).toBe('grant-permission');
    expect(error.name).toBe('CameraError');
  });

  test('decoder and render errors carry their code and default recovery', () => {
    const decoder = new DecoderError('failed to read a frame', { cause: new Error('wasm') });
    expect(decoder.code).toBe('DECODER_FAILED');
    expect(decoder.recovery).toBe('retry');

    const render = new RenderError('canvas 2d context unavailable');
    expect(render.code).toBe('RENDER_FAILED');
    expect(render.recovery).toBe('none');
  });

  test('camera recoveries follow the code', () => {
    expect(new CameraError('CAMERA_NOT_FOUND', 'no camera').recovery).toBe('change-camera');
    expect(new CameraError('TORCH_UNSUPPORTED', 'no torch').recovery).toBe('none');
    expect(new CameraError('DECODER_FAILED', 'decoder died').recovery).toBe('retry');
  });
});

describe('isQrStreamError', () => {
  test('narrows library errors and rejects plain errors and null', () => {
    expect(isQrStreamError(new QrStreamError('INVALID_PACKET', 'x'))).toBe(true);
    expect(isQrStreamError(new WrongKeyError())).toBe(true);
    expect(isQrStreamError(new Error('x'))).toBe(false);
    expect(isQrStreamError(null)).toBe(false);
    expect(isQrStreamError('INVALID_PACKET')).toBe(false);
  });
});

describe('metadata error codes', () => {
  test('a truncated varint is INVALID_METADATA with rescan', () => {
    expect(() => readVarint(Uint8Array.from([0x80]), 0)).toThrow(
      expect.objectContaining({ code: 'INVALID_METADATA', recovery: 'rescan' }),
    );
  });

  test('a non-canonical varint is INVALID_METADATA', () => {
    expect(() => readVarint(Uint8Array.from([0x80, 0x00]), 0)).toThrow(
      expect.objectContaining({ code: 'INVALID_METADATA' }),
    );
  });

  test('a truncated metadata block is INVALID_METADATA', () => {
    const bytes = encodeMeta(meta);
    expect(() => decodeMeta(bytes.subarray(0, bytes.length - 3))).toThrow(
      expect.objectContaining({ code: 'INVALID_METADATA', recovery: 'rescan' }),
    );
  });

  test('an unknown metadata version is UNSUPPORTED_VERSION with upgrade-library', () => {
    const bytes = encodeMeta(meta);
    bytes[0] = 9;
    expect(() => decodeMeta(bytes)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION', recovery: 'upgrade-library' }),
    );
  });
});

describe('reader error boundary', () => {
  test('a wrong passphrase rejects with WrongKeyError', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(400), {
      filename: 'secret.json',
      preset: 'fast',
      passphrase: 'blue seven kilo',
    });
    const reader = createQrStreamReader();
    for (const packet of await collect(writer, writer.k)) reader.add(packet);

    const rejected = reader.result('wrong');
    await expect(rejected).rejects.toBeInstanceOf(WrongKeyError);
    await expect(rejected).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
      recovery: 'retry-passphrase',
    });
  });

  test('a checksum mismatch rejects with PAYLOAD_CORRUPT', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(400).fill(65), {
      filename: 'a.json',
      preset: 'fast',
      sessionId: 9,
    });
    const packets = await collect(writer, writer.k);
    const reader = createQrStreamReader();

    const head = decodePacket(packets[0] as Uint8Array);
    if (head === null) throw new Error('expected a valid first packet');
    const payload = new Uint8Array(head.payload);
    payload[40] = (payload[40] ?? 0) ^ 0xff;
    reader.add(encodePacket({ ...head, payload }));

    for (const packet of packets.slice(1)) reader.add(packet);

    await expect(reader.result()).rejects.toMatchObject({ code: 'PAYLOAD_CORRUPT', recovery: 'rescan' });
  });
});
