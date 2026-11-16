/**
 * A fake canvas and animation clock for the render benchmark.
 *
 * This mirrors the mocks in `tests/render.test.ts` but without Vitest: the
 * point is to exercise the real `renderQrStream` paint path, including
 * `packetToMatrix`, `matrixToRGBA`, the per-frame `ImageData` construction, and
 * `drawImage`. Browser rasterisation and compositing are not reproduced; the
 * stub context records nothing, so the result is a lower bound on real paint
 * cost. See `docs/performance.md`.
 */

class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

interface FakeContext {
  imageSmoothingEnabled: boolean;
  putImageData(image: FakeImageData, x: number, y: number): void;
  drawImage(source: unknown, x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
}

export interface FakeCanvasEnvironment {
  canvas: HTMLCanvasElement;
  /** Invoke the currently scheduled animation frame at this timestamp. */
  step(time: number): void;
  /** Put the Node globals back exactly as they were. */
  restore(): void;
}

interface SavedGlobals {
  document: unknown;
  window: unknown;
  ImageData: unknown;
  requestAnimationFrame: unknown;
  cancelAnimationFrame: unknown;
}

const GLOBALS = globalThis as Record<string, unknown>;

function fakeCanvas(cssWidth: number, context: FakeContext): HTMLCanvasElement {
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: cssWidth,
    parentElement: { clientWidth: cssWidth },
    style: {},
    getContext: () => context,
  };
  return canvas as unknown as HTMLCanvasElement;
}

export function installFakeCanvas(cssWidth = 512, retainImages?: Uint8ClampedArray[]): FakeCanvasEnvironment {
  const context: FakeContext = {
    imageSmoothingEnabled: true,
    putImageData: (image) => {
      retainImages?.push(image.data);
    },
    drawImage: () => undefined,
    clearRect: () => undefined,
  };

  let callback: FrameRequestCallback | null = null;
  const saved: SavedGlobals = {
    document: GLOBALS['document'],
    window: GLOBALS['window'],
    ImageData: GLOBALS['ImageData'],
    requestAnimationFrame: GLOBALS['requestAnimationFrame'],
    cancelAnimationFrame: GLOBALS['cancelAnimationFrame'],
  };

  GLOBALS['document'] = {
    createElement: () => fakeCanvas(cssWidth, context),
  };
  GLOBALS['window'] = { devicePixelRatio: 1 };
  GLOBALS['ImageData'] = FakeImageData;
  GLOBALS['requestAnimationFrame'] = (next: FrameRequestCallback): number => {
    callback = next;
    return 1;
  };
  GLOBALS['cancelAnimationFrame'] = (): void => {
    callback = null;
  };

  return {
    canvas: fakeCanvas(cssWidth, context),
    step(time: number) {
      const next = callback;
      callback = null;
      next?.(time);
    },
    restore() {
      GLOBALS['document'] = saved.document;
      GLOBALS['window'] = saved.window;
      GLOBALS['ImageData'] = saved.ImageData;
      GLOBALS['requestAnimationFrame'] = saved.requestAnimationFrame;
      GLOBALS['cancelAnimationFrame'] = saved.cancelAnimationFrame;
    },
  };
}
