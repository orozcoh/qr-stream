// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readQrStream, type CameraController } from '../src/browser/camera.js';
import { CameraError, type QrStreamError } from '../src/core/errors.js';
import {
  useCameraReader,
  type UseCameraReaderOptions,
  type UseCameraReaderResult,
} from '../src/react/useCameraReader.js';

vi.mock('../src/browser/camera.js', () => ({
  readQrStream: vi.fn(),
}));

const baseDecoder = async () => ({ decode: async () => null });

/** Every controller the mocked camera handed out, for leak accounting. */
const created: CameraController[] = [];
const lives = new Set<CameraController>();

function fakeController(overrides: Partial<CameraController> = {}): CameraController {
  const controller: CameraController = {
    devices: vi.fn(() => []),
    activeId: vi.fn(() => null),
    select: vi.fn(async () => undefined),
    cycle: vi.fn(async () => undefined),
    stop: vi.fn(),
    onSymbol: vi.fn(),
    onError: vi.fn(),
    diagnostics: vi.fn(() => ({ devices: [], active: null })),
    rescan: vi.fn(async () => undefined),
    zoomRange: vi.fn(() => null),
    setZoom: vi.fn(async () => undefined),
    applyConstraints: vi.fn(async () => undefined),
    torchSupported: vi.fn(() => false),
    torchOn: vi.fn(() => false),
    setTorch: vi.fn(async () => undefined),
    ...overrides,
  };
  const stop = controller.stop;
  controller.stop = vi.fn(() => {
    lives.delete(controller);
    stop();
  });
  created.push(controller);
  lives.add(controller);
  return controller;
}

interface HarnessProps {
  options: UseCameraReaderOptions;
  capture(result: UseCameraReaderResult): void;
}

function Harness({ options, capture }: HarnessProps) {
  const result = useCameraReader(options);
  capture(result);
  return <video ref={result.videoRef} />;
}

interface View {
  readonly renders: number;
  readonly result: UseCameraReaderResult;
  rerender(next?: Partial<UseCameraReaderOptions>): void;
  unmount(): void;
}

function renderStrict(initial: Partial<UseCameraReaderOptions> = {}): View {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let options: UseCameraReaderOptions = { createDecoder: baseDecoder, ...initial };
  let result: UseCameraReaderResult | null = null;
  let renders = 0;
  const capture = (next: UseCameraReaderResult): void => {
    renders += 1;
    result = next;
  };
  const render = (): void => {
    act(() => {
      root.render(
        <StrictMode>
          <Harness options={options} capture={capture} />
        </StrictMode>,
      );
    });
  };
  render();
  return {
    get renders() {
      return renders;
    },
    get result() {
      if (result === null) throw new Error('harness rendered nothing');
      return result;
    },
    rerender(next = {}) {
      options = { ...options, ...next };
      render();
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  created.length = 0;
  lives.clear();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

test('StrictMode double-invokes startup but leaves no duplicate live controller', async () => {
  const controller = fakeController();
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const createDecoder = vi.fn(baseDecoder);
  const view = renderStrict({ createDecoder });

  await flush();

  // Observed React 19 StrictMode counts: the first mount's effect is torn down
  // before its decoder promise settles, then the second effect starts again.
  // Decoder construction runs twice; only the second run reaches the camera.
  expect(createDecoder).toHaveBeenCalledTimes(2);
  expect(readQrStream).toHaveBeenCalledTimes(1);
  expect(lives.size).toBe(1);
  expect(view.result.ready).toBe(true);

  view.unmount();

  expect(lives.size).toBe(0);
  expect(controller.stop).toHaveBeenCalled();
  // Every controller the hook ever received is released after unmount.
  for (const opened of created) {
    expect(opened.stop).toHaveBeenCalled();
  }
});

test('unmount during an in-flight camera open stops the late controller', async () => {
  const controller = fakeController();
  let release!: (value: CameraController) => void;
  const gate = new Promise<CameraController>((resolve) => {
    release = resolve;
  });
  vi.mocked(readQrStream).mockReturnValue(gate);
  const onError = vi.fn();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const view = renderStrict({ onError });
  await flush();

  expect(readQrStream).toHaveBeenCalledTimes(1);
  expect(view.result.starting).toBe(true);

  const rendersBeforeUnmount = view.renders;
  view.unmount();
  release(controller);
  await flush();

  expect(controller.stop).toHaveBeenCalled();
  expect(lives.size).toBe(0);
  expect(onError).not.toHaveBeenCalled();
  // The component never rendered again after unmount.
  expect(view.renders).toBe(rendersBeforeUnmount);
  expect(consoleError).not.toHaveBeenCalled();
});

test('a controller failure after unmount does not reach the host or rerender', async () => {
  const controller = fakeController();
  const captured: { report: ((error: QrStreamError) => void) | null } = { report: null };
  controller.onError = (callback) => {
    captured.report = callback;
  };
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const onError = vi.fn();
  const view = renderStrict({ onError });
  await flush();
  if (captured.report === null) throw new Error('the hook registered no error callback');

  const rendersBeforeUnmount = view.renders;
  view.unmount();

  captured.report(new CameraError('CAMERA_IN_USE', 'The camera is in use by another app.'));
  await flush();

  expect(onError).not.toHaveBeenCalled();
  expect(view.renders).toBe(rendersBeforeUnmount);
});

test('rerendering under StrictMode never opens a second live camera', async () => {
  const controller = fakeController();
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const view = renderStrict();
  await flush();

  expect(readQrStream).toHaveBeenCalledTimes(1);
  expect(lives.size).toBe(1);

  view.rerender({ createDecoder: async () => ({ decode: async () => null }) });
  view.rerender();
  await flush();

  expect(readQrStream).toHaveBeenCalledTimes(1);
  expect(controller.stop).not.toHaveBeenCalled();
  expect(lives.size).toBe(1);
  view.unmount();
  expect(lives.size).toBe(0);
});
