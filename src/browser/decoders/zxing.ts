import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { DecoderError, QrStreamError } from '../../core/errors.js';
import type { FrameDecoder } from '../decoder.js';

export type { FrameDecoder };

export interface ZXingDecoderOptions {
  /**
   * Location of `zxing_reader.wasm`. Required: the library's implicit CDN
   * fallback works online and fails silently offline.
   */
  wasmUrl: string;
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
export async function createZXingDecoder(options: ZXingDecoderOptions): Promise<FrameDecoder> {
  const wasmUrl = options?.wasmUrl;
  if (typeof wasmUrl !== 'string' || wasmUrl.trim() === '') {
    throw new QrStreamError('INVALID_ARGUMENT', 'wasmUrl is required', { recovery: 'none' });
  }

  try {
    await prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });
  } catch (cause) {
    throw new DecoderError('the ZXing wasm module could not be prepared', { cause });
  }

  return {
    async decode(image: ImageData): Promise<Uint8Array | null> {
      let results: Awaited<ReturnType<typeof readBarcodes>>;
      try {
        results = await readBarcodes(image, { formats: ['QRCode'] });
      } catch (cause) {
        throw new DecoderError('the QR decoder failed to read a frame', { cause });
      }
      for (const result of results) {
        if (result.isValid && result.bytes.length > 0) return result.bytes;
      }
      return null;
    },
  };
}
