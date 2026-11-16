export {
  MAX_DECODED_BYTES,
  MAX_INPUT_BYTES,
  MAX_WIRE_BYTES,
  PRESETS,
  type Preset,
  type PresetName,
  type ReaderLimits,
  type TransferLimits,
} from './core/types.js';
export {
  CameraError,
  DecoderError,
  PayloadTooLargeError,
  QrStreamError,
  RenderError,
  WrongKeyError,
  isQrStreamError,
  type CameraErrorCode,
  type PayloadScope,
  type QrStreamErrorCode,
  type QrStreamErrorOptions,
  type QrStreamRecovery,
} from './core/errors.js';
export { gzipIfSmaller, gunzip } from './core/compress.js';
export type { StreamMeta } from './core/meta.js';
export { createQrStreamWriter, type WriterOptions, type QrStreamWriter } from './core/writer.js';
export {
  createQrStreamReader,
  type QrStreamReader,
  type QrStreamReaderOptions,
  type AddResult,
} from './core/reader.js';
