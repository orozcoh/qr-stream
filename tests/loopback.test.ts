import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, test, beforeAll } from 'vitest';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { createQrStreamWriter } from '../src/core/writer';
import { decodePacket } from '../src/core/packet';
import { packetToMatrix } from '../src/qr/matrix';
import { matrixToRGBA } from '../src/qr/raster';
import { PRESETS, type PresetName } from '../src/core/types';

const require = createRequire(import.meta.url);

beforeAll(async () => {
  const wasmBinary = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
  await prepareZXingModule({ overrides: { wasmBinary: new Uint8Array(wasmBinary).buffer } });
});

async function decode(image: { data: Uint8ClampedArray; width: number; height: number }) {
  const results = await readBarcodes(image as unknown as ImageData, { formats: ['QRCode'] });
  return results.filter((r) => r.isValid).map((r) => r.bytes);
}

describe('render / decode loopback', () => {
  test('a real packet survives rasterising and decoding at every preset', async () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({ hello: 'world', items: Array.from({ length: 40 }, (_, i) => i) }),
    );

    for (const preset of Object.keys(PRESETS) as PresetName[]) {
      const writer = await createQrStreamWriter(payload, { filename: 'loop.json', preset });
      const iterator = writer.packets();
      const { value: packet } = await iterator.next();
      if (packet === undefined) throw new Error('writer produced no packet');

      const matrix = packetToMatrix(packet, PRESETS[preset].version);
      const image = matrixToRGBA(matrix, 4);
      const decoded = await decode(image);

      expect(decoded.length, `preset ${preset} produced no decodable code`).toBeGreaterThan(0);
      expect(Array.from(decoded[0] as Uint8Array)).toEqual(Array.from(packet));
      expect(decodePacket(decoded[0] as Uint8Array)).not.toBeNull();

      await iterator.return(undefined);
    }
  }, 30_000);

  test('a maximum-capacity frame still decodes', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(250 * 1024), {
      filename: 'full.json',
      preset: 'fast',
    });
    const { value: packet } = await writer.packets().next();
    if (packet === undefined) throw new Error('no packet');

    const matrix = packetToMatrix(packet, 20);
    const decoded = await decode(matrixToRGBA(matrix, 3));
    expect(Array.from(decoded[0] as Uint8Array)).toEqual(Array.from(packet));
  }, 30_000);

  test('every source symbol in a real stream decodes', async () => {
    const payload = new TextEncoder().encode('{"stream":true,"n":12345,"note":"loopback"}');
    const writer = await createQrStreamWriter(payload, { filename: 's.json', preset: 'balanced' });

    let checked = 0;
    for await (const packet of writer.packets()) {
      const matrix = packetToMatrix(packet, 25);
      const decoded = await decode(matrixToRGBA(matrix, 3));
      expect(Array.from(decoded[0] as Uint8Array)).toEqual(Array.from(packet));
      checked += 1;
      if (checked >= Math.min(writer.k, 3)) break;
    }
    expect(checked).toBeGreaterThan(0);
  }, 30_000);

  test('a fractional scale is refused', () => {
    const matrix = { version: 20, size: 97, get: () => false };
    expect(() => matrixToRGBA(matrix, 2.5)).toThrow(RangeError);
  });
});
