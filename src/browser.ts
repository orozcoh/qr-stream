export { CameraError, DecoderError, RenderError, isQrStreamError } from './core/errors.js';
export type { FrameDecoder } from './browser/decoder.js';
export {
  renderQrStream,
  quantizeFps,
  estimateTransferSeconds,
  type RenderController,
  type RenderOptions,
} from './browser/render.js';
export { readQrStream, type CameraController, type CameraDevice, type ReadOptions } from './browser/camera.js';
