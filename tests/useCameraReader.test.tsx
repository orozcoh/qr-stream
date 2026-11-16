// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readQrStream, type CameraController, type CameraDevice } from '../src/browser/camera.js';
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

const device: CameraDevice = { deviceId: 'cam-1', label: 'Back camera', facing: 'environment', groupId: 'g1' };

function fakeController(overrides: Partial<CameraController> = {}): CameraController {
  return {
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
  readonly result: UseCameraReaderResult;
  rerender(next?: Partial<UseCameraReaderOptions>): void;
  unmount(): void;
}

function renderHarness(initial: Partial<UseCameraReaderOptions> = {}): View {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let options: UseCameraReaderOptions = { createDecoder: baseDecoder, ...initial };
  let result: UseCameraReaderResult | null = null;
  const capture = (next: UseCameraReaderResult): void => {
    result = next;
  };
  const render = (): void => {
    act(() => {
      root.render(<Harness options={options} capture={capture} />);
    });
  };
  render();
  return {
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
});

afterEach(() => {
  document.body.innerHTML = '';
});

test('starts once per mount and stop releases the controller', async () => {
  const controller = fakeController({ devices: () => [device], activeId: () => 'cam-1' });
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const view = renderHarness();

  await flush();

  expect(readQrStream).toHaveBeenCalledTimes(1);
  expect(view.result.ready).toBe(true);
  expect(view.result.devices).toEqual([device]);
  expect(view.result.activeId).toBe('cam-1');

  act(() => view.result.stop());

  expect(controller.stop).toHaveBeenCalledTimes(1);
  expect(view.result.ready).toBe(false);
  // The last list is kept so a restart does not have to enumerate again.
  expect(view.result.devices).toEqual([device]);
  expect(view.result.activeId).toBeNull();
  expect(view.result.diagnostics).toBeNull();
  expect(view.result.starting).toBe(false);
  view.unmount();
});

test('start and stop are stable across renders', async () => {
  vi.mocked(readQrStream).mockResolvedValue(fakeController());
  const view = renderHarness();
  await flush();

  const start = view.result.start;
  const stop = view.result.stop;
  view.rerender();
  await flush();

  expect(view.result.start).toBe(start);
  expect(view.result.stop).toBe(stop);
  view.unmount();
});

test('enabled=false does not open; enabling opens; disabling stops', async () => {
  const controller = fakeController();
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const view = renderHarness({ enabled: false });

  await flush();
  expect(readQrStream).not.toHaveBeenCalled();

  view.rerender({ enabled: true });
  await flush();
  expect(readQrStream).toHaveBeenCalledTimes(1);
  expect(view.result.ready).toBe(true);

  view.rerender({ enabled: false });
  expect(controller.stop).toHaveBeenCalledTimes(1);
  expect(view.result.ready).toBe(false);
  view.unmount();
});

test('manual start still works when enabled=false', async () => {
  vi.mocked(readQrStream).mockResolvedValue(fakeController());
  const view = renderHarness({ enabled: false });
  await flush();
  expect(readQrStream).not.toHaveBeenCalled();

  await act(async () => {
    await view.result.start();
  });

  expect(readQrStream).toHaveBeenCalledTimes(1);
  expect(view.result.ready).toBe(true);
  view.unmount();
});

test('stop during decoder creation disposes the decoder and never opens the camera', async () => {
  const decoder = { decode: vi.fn(async () => null), dispose: vi.fn() };
  let release!: (value: typeof decoder) => void;
  const gate = new Promise<typeof decoder>((resolve) => {
    release = resolve;
  });
  const view = renderHarness({ createDecoder: () => gate });

  act(() => view.result.stop());
  release(decoder);
  await flush();

  expect(decoder.dispose).toHaveBeenCalledTimes(1);
  expect(readQrStream).not.toHaveBeenCalled();
  expect(view.result.ready).toBe(false);
  view.unmount();
});

test('a new createDecoder identity does not restart a live camera', async () => {
  const controller = fakeController();
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const view = renderHarness();
  await flush();
  expect(readQrStream).toHaveBeenCalledTimes(1);

  view.rerender({ createDecoder: async () => ({ decode: async () => null }) });
  await flush();

  expect(readQrStream).toHaveBeenCalledTimes(1);
  expect(controller.stop).not.toHaveBeenCalled();
  view.unmount();
});

test('start after stop opens a new controller and decoder', async () => {
  const first = fakeController();
  const second = fakeController();
  vi.mocked(readQrStream).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const createDecoder = vi.fn(baseDecoder);
  const view = renderHarness({ createDecoder });
  await flush();

  act(() => view.result.stop());
  expect(first.stop).toHaveBeenCalledTimes(1);

  await act(async () => {
    await view.result.start();
  });

  expect(createDecoder).toHaveBeenCalledTimes(2);
  expect(readQrStream).toHaveBeenCalledTimes(2);
  expect(view.result.ready).toBe(true);
  view.unmount();
});

test('a second start while one is in flight is ignored', async () => {
  const decoder = { decode: vi.fn(async () => null) };
  let release!: (value: typeof decoder) => void;
  const gate = new Promise<typeof decoder>((resolve) => {
    release = resolve;
  });
  const createDecoder = vi.fn(() => gate);
  vi.mocked(readQrStream).mockResolvedValue(fakeController());
  const view = renderHarness({ createDecoder });

  await act(async () => {
    await view.result.start();
  });
  expect(createDecoder).toHaveBeenCalledTimes(1);

  release(decoder);
  await flush();
  expect(readQrStream).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('camera failures populate a typed error and call onError once', async () => {
  const cause = new DOMException('denied', 'NotAllowedError');
  const failure = new CameraError('CAMERA_PERMISSION_DENIED', 'Camera permission denied.', { cause });
  vi.mocked(readQrStream).mockRejectedValueOnce(failure);
  const onError = vi.fn();
  const view = renderHarness({ onError });

  await flush();

  expect(view.result.error).toBe(failure);
  expect(view.result.error?.code).toBe('CAMERA_PERMISSION_DENIED');
  expect(view.result.error?.cause).toBe(cause);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith(failure);
  expect(view.result.ready).toBe(false);
  view.unmount();
});

test('an unknown camera failure is wrapped as a typed CameraError', async () => {
  const cause = new Error('boom');
  vi.mocked(readQrStream).mockRejectedValueOnce(cause);
  const view = renderHarness();
  await flush();

  expect(view.result.error?.code).toBe('CAMERA_UNAVAILABLE');
  expect(view.result.error?.cause).toBe(cause);
  view.unmount();
});

test('a reported controller failure and its rejection are reported once', async () => {
  const failure = new CameraError('CAMERA_CONSTRAINTS_FAILED', 'This camera does not accept a zoom setting.');
  let report: ((error: QrStreamError) => void) | null = null;
  const controller = fakeController({
    setZoom: vi.fn(async () => {
      report?.(failure);
      throw failure;
    }),
  });
  controller.onError = (callback) => {
    report = callback;
  };
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const onError = vi.fn();
  const view = renderHarness({ onError });
  await flush();

  await act(async () => {
    await expect(view.result.setZoom(2)).resolves.toBeUndefined();
  });

  expect(view.result.error).toBe(failure);
  expect(onError).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('select, cycle, and rescan resolve after controller rejections', async () => {
  const selectFailure = new CameraError('CAMERA_UNAVAILABLE', 'That camera could not be opened.');
  const cycleFailure = new CameraError('CAMERA_IN_USE', 'The camera is in use by another app.');
  const rescanFailure = new CameraError('CAMERA_NOT_FOUND', 'No camera was found on this device.');
  const controller = fakeController({
    select: vi.fn(async () => {
      throw selectFailure;
    }),
    cycle: vi.fn(async () => {
      throw cycleFailure;
    }),
    rescan: vi.fn(async () => {
      throw rescanFailure;
    }),
  });
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const onError = vi.fn();
  const view = renderHarness({ onError });
  await flush();

  await act(async () => {
    await expect(view.result.select('cam-2')).resolves.toBeUndefined();
  });
  expect(view.result.error).toBe(selectFailure);

  await act(async () => {
    await expect(view.result.cycle()).resolves.toBeUndefined();
  });
  expect(view.result.error).toBe(cycleFailure);

  await act(async () => {
    await expect(view.result.rescan()).resolves.toBeUndefined();
  });
  expect(view.result.error).toBe(rescanFailure);
  expect(onError).toHaveBeenCalledTimes(3);
  expect(view.result.switching).toBe(false);
  view.unmount();
});

test('exposes torch state and forwards setTorch', async () => {
  let torch = false;
  const controller = fakeController({
    torchSupported: () => true,
    torchOn: () => torch,
    setTorch: vi.fn(async (on: boolean) => {
      torch = on;
    }),
  });
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const view = renderHarness();
  await flush();

  expect(view.result.torchSupported).toBe(true);
  expect(view.result.torch).toBe(false);

  await act(async () => {
    await view.result.setTorch(true);
  });

  expect(controller.setTorch).toHaveBeenCalledWith(true);
  expect(view.result.torch).toBe(true);
  view.unmount();
});

test('a torch rejection sets the typed error and resolves', async () => {
  const failure = new CameraError('TORCH_UNSUPPORTED', 'This camera does not support the torch.');
  let report: ((error: QrStreamError) => void) | null = null;
  const controller = fakeController({
    setTorch: vi.fn(async () => {
      report?.(failure);
      throw failure;
    }),
  });
  controller.onError = (callback) => {
    report = callback;
  };
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const onError = vi.fn();
  const view = renderHarness({ onError });
  await flush();

  await act(async () => {
    await expect(view.result.setTorch(true)).resolves.toBeUndefined();
  });

  expect(view.result.error).toBe(failure);
  expect(view.result.error?.code).toBe('TORCH_UNSUPPORTED');
  expect(onError).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('sync exposes zoom, diagnostics, and torch reported by the controller', async () => {
  const controller = fakeController({
    devices: () => [device],
    activeId: () => 'cam-1',
    zoomRange: () => ({ min: 1, max: 4, step: 0.5 }),
    diagnostics: () => ({
      devices: [device],
      active: {
        deviceId: 'cam-1',
        label: 'Back camera',
        settings: { width: 640, height: 480 },
        capabilities: { torch: true },
      },
    }),
    torchSupported: () => true,
    torchOn: () => true,
  });
  vi.mocked(readQrStream).mockResolvedValue(controller);
  const view = renderHarness();
  await flush();

  expect(view.result.zoom).toEqual({ min: 1, max: 4, step: 0.5 });
  expect(view.result.zoomValue).toBe(1);
  expect(view.result.diagnostics?.active?.label).toBe('Back camera');
  expect(view.result.torchSupported).toBe(true);
  expect(view.result.torch).toBe(true);
  view.unmount();
});

test('forwards deviceId, videoConstraints, and the decoder to the camera', async () => {
  const videoConstraints: MediaTrackConstraints = { width: { ideal: 1280 } };
  vi.mocked(readQrStream).mockResolvedValue(fakeController());
  const view = renderHarness({ deviceId: 'cam-2', videoConstraints });
  await flush();

  expect(readQrStream).toHaveBeenCalledWith(
    expect.objectContaining({ deviceId: 'cam-2', videoConstraints, decode: expect.any(Object) }),
  );
  view.unmount();
});

test('omits optional camera options for a one-argument consumer', async () => {
  vi.mocked(readQrStream).mockResolvedValue(fakeController());
  const view = renderHarness();
  await flush();

  const [options] = vi.mocked(readQrStream).mock.calls[0] as [Parameters<typeof readQrStream>[0]];
  expect(Object.keys(options).sort()).toEqual(['decode', 'video']);
  view.unmount();
});
