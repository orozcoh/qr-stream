import { QrStreamError, RenderError } from '../core/errors.js';
import { PRESETS } from '../core/types.js';
import type { QrStreamWriter } from '../core/writer.js';
import { packetToMatrix } from '../qr/matrix.js';
import { matrixToRGBA, resolveRasterOptions, type RasterOptions } from '../qr/raster.js';

/**
 * Snap a requested frame rate to a divisor of the display refresh rate.
 *
 * A code shown for a non-integer number of refreshes gets captured mid-switch
 * on some frames — blur that never decodes. Holding each code for a whole
 * number of refreshes is the only way to guarantee a clean capture, and never
 * exceeding the request keeps the sender honest about its own rate.
 */
export function quantizeFps(fps: number, refreshHz = 60): number {
  if (!Number.isFinite(fps) || fps <= 0) return 1;

  let best = 1;
  for (let refreshes = 1; refreshes <= refreshHz; refreshes += 1) {
    if (refreshHz % refreshes !== 0) continue;
    const candidate = refreshHz / refreshes;
    if (candidate <= fps && candidate > best) best = candidate;
  }
  return best;
}

/**
 * Rough wall clock for a transfer, in seconds.
 *
 * `overhead` is the fountain's measured cost: a receiver needs about 1.75x the
 * block count in symbols before it can close. Showing this up front is the only
 * honest way to present a 1 MiB payload, which is minutes of scanning.
 */
export function estimateTransferSeconds(k: number, fps: number, overhead = 1.75): number {
  if (k <= 0 || fps <= 0) return 0;
  return Math.ceil((k * overhead) / fps);
}

export interface RenderController {
  play(): void;
  pause(): void;
  setFps(fps: number): void;
  stop(): void;
  /** Frames actually painted since `play()`. */
  framesPainted(): number;
}

export interface RenderBaseOptions {
  canvas: HTMLCanvasElement;
  /** Target frame rate. Writer mode defaults to the preset's rate. */
  fps?: number;
  /** Display refresh rate used to quantise `fps`. Defaults to 60. */
  refreshHz?: number;
  /**
   * Target CSS width in pixels. Overrides the parent measurement and snaps
   * down to an integer module scale, so the result may be slightly smaller.
   */
  size?: number;
  /** Module and quiet-zone colors. Defaults to black on white. */
  colors?: RasterOptions;
}

/**
 * Bind the renderer to a writer so the QR version cannot drift.
 *
 * The writer is the single source of truth for the version it encoded into its
 * packets; passing one alongside `packets` would let the two disagree.
 */
export interface RenderWriterOptions extends RenderBaseOptions {
  writer: QrStreamWriter;
  packets?: never;
  version?: never;
}

/** Low-level form: paint an arbitrary packet stream at an explicit version. */
export interface RenderPacketsOptions extends RenderBaseOptions {
  packets: AsyncIterable<Uint8Array>;
  version: number;
  writer?: never;
  fps: number;
}

export type RenderOptions = RenderWriterOptions | RenderPacketsOptions;

interface ResolvedStream {
  packets: AsyncIterable<Uint8Array>;
  version: number;
  fps: number;
}

/**
 * Collapse the union into one shape.
 *
 * Exactly one mode must be present. A writer carries its own version and
 * default rate, so a host cannot pair the wrong version with a writer's
 * packets by accident.
 */
function resolveStream(options: RenderOptions): ResolvedStream {
  const hasWriter = options.writer !== undefined;
  const hasPackets = options.packets !== undefined;

  if (hasWriter === hasPackets) {
    throw new QrStreamError('INVALID_ARGUMENT', 'renderQrStream takes either a writer or raw packets, not both');
  }

  if (hasWriter) {
    const { writer } = options as RenderWriterOptions;
    return {
      packets: writer.packets(),
      version: writer.version,
      fps: options.fps ?? PRESETS[writer.preset].fps,
    };
  }

  const raw = options as RenderPacketsOptions;
  return { packets: raw.packets, version: raw.version, fps: raw.fps };
}

/** Packets kept ready ahead of the paint loop. Enough to absorb jitter, not more. */
const QUEUE_CAP = 3;

/**
 * Animate packets into a canvas.
 *
 * Renders at one pixel per module into an offscreen canvas, then blits with
 * smoothing disabled at an integer device-pixel scale. Fractional scaling is
 * what produces the moire that makes dense codes unreadable.
 */
export function renderQrStream(options: RenderOptions): RenderController {
  const { packets, version, fps: requestedFps } = resolveStream(options);
  const { canvas, size, colors } = options;
  if (size !== undefined && (!Number.isFinite(size) || size <= 0)) {
    throw new QrStreamError('INVALID_ARGUMENT', `size must be a positive finite number, got ${size}`);
  }
  // The paint loop catches per-frame errors, so bad colors must be rejected
  // here or the host would get a permanently blank canvas instead of a code.
  resolveRasterOptions(colors);
  const refreshHz = options.refreshHz ?? 60;
  const context = canvas.getContext('2d');
  if (context === null) throw new RenderError('canvas 2d context unavailable');

  const source = document.createElement('canvas');
  const sourceContext = source.getContext('2d');
  if (sourceContext === null) throw new RenderError('offscreen 2d context unavailable');

  let fps = quantizeFps(requestedFps, refreshHz);
  let painted = 0;
  let running = false;
  let frameHandle = 0;
  let accumulator = 0;
  let lastTime = 0;
  const queue: Uint8Array[] = [];
  let exhausted = false;
  let stopped = false;
  let preparing = false;

  const iterator = packets[Symbol.asyncIterator]();

  /** Top up to the cap. Never fetch a fixed batch, or the queue grows forever. */
  const prepare = async (): Promise<void> => {
    if (stopped || preparing || exhausted) return;
    preparing = true;
    try {
      while (queue.length < QUEUE_CAP) {
        const { value, done } = await iterator.next();
        if (done) {
          exhausted = true;
          break;
        }
        queue.push(value as Uint8Array);
      }
    } catch {
      // A rejecting host iterator cannot be retried; stop the clock instead of
      // producing an unhandled rejection at camera frame rate.
      exhausted = true;
      running = false;
    } finally {
      preparing = false;
    }
  };

  const paintNext = (): void => {
    if (stopped) return;
    const packet = queue.shift();
    if (packet === undefined) return;

    try {
      const matrix = packetToMatrix(packet, version);
      const image = matrixToRGBA(matrix, 1, colors);
      source.width = image.width;
      source.height = image.height;
      sourceContext.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);

      const ratio = window.devicePixelRatio || 1;
      let targetWidth: number;
      if (size !== undefined) {
        // An explicit size wins over the parent. Never measure the canvas back:
        // its CSS size is exactly what this frame is about to change.
        targetWidth = Math.max(image.width, Math.floor(size * ratio));
      } else {
        // Measure the container, never the canvas: the canvas is sized to an
        // exact integer multiple of the module grid, so its own CSS width is
        // what we are about to change. Measuring it would feed the previous
        // size back in.
        const container = canvas.parentElement;
        const cssWidth = container?.clientWidth ?? canvas.clientWidth ?? image.width;
        targetWidth = Math.max(image.width, Math.floor(cssWidth * ratio));
      }

      const scale = Math.max(1, Math.floor(targetWidth / image.width));
      const bitmapSize = image.width * scale;

      if (canvas.width !== bitmapSize || canvas.height !== bitmapSize) {
        canvas.width = bitmapSize;
        canvas.height = bitmapSize;
      }

      // Pin the CSS size to the exact bitmap extent so a host `max-width`
      // cannot reintroduce fractional scaling.
      if (size !== undefined && canvas.style !== undefined) {
        const cssSize = `${bitmapSize / ratio}px`;
        canvas.style.width = cssSize;
        canvas.style.height = cssSize;
      }

      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, bitmapSize, bitmapSize);
      context.drawImage(source, 0, 0, bitmapSize, bitmapSize);

      painted += 1;
    } finally {
      // Refill even when this packet threw. Otherwise three bad packets drain
      // the queue and the loop paints nothing forever while `running` is true.
      void prepare();
    }
  };

  const tick = (time: number): void => {
    if (!running) return;

    // Schedule before painting so a throwing frame can never stop the clock.
    frameHandle = requestAnimationFrame(tick);

    if (lastTime === 0) lastTime = time;
    const delta = time - lastTime;
    lastTime = time;
    accumulator += delta;

    const interval = 1000 / fps;
    let advanced = false;
    while (accumulator >= interval) {
      accumulator -= interval;
      advanced = true;
    }
    if (!advanced) return;

    try {
      paintNext();
    } catch {
      // A bad packet must not kill the stream; skip it and keep the loop alive.
    }
  };

  return {
    play() {
      if (running || stopped) return;
      running = true;
      lastTime = 0;
      accumulator = 0;
      void prepare();
      frameHandle = requestAnimationFrame(tick);
    },
    pause() {
      running = false;
      cancelAnimationFrame(frameHandle);
    },
    setFps(next: number) {
      fps = quantizeFps(next, refreshHz);
    },
    stop() {
      stopped = true;
      running = false;
      cancelAnimationFrame(frameHandle);
      queue.length = 0;
      try {
        // A host iterator may reject on early close; that is not a render
        // failure, and an unhandled rejection at camera frame rate is noise.
        void iterator.return?.(undefined)?.catch(() => undefined);
      } catch {
        // A synchronous close failure is equally harmless here.
      }
      // Remove the last painted QR. A stopped controller must not leave a
      // scannable frame on screen, especially when K=1 carries the whole file.
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
    framesPainted: () => painted,
  };
}
