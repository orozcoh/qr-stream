import { afterEach, describe, expect, test, vi } from 'vitest';
import { estimateTransferSeconds, quantizeFps, renderQrStream, type RenderOptions } from '../src/browser/render';
import { QrStreamError } from '../src/core/errors';
import { createQrStreamWriter } from '../src/core/writer';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

interface RenderMocks {
  context: {
    imageSmoothingEnabled: boolean;
    putImageData: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    clearRect: ReturnType<typeof vi.fn>;
  };
  canvas: HTMLCanvasElement;
  step(time: number): void;
  rafCallCount(): number;
}

/** Minimal 2D canvas plus a manually driven requestAnimationFrame. */
function installRenderMocks(): RenderMocks {
  const context = {
    imageSmoothingEnabled: true,
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  };
  const source = { width: 0, height: 0, getContext: () => context };
  const canvas = { width: 0, height: 0, clientWidth: 300, parentElement: null, getContext: () => context };
  let rafCallback: FrameRequestCallback | null = null;
  let rafCalls = 0;

  vi.stubGlobal('document', { createElement: () => source });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    rafCallback = callback;
    rafCalls += 1;
    return rafCalls;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  return {
    context,
    canvas: canvas as unknown as HTMLCanvasElement,
    step(time: number) {
      const callback = rafCallback;
      rafCallback = null;
      callback?.(time);
    },
    rafCallCount: () => rafCalls,
  };
}

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe('renderQrStream stop', () => {
  test('clears the canvas and cannot restart', async () => {
    const { context, canvas, step, rafCallCount } = installRenderMocks();

    async function* packets(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array(20);
    }

    const controller = renderQrStream({
      packets: packets(),
      canvas,
      fps: 15,
      version: 20,
    });
    controller.play();
    await new Promise((resolve) => setTimeout(resolve, 0));

    step(1);
    step(100);

    expect(context.drawImage).toHaveBeenCalled();
    controller.stop();
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, canvas.width, canvas.height);

    const calls = rafCallCount();
    controller.play();
    expect(rafCallCount()).toBe(calls);
  });
});

describe('renderQrStream writer mode', () => {
  test('accepts a writer and uses its version', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(400), { filename: 'a.json', preset: 'fast' });
    const { context, canvas, step } = installRenderMocks();

    const controller = renderQrStream({ writer, canvas, fps: 5 });
    controller.play();
    await new Promise((resolve) => setTimeout(resolve, 0));
    step(1);
    step(300);

    expect(context.drawImage).toHaveBeenCalled();
    controller.stop();
  });

  test('defaults fps from the writer preset', async () => {
    const fast = await createQrStreamWriter(new Uint8Array(400), { filename: 'a.json', preset: 'fast' });
    const first = installRenderMocks();
    const fastController = renderQrStream({ writer: fast, canvas: first.canvas });
    fastController.play();
    await new Promise((resolve) => setTimeout(resolve, 0));
    first.step(1);
    first.step(100);

    // fast defaults to 15 fps: 100 ms spans a frame.
    expect(first.context.drawImage).toHaveBeenCalled();
    fastController.stop();

    const extreme = await createQrStreamWriter(new Uint8Array(400), { filename: 'a.json', preset: 'extreme' });
    const second = installRenderMocks();
    const extremeController = renderQrStream({ writer: extreme, canvas: second.canvas });
    extremeController.play();
    await new Promise((resolve) => setTimeout(resolve, 0));
    second.step(1);
    second.step(100);

    // extreme defaults to 6 fps: 100 ms is not yet a frame.
    expect(second.context.drawImage).not.toHaveBeenCalled();
    extremeController.stop();
  });

  test('still accepts raw packets and an explicit version', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(400), { filename: 'a.json', preset: 'fast' });
    const { context, canvas, step } = installRenderMocks();

    const controller = renderQrStream({ packets: writer.packets(), canvas, fps: 15, version: writer.version });
    controller.play();
    await new Promise((resolve) => setTimeout(resolve, 0));
    step(1);
    step(100);

    expect(context.drawImage).toHaveBeenCalled();
    controller.stop();
  });

  test('rejects passing both a writer and packets', async () => {
    const writer = await createQrStreamWriter(new Uint8Array(400), { filename: 'a.json', preset: 'fast' });
    const { canvas } = installRenderMocks();

    const error = catchError(() =>
      renderQrStream({ writer, packets: writer.packets(), canvas, fps: 5, version: 20 } as unknown as RenderOptions),
    );

    expect(error).toBeInstanceOf(QrStreamError);
    expect((error as QrStreamError).code).toBe('INVALID_ARGUMENT');
  });

  test('rejects passing neither a writer nor packets', () => {
    const { canvas } = installRenderMocks();

    const error = catchError(() => renderQrStream({ canvas, fps: 5 } as unknown as RenderOptions));

    expect(error).toBeInstanceOf(QrStreamError);
    expect((error as QrStreamError).code).toBe('INVALID_ARGUMENT');
  });
});

describe('quantizeFps', () => {
  test('never exceeds the requested rate', () => {
    expect(quantizeFps(11, 60)).toBe(10);
    expect(quantizeFps(7, 60)).toBe(6);
    expect(quantizeFps(13, 60)).toBe(12);
  });

  test('every result divides the refresh rate', () => {
    for (let fps = 1; fps <= 60; fps += 1) {
      const got = quantizeFps(fps, 60);
      expect(60 % (60 / got)).toBe(0);
      expect(got).toBeLessThanOrEqual(fps);
      expect(got).toBeGreaterThan(0);
    }
  });

  test('a request at the refresh rate is honoured', () => {
    expect(quantizeFps(60, 60)).toBe(60);
  });

  test('handles a 120 Hz display', () => {
    expect(quantizeFps(11, 120)).toBe(10);
    expect(quantizeFps(120, 120)).toBe(120);
  });

  test('clamps nonsense to one frame per second', () => {
    expect(quantizeFps(0.4, 60)).toBe(1);
    expect(quantizeFps(Number.NaN, 60)).toBe(1);
  });
});

describe('estimateTransferSeconds', () => {
  test('scales with block count and frame rate', () => {
    expect(estimateTransferSeconds(100, 10)).toBe(18);
    expect(estimateTransferSeconds(100, 20)).toBe(9);
  });

  test('returns 0 for degenerate input', () => {
    expect(estimateTransferSeconds(0, 10)).toBe(0);
    expect(estimateTransferSeconds(100, 0)).toBe(0);
  });

  test('1 MiB at the fast preset is minutes, not seconds', () => {
    // 1252 blocks at 15 fps with 1.75x fountain overhead.
    expect(estimateTransferSeconds(1252, 15)).toBeGreaterThan(120);
  });
});
