export { CameraError, DecoderError, RenderError, isQrStreamError } from './core/errors.js';
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
