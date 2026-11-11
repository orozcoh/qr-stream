import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import type { FrameDecoder } from '../decoder';

export interface ZXingDecoderOptions {
  /**
   * Location of `zxing_reader.wasm`. Without it the library falls back to a
   * CDN, which works online and fails silently offline.
   */
  wasmUrl?: string;
}

/**
 * ZXing-C++ compiled to WebAssembly: ~925 KB, and the only decoder here that
 * returns raw **bytes** rather than text.
 *
 * That matters more than it sounds. `BarcodeDetector`, the zero-dependency
 * alternative, exposes only `rawValue` as a string — measured against a real
 * binary packet it detects the code and returns an empty string, because the
 * payload is not valid UTF-8. A packet is binary by construction (magic, u32
 * fields, CRC), so a text-only API cannot carry it.
 */
export async function createZXingDecoder(options: ZXingDecoderOptions = {}): Promise<FrameDecoder> {
  const { wasmUrl } = options;

  if (wasmUrl) {
    await prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });
  }

  return {
    async decode(image: ImageData): Promise<Uint8Array | null> {
      const results = await readBarcodes(image, { formats: ['QRCode'] });
      for (const result of results) {
        if (result.isValid && result.bytes.length > 0) return result.bytes;
      }
      return null;
    },
  };
}
