import { packetToMatrix } from '../qr/matrix';
import { matrixToRGBA } from '../qr/raster';

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

export interface RenderOptions {
  packets: AsyncIterable<Uint8Array>;
  canvas: HTMLCanvasElement;
  fps: number;
  version: number;
  /** Display refresh rate used to quantise `fps`. Defaults to 60. */
  refreshHz?: number;
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
  const { canvas, packets, version } = options;
  const refreshHz = options.refreshHz ?? 60;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas 2d context unavailable');

  const source = document.createElement('canvas');
  const sourceContext = source.getContext('2d');
  if (sourceContext === null) throw new Error('offscreen 2d context unavailable');

  let fps = quantizeFps(options.fps, refreshHz);
  let painted = 0;
  let running = false;
  let frameHandle = 0;
  let accumulator = 0;
  let lastTime = 0;
  const queue: Uint8Array[] = [];
  let exhausted = false;
  let preparing = false;

  const iterator = packets[Symbol.asyncIterator]();

  /** Top up to the cap. Never fetch a fixed batch, or the queue grows forever. */
  const prepare = async (): Promise<void> => {
    if (preparing || exhausted) return;
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
    } finally {
      preparing = false;
    }
  };

  const paintNext = (): void => {
    const packet = queue.shift();
    if (packet === undefined) return;

    const matrix = packetToMatrix(packet, version);
    const image = matrixToRGBA(matrix, 1);
    source.width = image.width;
    source.height = image.height;
    sourceContext.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);

    const ratio = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || image.width;
    const targetWidth = Math.max(image.width, Math.floor(cssWidth * ratio));
    const scale = Math.max(1, Math.floor(targetWidth / image.width));
    const size = image.width * scale;

    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, size, size);
    context.drawImage(source, 0, 0, size, size);

    painted += 1;
    void prepare();
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
      if (running) return;
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
      running = false;
      cancelAnimationFrame(frameHandle);
      queue.length = 0;
      void iterator.return?.(undefined);
    },
    framesPainted: () => painted,
  };
}
