export {
  CameraError,
  DecoderError,
  QrStreamError,
  RenderError,
  isQrStreamError,
  type CameraErrorCode,
  type QrStreamErrorCode,
  type QrStreamErrorOptions,
  type QrStreamRecovery,
} from './core/errors.js';
export type { QrStreamWriter } from './core/writer.js';
export type { StreamMeta } from './core/meta.js';
export type { PresetName } from './core/types.js';
export type { FrameDecoder } from './browser/decoder.js';
export {
  renderQrStream,
  quantizeFps,
  estimateTransferSeconds,
  type RenderController,
  type RenderBaseOptions,
  type RenderWriterOptions,
  type RenderPacketsOptions,
  type RenderOptions,
} from './browser/render.js';
export {
  readQrStream,
  type CameraCapabilities,
  type CameraController,
  type CameraDevice,
  type CameraDiagnostics,
  type ReadOptions,
} from './browser/camera.js';
export type { QrRgba, RasterOptions } from './qr/raster.js';
